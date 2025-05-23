// Constants and state
const CONFIG_KEY = 'chat_test_bench_config';
let config = {
    apiDomain: 'https://api.rentua.online/chat',
    wsDomain: 'wss://api.rentua.online/ws'
};
let authToken = '';
let tokenExpiry = 0;
let wsConnection = null;
let chatList = [];
let activeChat = null;
let pingInterval = null;
let activeTab = 'renter';

// Cache for user data
let userCache = {};

// DOM Elements
const apiDomainInput = document.getElementById('api-domain');
const wsDomainInput = document.getElementById('ws-domain');
const saveSettingsButton = document.getElementById('save-settings');
const refreshChatsButton = document.getElementById('refresh-chats');
const advIdInput = document.getElementById('adv-id');
const createChatButton = document.getElementById('create-chat');
const chatListContainer = document.getElementById('chat-list-container');
const chatWindow = document.getElementById('chat-window');
const emptyState = document.getElementById('empty-state');
const debugConsole = document.getElementById('debug-console');

// Message loading state
let isLoadingMessages = false;
let noMoreMessages = false;
let messagesPageSize = 20;
let oldestMessageId = null;

// Toast configuration
let toastTimeout = 5000;
let toasts = [];

// Pending updates flag
window.pendingChatListUpdate = false;

// Toast functions
function showToast(chat, message) {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        logToConsole('Toast container not found', 'error');
        return;
    }

    // Используем правильные поля из API согласно client.yml
    const userData = userCache[chat.user_id] || {};

    let chatTitle = "New message";
    let avatarContent = "";
    let avatarStyle = "";

    // Приоритет: adv_title, потом имя пользователя
    if (chat.adv_title) {
        chatTitle = chat.adv_title;
    }

    if (userData && !userData.error) {
        if (userData.avatar) {
            avatarStyle = `background-image: url('${userData.avatar}')`;
        } else if (userData.first_name) {
            avatarContent = userData.first_name.charAt(0);
        } else {
            avatarContent = chat.chatType === 'renter' ? 'R' : 'O';
        }

        // Если нет заголовка объявления, используем имя пользователя
        if (!chat.adv_title) {
            if (userData.first_name && userData.last_name) {
                chatTitle = `${userData.first_name} ${userData.last_name}`;
            } else if (userData.first_name) {
                chatTitle = userData.first_name;
            } else if (userData.business_name) {
                chatTitle = userData.business_name;
            }
        }
    } else {
        // Fallback для случаев когда нет данных пользователя
        avatarContent = chat.chatType === 'renter' ? 'R' : 'O';
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.dataset.chatId = chat.id;

    toast.innerHTML = `
        <div class="toast-avatar" style="${avatarStyle}">${avatarContent}</div>
        <div class="toast-content">
            <div class="toast-title">${chatTitle}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close">&times;</button>
    `;

    toast.addEventListener('click', (e) => {
        if (e.target.className === 'toast-close') return;
        const chatToOpen = chatList.find(c => c.id === chat.id);
        if (chatToOpen) {
            selectChat(chatToOpen);
            removeToast(toast);
        }
    });

    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeToast(toast);
    });

    toastContainer.appendChild(toast);
    toasts.push(toast);
    playNotificationSound();

    setTimeout(() => {
        removeToast(toast);
    }, toastTimeout);
}

function removeToast(toast) {
    if (!toast || !toast.parentNode) return;

    toast.style.animation = 'fadeOut 0.3s forwards';

    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }
        const index = toasts.indexOf(toast);
        if (index !== -1) {
            toasts.splice(index, 1);
        }
    }, 300);
}

function playNotificationSound() {
    const sound = document.getElementById('notification-sound');
    if (sound) {
        sound.currentTime = 0;
        sound.play().catch(error => {
            logToConsole(`Error playing notification sound: ${error.message}`, 'warning');
        });
    } else {
        logToConsole('Notification sound element not found', 'warning');
    }
}

// Initialize the application
function init() {
    window.pendingChatListUpdate = false;
    loadConfig();
    bindEventListeners();
    applyConfig();
    logToConsole('Application initialized', 'info');
}

function loadConfig() {
    const savedConfig = localStorage.getItem(CONFIG_KEY);
    if (savedConfig) {
        try {
            config = JSON.parse(savedConfig);
            logToConsole('Configuration loaded from storage', 'info');
        } catch (e) {
            logToConsole('Failed to load configuration: ' + e.message, 'error');
        }
    }
}

function saveConfig() {
    config.apiDomain = apiDomainInput.value.trim();
    config.wsDomain = wsDomainInput.value.trim();
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    logToConsole('Configuration saved', 'success');
}

function applyConfig() {
    apiDomainInput.value = config.apiDomain;
    wsDomainInput.value = config.wsDomain;
}

function bindEventListeners() {
    saveSettingsButton.addEventListener('click', () => {
        saveConfig();
        getAuthToken()
            .then(() => {
                connectWebSocket();
                fetchChats();
            })
            .catch(error => {
                logToConsole(`Auth token error: ${error.message}`, 'error');
            });
    });

    refreshChatsButton.addEventListener('click', () => {
        ensureValidToken()
            .then(() => {
                fetchChats();
            })
            .catch(error => {
                logToConsole(`Token refresh error: ${error.message}`, 'error');
            });
    });

    createChatButton.addEventListener('click', () => {
        ensureValidToken()
            .then(() => {
                createChat(advIdInput.value.trim());
            })
            .catch(error => {
                logToConsole(`Token refresh error: ${error.message}`, 'error');
            });
    });

    const tabRenter = document.getElementById('tab-renter');
    const tabOwner = document.getElementById('tab-owner');

    tabRenter.addEventListener('click', () => {
        setActiveTab('renter');
    });

    tabOwner.addEventListener('click', () => {
        setActiveTab('owner');
    });
}

function setActiveTab(tabName) {
    activeTab = tabName;

    const tabRenter = document.getElementById('tab-renter');
    const tabOwner = document.getElementById('tab-owner');

    if (activeTab === 'renter') {
        tabRenter.classList.add('active');
        tabOwner.classList.remove('active');
    } else {
        tabRenter.classList.remove('active');
        tabOwner.classList.add('active');
    }

    renderChatList();
}

function createChat(advId) {
    if (!advId) {
        logToConsole('Please enter a valid Advertisement ID', 'warning');
        return;
    }

    logToConsole(`Creating chat for adv_id: ${advId}...`, 'info');

    fetch(`${config.apiDomain}/renter/create/${advId}`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${authToken}`
        }
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            logToConsole(`Chat created successfully with ID: ${data.chat_id}`, 'success');
            advIdInput.value = '';
            fetchChats();
        })
        .catch(error => {
            logToConsole(`Error creating chat: ${error.message}`, 'error');
        });
}

function fetchChats() {
    logToConsole('Fetching chats...', 'info');
    chatList = [];

    fetchChatType('renter')
        .then(() => {
            return fetchChatType('owner');
        })
        .then(() => {
            return fetchUserData();
        })
        .then(() => {
            renderChatList();
        })
        .catch(error => {
            logToConsole(`Error fetching chats: ${error.message}`, 'error');
        });
}

function fetchChatType(type) {
    return fetch(`${config.apiDomain}/${type}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${authToken}`
        }
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.items && Array.isArray(data.items)) {
                const typedChats = data.items.map(chat => ({
                    ...chat,
                    chatType: type,
                    // Извлекаем данные из структуры согласно client.yml
                    last_message_text: chat.last_message ? chat.last_message.content : 'No messages yet',
                    last_message_time: chat.last_message ? chat.last_message.created_at : null
                }));

                chatList = [...chatList, ...typedChats];
                logToConsole(`Fetched ${typedChats.length} ${type} chats`, 'success');
            } else {
                logToConsole(`No ${type} chats found or invalid response format`, 'info');
            }
        });
}

async function fetchUserData() {
    const userIds = new Set();

    chatList.forEach(chat => {
        if (chat.user_id) userIds.add(chat.user_id);
    });

    const userPromises = Array.from(userIds)
        .filter(userId => !userCache[userId])
        .map(userId => fetchUserInfo(userId));

    await Promise.all(userPromises);
    logToConsole(`Fetched additional data for ${userPromises.length} users`, 'success');
}

function fetchUserInfo(userId) {
    const baseDomain = config.apiDomain.replace(/\/chat$/, '');
    const userInfoUrl = `${baseDomain}/client/info/public/${userId}`;

    return fetch(userInfoUrl, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${authToken}`
        }
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(userData => {
            userCache[userId] = userData;
            return userData;
        })
        .catch(error => {
            logToConsole(`Error fetching user info for ${userId}: ${error.message}`, 'error');
            userCache[userId] = { error: true };
        });
}

function renderChatList() {
    chatListContainer.innerHTML = '';

    const filteredChats = chatList.filter(chat => chat.chatType === activeTab);

    if (filteredChats.length === 0) {
        const emptyItem = document.createElement('div');
        emptyItem.className = 'chat-item';
        emptyItem.innerHTML = '<div class="chat-info"><div class="chat-title">No chats found</div></div>';
        chatListContainer.appendChild(emptyItem);
        return;
    }

    filteredChats.sort((a, b) => {
        const timeA = a.last_message_time ? new Date(a.last_message_time).getTime() : 0;
        const timeB = b.last_message_time ? new Date(b.last_message_time).getTime() : 0;
        return timeB - timeA;
    });

    filteredChats.forEach(chat => {
        const chatItem = document.createElement('div');
        chatItem.className = 'chat-item';
        if (activeChat && chat.id === activeChat.id) {
            chatItem.className += ' active';
        }

        // Используем правильные поля из API согласно client.yml
        // user_id - это ID собеседника
        // adv_title - заголовок объявления
        // adv_img - картинка объявления
        const userData = userCache[chat.user_id] || {};

        let chatTitle = "Chat";
        let avatarContent = "";
        let avatarStyle = "";

        // Приоритет: adv_title, потом имя пользователя
        if (chat.adv_title) {
            chatTitle = chat.adv_title;
        }

        if (userData && !userData.error) {
            if (userData.avatar) {
                avatarStyle = `background-image: url('${userData.avatar}')`;
            } else if (userData.first_name) {
                avatarContent = userData.first_name.charAt(0);
            } else {
                avatarContent = chat.chatType === 'renter' ? 'R' : 'O';
            }

            // Если нет заголовка объявления, используем имя пользователя
            if (!chat.adv_title) {
                if (userData.first_name && userData.last_name) {
                    chatTitle = `${userData.first_name} ${userData.last_name}`;
                } else if (userData.first_name) {
                    chatTitle = userData.first_name;
                } else if (userData.business_name) {
                    chatTitle = userData.business_name;
                }
            }
        } else {
            // Fallback для случаев когда нет данных пользователя
            avatarContent = chat.chatType === 'renter' ? 'R' : 'O';
        }

        const lastMessage = chat.last_message_text || 'No messages yet';
        const timestamp = chat.last_message_time ? formatTimestamp(new Date(chat.last_message_time)) : '';

        chatItem.innerHTML = `
            <div class="avatar" style="${avatarStyle}">${avatarContent}</div>
            <div class="chat-info">
                <div class="chat-header">
                    <div class="chat-title">${chatTitle}</div>
                    <div class="chat-time">${timestamp}</div>
                </div>
                <div class="chat-last-message">${lastMessage}</div>
            </div>
            ${chat.read ? '' : '<div class="unread-indicator"></div>'}
        `;

        chatItem.addEventListener('click', () => {
            selectChat(chat);
        });

        chatListContainer.appendChild(chatItem);
    });
}

function selectChat(chat) {
    activeChat = chat;
    renderChatList();
    renderChatWindow(chat);

    isLoadingMessages = false;
    noMoreMessages = false;
    oldestMessageId = null;

    markChatAsRead(chat.id);
    fetchMessages(chat.id);

    setTimeout(setupScrollListener, 500);
}

function markChatAsRead(chatId) {
    if (!wsConnection) {
        logToConsole('WebSocket connection does not exist, attempting to reconnect...', 'warning');
        ensureValidToken()
            .then(() => {
                connectWebSocket();
                setTimeout(() => markChatAsRead(chatId), 1000);
            })
            .catch(error => {
                logToConsole(`Error refreshing token for markChatAsRead: ${error.message}`, 'error');
            });
        return;
    }

    if (wsConnection.readyState !== WebSocket.OPEN) {
        logToConsole(`WebSocket connection is not open (state: ${wsConnection.readyState}), cannot mark messages as read`, 'warning');

        if (wsConnection.readyState === WebSocket.CLOSED) {
            logToConsole('Attempting to reconnect WebSocket...', 'info');
            ensureValidToken()
                .then(() => {
                    connectWebSocket();
                    setTimeout(() => markChatAsRead(chatId), 1000);
                })
                .catch(error => {
                    logToConsole(`Error refreshing token for reconnection: ${error.message}`, 'error');
                });
        }
        return;
    }

    const readMessage = {
        type: 'read',
        event_data: {
            chat_id: chatId
        }
    };

    try {
        wsConnection.send(JSON.stringify(readMessage));
        logToConsole(`Marked chat ${chatId} as read`, 'info');

        if (activeChat && activeChat.id === chatId) {
            activeChat.read = true;
        }

        chatList.forEach(chat => {
            if (chat.id === chatId) {
                chat.read = true;
            }
        });

        renderChatList();
    } catch (error) {
        logToConsole(`Error sending read event: ${error.message}`, 'error');
    }
}

function renderChatWindow(chat) {
    // Используем правильные поля из API согласно client.yml
    const userData = userCache[chat.user_id] || {};

    let chatTitle = "Chat";
    let avatarContent = "";
    let avatarStyle = "";

    // Приоритет: adv_title, потом имя пользователя
    if (chat.adv_title) {
        chatTitle = chat.adv_title;
    }

    if (userData && !userData.error) {
        if (userData.avatar) {
            avatarStyle = `background-image: url('${userData.avatar}')`;
        } else if (userData.first_name) {
            avatarContent = userData.first_name.charAt(0);
        } else {
            avatarContent = chat.chatType === 'renter' ? 'R' : 'O';
        }

        // Если нет заголовка объявления, используем имя пользователя
        if (!chat.adv_title) {
            if (userData.first_name && userData.last_name) {
                chatTitle = `${userData.first_name} ${userData.last_name}`;
            } else if (userData.first_name) {
                chatTitle = userData.first_name;
            } else if (userData.business_name) {
                chatTitle = userData.business_name;
            }
        }
    } else {
        // Fallback для случаев когда нет данных пользователя
        avatarContent = chat.chatType === 'renter' ? 'R' : 'O';
    }

    emptyState.style.display = 'none';
    chatWindow.innerHTML = `
        <div class="chat-header">
            <div class="avatar" style="${avatarStyle}">${avatarContent}</div>
            <div class="chat-title">${chatTitle}</div>
        </div>
        <div class="chat-messages" id="chat-messages"></div>
        <div class="chat-input">
            <input type="text" id="message-input" placeholder="Type a message...">
            <button id="send-message">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
            </button>
        </div>
    `;

    document.getElementById('send-message').addEventListener('click', () => {
        sendMessage();
    });

    document.getElementById('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
}

function fetchMessages(chatId, pivotId = null) {
    if (isLoadingMessages) {
        return;
    }

    isLoadingMessages = true;

    if (!pivotId) {
        noMoreMessages = false;
        oldestMessageId = null;
    }

    logToConsole(`Fetching messages for chat: ${chatId}${pivotId ? `, pivot_id: ${pivotId}` : ''}...`, 'info');

    let url = `${config.apiDomain}/messages/${chatId}?size=${messagesPageSize}`;
    if (pivotId) {
        url += `&pivot_id=${pivotId}`;
    }

    fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${authToken}`
        }
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.items && Array.isArray(data.items)) {
                if (data.items.length < messagesPageSize) {
                    noMoreMessages = true;
                    logToConsole('No more older messages available', 'info');
                }

                if (data.items.length === 0) {
                    noMoreMessages = true;
                    logToConsole('No messages found', 'info');
                    renderMessages([], !pivotId);
                } else {
                    data.items.sort((a, b) => {
                        return new Date(a.created_at) - new Date(b.created_at);
                    });

                    oldestMessageId = data.items[0].id;
                    renderMessages(data.items, !pivotId);
                    logToConsole(`Fetched ${data.items.length} messages`, 'success');
                }
            } else {
                logToConsole('No messages found or invalid response format', 'info');
                renderMessages([], !pivotId);
                noMoreMessages = true;
            }
        })
        .catch(error => {
            logToConsole(`Error fetching messages: ${error.message}`, 'error');
        })
        .finally(() => {
            isLoadingMessages = false;
        });
}

function renderMessages(messages, clearContainer = true) {
    const messagesContainer = document.getElementById('chat-messages');

    const scrollTop = messagesContainer.scrollTop;
    const scrollHeight = messagesContainer.scrollHeight;

    if (clearContainer) {
        messagesContainer.innerHTML = '';
    }

    if (messages.length === 0 && (clearContainer || messagesContainer.childNodes.length === 0)) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'empty-state';
        emptyMessage.style.padding = '20px';
        emptyMessage.innerHTML = '<p>No messages yet</p>';
        messagesContainer.appendChild(emptyMessage);
        return;
    }

    if (!clearContainer && messages.length === 0) {
        return;
    }

    let currentUserId = '';
    try {
        const base64Url = authToken.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(base64));
        currentUserId = payload.sub || '';
    } catch (e) {
        logToConsole('Could not parse JWT token for user ID', 'warning');
    }

    messages.sort((a, b) => {
        return new Date(a.created_at) - new Date(b.created_at);
    });

    const fragment = document.createDocumentFragment();

    messages.forEach(message => {
        const messageElement = document.createElement('div');
        const isSent = message.sender_id === currentUserId;
        messageElement.className = `message ${isSent ? 'sent' : 'received'}`;
        messageElement.dataset.messageId = message.id;

        const timestamp = formatTimestamp(new Date(message.created_at));

        messageElement.innerHTML = `
            <div class="message-content">${message.content}</div>
            <div class="message-time">${timestamp}</div>
        `;

        fragment.appendChild(messageElement);
    });

    if (clearContainer) {
        messagesContainer.appendChild(fragment);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } else {
        messagesContainer.insertBefore(fragment, messagesContainer.firstChild);
        const newScrollHeight = messagesContainer.scrollHeight;
        messagesContainer.scrollTop = scrollTop + (newScrollHeight - scrollHeight);
    }

    if (!noMoreMessages && !document.getElementById('load-more-indicator')) {
        const loadMoreIndicator = document.createElement('div');
        loadMoreIndicator.id = 'load-more-indicator';
        loadMoreIndicator.className = 'load-more-indicator';
        loadMoreIndicator.innerHTML = '<div class="spinner"></div>';
        messagesContainer.insertBefore(loadMoreIndicator, messagesContainer.firstChild);
    } else if (noMoreMessages) {
        const loadMoreIndicator = document.getElementById('load-more-indicator');
        if (loadMoreIndicator) {
            loadMoreIndicator.remove();
        }
    }
}

function setupScrollListener() {
    const messagesContainer = document.getElementById('chat-messages');
    messagesContainer.removeEventListener('scroll', handleScroll);
    messagesContainer.addEventListener('scroll', handleScroll);
}

function handleScroll() {
    const messagesContainer = document.getElementById('chat-messages');

    if (messagesContainer.scrollTop < 50 && !isLoadingMessages && !noMoreMessages && activeChat) {
        if (oldestMessageId) {
            logToConsole(`Loading more messages before message #${oldestMessageId}`, 'info');
            fetchMessages(activeChat.id, oldestMessageId);
        }
    }
}

function sendMessage() {
    if (!activeChat) {
        logToConsole('No active chat selected', 'warning');
        return;
    }

    const messageInput = document.getElementById('message-input');
    const messageText = messageInput.value.trim();

    if (!messageText) {
        return;
    }

    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
        logToConsole('WebSocket connection is not open', 'error');
        connectWebSocket();
        return;
    }

    ensureValidToken()
        .then(() => {
            const message = {
                type: 'message',
                event_data: {
                    chat_id: activeChat.id,
                    message: {
                        content: messageText
                    }
                }
            };

            wsConnection.send(JSON.stringify(message));
            logToConsole(`Message sent: ${messageText}`, 'info');
            messageInput.value = '';

            const now = new Date();

            // Обновляем активный чат с правильными полями
            activeChat.last_message_text = messageText;
            activeChat.last_message_time = now.toISOString();
            activeChat.read = true;

            // Обновляем чат в списке
            const chatIndex = chatList.findIndex(chat => chat.id === activeChat.id);
            if (chatIndex !== -1) {
                chatList[chatIndex].last_message_text = messageText;
                chatList[chatIndex].last_message_time = now.toISOString();
                chatList[chatIndex].read = true;
            }
        })
        .catch(error => {
            logToConsole(`Error refreshing token before sending message: ${error.message}`, 'error');
        });
}

function connectWebSocket() {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        wsConnection.close();
        clearInterval(pingInterval);
    }

    if (!authToken) {
        logToConsole('Cannot connect to WebSocket: No authentication token available', 'error');
        return;
    }

    logToConsole(`Connecting to WebSocket: ${config.wsDomain}...`, 'info');

    try {
        let wsUrlString = config.wsDomain;

        if (!wsUrlString.includes('?')) {
            wsUrlString += '?';
        } else if (!wsUrlString.endsWith('&') && !wsUrlString.endsWith('?')) {
            wsUrlString += '&';
        }

        wsUrlString += `token=${encodeURIComponent(authToken)}`;

        logToConsole(`Connecting with token in URL: ${wsUrlString}`, 'info');

        wsConnection = new WebSocket(wsUrlString);

        wsConnection.onopen = () => {
            logToConsole('WebSocket connection established', 'success');

            pingInterval = setInterval(() => {
                if (wsConnection.readyState === WebSocket.OPEN) {
                    const pingMessage = {
                        type: 'ping',
                        event_data: {
                            time: new Date().toISOString()
                        }
                    };
                    wsConnection.send(JSON.stringify(pingMessage));
                    logToConsole('Ping sent', 'info');
                }
            }, 30000);
        };

        wsConnection.onmessage = (event) => {
            const data = JSON.parse(event.data);
            logToConsole(`WebSocket message received: ${event.data}`, 'info');

            if (data.type === 'pong') {
                logToConsole('Pong received', 'info');
            } else if (data.type === 'message') {
                // Получаем текущий ID пользователя для определения направления сообщения
                let currentUserId = '';
                try {
                    const base64Url = authToken.split('.')[1];
                    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                    const payload = JSON.parse(atob(base64));
                    currentUserId = payload.sub || '';
                } catch (e) {
                    logToConsole('Could not parse JWT token for user ID', 'warning');
                }

                const messageData = data.event_data.message;
                const chatId = data.event_data.chat_id;
                const isSelfMessage = messageData.sender_id === currentUserId;

                logToConsole(`Received message from ${isSelfMessage ? 'self' : 'other'}: ${messageData.content}`, 'info');

                // Находим чат в списке
                const chatIndex = chatList.findIndex(chat => chat.id == chatId); // Используем == для сравнения string и number

                if (chatIndex === -1) {
                    logToConsole('Received message for a chat not in the list, refreshing chat list', 'info');
                    ensureValidToken().then(() => fetchChats());
                    return;
                }

                // Обновляем данные чата в списке
                const timestamp = new Date(messageData.created_at);
                chatList[chatIndex].last_message_text = messageData.content;
                chatList[chatIndex].last_message_time = timestamp.toISOString();

                // Если сообщение от нас, то оно считается прочитанным
                // Если от собеседника и чат не активен, то непрочитанным
                if (isSelfMessage) {
                    chatList[chatIndex].read = true;
                } else if (!activeChat || activeChat.id != chatId) {
                    chatList[chatIndex].read = false;
                } else {
                    // Если чат активен и сообщение от собеседника, сразу помечаем как прочитанное
                    chatList[chatIndex].read = true;
                }

                // Перерисовываем список чатов
                renderChatList();

                // Если чат активен, добавляем сообщение в UI
                if (activeChat && activeChat.id == chatId) {
                    const messagesContainer = document.getElementById('chat-messages');
                    if (messagesContainer) {
                        const messageElement = document.createElement('div');
                        messageElement.className = `message ${isSelfMessage ? 'sent' : 'received'}`;
                        messageElement.dataset.messageId = messageData.id;

                        const formattedTimestamp = formatTimestamp(timestamp);

                        messageElement.innerHTML = `
                            <div class="message-content">${messageData.content}</div>
                            <div class="message-time">${formattedTimestamp}</div>
                        `;

                        messagesContainer.appendChild(messageElement);
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;

                        // Если сообщение от собеседника и чат активен, отмечаем как прочитанное
                        if (!isSelfMessage) {
                            window.pendingChatListUpdate = true;
                            markChatAsRead(chatId);
                        }
                    }
                } else if (!isSelfMessage) {
                    // Если чат не активен и сообщение от собеседника, показываем тост
                    showToast(chatList[chatIndex], messageData.content);
                }

                // Обновляем активный чат если он совпадает
                if (activeChat && activeChat.id == chatId) {
                    activeChat.last_message_text = messageData.content;
                    activeChat.last_message_time = timestamp.toISOString();
                    activeChat.read = isSelfMessage || true; // Наши сообщения или активный чат всегда прочитан
                }
            } else if (data.type === 'read') {
                logToConsole('Message read confirmation received', 'info');
                if (!window.pendingChatListUpdate) {
                    fetchChats();
                }
                window.pendingChatListUpdate = false;
            }
        };

        wsConnection.onclose = () => {
            logToConsole('WebSocket connection closed', 'warning');
            clearInterval(pingInterval);
        };

        wsConnection.onerror = (error) => {
            logToConsole(`WebSocket error: ${error}`, 'error');
        };

    } catch (error) {
        logToConsole(`Failed to connect to WebSocket: ${error.message}`, 'error');
    }
}

function formatTimestamp(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function logToConsole(message, type = 'info') {
    const logElement = document.createElement('div');
    logElement.className = `log ${type}`;
    logElement.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    debugConsole.appendChild(logElement);
    debugConsole.scrollTop = debugConsole.scrollHeight;
}

function getAuthToken() {
    logToConsole('Getting authentication token...', 'info');

    const baseDomain = config.apiDomain.replace(/\/chat$/, '');
    const refreshTokenUrl = `${baseDomain}/client/auth/refresh-token`;

    return fetch(refreshTokenUrl, {
        method: 'GET',
        headers: {
            'Accept': 'application/json'
        },
        credentials: 'include'
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            if (data.access_token) {
                authToken = data.access_token;

                try {
                    const base64Url = authToken.split('.')[1];
                    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                    const payload = JSON.parse(atob(base64));
                    tokenExpiry = payload.exp * 1000;

                    logToConsole(`Token acquired, expires: ${new Date(tokenExpiry).toLocaleString()}`, 'success');
                } catch (e) {
                    tokenExpiry = Date.now() + (15 * 60 * 1000);
                    logToConsole('Could not parse token expiry, using default (15min)', 'warning');
                }

                return authToken;
            } else {
                throw new Error('Invalid token response');
            }
        });
}

function ensureValidToken() {
    const isTokenValid = authToken && tokenExpiry > (Date.now() + 30000);

    if (isTokenValid) {
        return Promise.resolve(authToken);
    } else {
        logToConsole('Token expired or invalid, refreshing...', 'info');
        return getAuthToken();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    init();
    setActiveTab('renter');

    getAuthToken()
        .then(() => {
            logToConsole('Automatically authenticated', 'success');
            connectWebSocket();
            fetchChats();
        })
        .catch(error => {
            logToConsole(`Auto-authentication failed: ${error.message}`, 'warning');
            logToConsole('Click "Save Settings & Connect" to try again', 'info');
        });
});