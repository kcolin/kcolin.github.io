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
let activeTab = 'renter'; // Default tab

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

let toastTimeout = 5000; // Время показа тоста в миллисекундах
let toasts = []; // Массив для отслеживания активных тостов

// Функция для создания и отображения тоста
function showToast(chat, message) {
    const toastContainer = document.getElementById('toast-container');
    if (!toastContainer) {
        logToConsole('Toast container not found', 'error');
        return;
    }

    // Получаем данные пользователя для аватара
    const userData = userCache[chat.user_id] || {};

    // Определяем заголовок и аватар для тоста
    let chatTitle = "New message";
    let avatarContent = "";
    let avatarStyle = "";

    if (chat.adv_title) {
        chatTitle = chat.adv_title;
    }

    if (userData) {
        // Создаем содержимое аватара
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
    }

    // Создаем элемент тоста
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

    // Добавляем обработчик для перехода к чату при клике на тост
    toast.addEventListener('click', (e) => {
        // Игнорируем клик по кнопке закрытия
        if (e.target.className === 'toast-close') return;

        // Находим чат по ID и открываем его
        const chatToOpen = chatList.find(c => c.id === chat.id);
        if (chatToOpen) {
            selectChat(chatToOpen);
            removeToast(toast); // Удаляем тост после перехода
        }
    });

    // Добавляем обработчик для кнопки закрытия
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // Предотвращаем всплытие события
        removeToast(toast);
    });

    // Добавляем тост в контейнер
    toastContainer.appendChild(toast);

    // Добавляем тост в массив активных тостов
    toasts.push(toast);

    // Воспроизводим звук уведомления
    playNotificationSound();

    // Устанавливаем таймер для автоматического закрытия тоста
    setTimeout(() => {
        removeToast(toast);
    }, toastTimeout);
}

// Функция для удаления тоста
function removeToast(toast) {
    // Проверяем, существует ли еще тост в DOM
    if (!toast || !toast.parentNode) return;

    // Добавляем анимацию исчезновения
    toast.style.animation = 'fadeOut 0.3s forwards';

    // Удаляем тост после завершения анимации
    setTimeout(() => {
        if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
        }

        // Удаляем тост из массива активных тостов
        const index = toasts.indexOf(toast);
        if (index !== -1) {
            toasts.splice(index, 1);
        }
    }, 300);
}

// Функция для воспроизведения звука уведомления
function playNotificationSound() {
    const sound = document.getElementById('notification-sound');
    if (sound) {
        // Перематываем звук в начало (если он уже проигрывался)
        sound.currentTime = 0;

        // Воспроизводим звук
        sound.play().catch(error => {
            // Обрабатываем ошибки воспроизведения (например, если браузер блокирует автовоспроизведение)
            logToConsole(`Error playing notification sound: ${error.message}`, 'warning');
        });
    } else {
        logToConsole('Notification sound element not found', 'warning');
    }
}

// Initialize the application
function init() {
    // Инициализируем глобальную переменную для отслеживания ожидающих обновлений списка чатов
    window.pendingChatListUpdate = false;

    loadConfig();
    bindEventListeners();
    applyConfig();
    logToConsole('Application initialized', 'info');
}

// Load configuration from localStorage
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

// Save configuration to localStorage
function saveConfig() {
    config.apiDomain = apiDomainInput.value.trim();
    config.wsDomain = wsDomainInput.value.trim();

    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    logToConsole('Configuration saved', 'success');
}

// Apply configuration to form inputs
function applyConfig() {
    apiDomainInput.value = config.apiDomain;
    wsDomainInput.value = config.wsDomain;
}

// Bind event listeners
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

    // Add tab switching event listeners
    const tabRenter = document.getElementById('tab-renter');
    const tabOwner = document.getElementById('tab-owner');

    tabRenter.addEventListener('click', () => {
        setActiveTab('renter');
    });

    tabOwner.addEventListener('click', () => {
        setActiveTab('owner');
    });
}

// Set active tab and update UI
function setActiveTab(tabName) {
    activeTab = tabName;

    // Update tab UI
    const tabRenter = document.getElementById('tab-renter');
    const tabOwner = document.getElementById('tab-owner');

    if (activeTab === 'renter') {
        tabRenter.classList.add('active');
        tabOwner.classList.remove('active');
    } else {
        tabRenter.classList.remove('active');
        tabOwner.classList.add('active');
    }

    // Show only chats for the selected tab
    renderChatList();
}

// Create a new chat with the given advertisement ID
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

// Fetch the list of chats
function fetchChats() {
    logToConsole('Fetching chats...', 'info');

    // Clear existing chats before fetching new ones
    chatList = [];

    // Fetch renter chats
    fetchChatType('renter')
        .then(() => {
            // Then fetch owner chats
            return fetchChatType('owner');
        })
        .then(() => {
            // After fetching all chats, fetch additional user data needed for display
            return fetchUserData();
        })
        .then(() => {
            renderChatList();
        })
        .catch(error => {
            logToConsole(`Error fetching chats: ${error.message}`, 'error');
        });
}

// Fetch chats by type (renter or owner)
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
            // Process chat data
            if (data.items && Array.isArray(data.items)) {
                // Add a type property to distinguish between renter and owner chats
                const typedChats = data.items.map(chat => ({ ...chat, chatType: type }));

                // Add chats to the list
                chatList = [...chatList, ...typedChats];
                logToConsole(`Fetched ${typedChats.length} ${type} chats`, 'success');
            } else {
                logToConsole(`No ${type} chats found or invalid response format`, 'info');
            }
        });
}

// Fetch user data for all chats
async function fetchUserData() {
    // Collect unique user IDs
    const userIds = new Set();

    chatList.forEach(chat => {
        if (chat.user_id) userIds.add(chat.user_id);
    });

    // Fetch data for users that aren't already in the cache
    const userPromises = Array.from(userIds)
        .filter(userId => !userCache[userId])
        .map(userId => fetchUserInfo(userId));

    // Wait for all fetches to complete
    await Promise.all(userPromises);

    logToConsole(`Fetched additional data for ${userPromises.length} users`, 'success');
}

// Fetch user information from the API
function fetchUserInfo(userId) {
    // Get the base API domain (remove /chat suffix if present)
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
            // Add a placeholder in the cache so we don't try to fetch again
            userCache[userId] = { error: true };
        });
}

// Render the chat list in the UI
function renderChatList() {
    chatListContainer.innerHTML = '';

    // Filter chats based on active tab
    const filteredChats = chatList.filter(chat => chat.chatType === activeTab);

    if (filteredChats.length === 0) {
        const emptyItem = document.createElement('div');
        emptyItem.className = 'chat-item';
        emptyItem.innerHTML = '<div class="chat-info"><div class="chat-title">No chats found</div></div>';
        chatListContainer.appendChild(emptyItem);
        return;
    }

    // Сортируем чаты по времени последнего сообщения (сначала новые)
    filteredChats.sort((a, b) => {
        const timeA = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const timeB = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return timeB - timeA;
    });

    filteredChats.forEach(chat => {
        const chatItem = document.createElement('div');
        chatItem.className = 'chat-item';
        if (activeChat && chat.id === activeChat.id) {
            chatItem.className += ' active';
        }

        // Get user data for avatar and name
        const userData = userCache[chat.user_id] || {};

        // Determine chat title - use adv_title if available, otherwise use user name
        let chatTitle = "Chat";
        let avatarContent = "";
        let avatarStyle = "";

        if (chat.adv_title) {
            chatTitle = chat.adv_title;
        }

        if (userData) {
            // Create avatar content
            if (userData.avatar) {
                avatarStyle = `background-image: url('${userData.avatar}')`;
            } else if (userData.first_name) {
                avatarContent = userData.first_name.charAt(0);
            } else {
                avatarContent = chat.chatType === 'renter' ? 'R' : 'O';
            }

            // If no adv title, use user name
            if (!chat.adv_title) {
                if (userData.first_name && userData.last_name) {
                    chatTitle = `${userData.first_name} ${userData.last_name}`;
                } else if (userData.first_name) {
                    chatTitle = userData.first_name;
                } else if (userData.business_name) {
                    chatTitle = userData.business_name;
                }
            }
        }

        const lastMessage = chat.last_message || 'No messages yet';
        const timestamp = chat.last_message_at ? formatTimestamp(new Date(chat.last_message_at)) : '';

        chatItem.innerHTML = `
            <div class="avatar" style="${avatarStyle}">${avatarContent}</div>
            <div class="chat-info">
                <div class="chat-header">
                    <div class="chat-title">${chatTitle}</div>
                    <div class="chat-time">${timestamp}</div>
                </div>
                <div class="chat-last-message">${lastMessage}</div>
            </div>
            ${!chat.read ? '<div class="unread-indicator"></div>' : ''}
        `;

        chatItem.addEventListener('click', () => {
            selectChat(chat);
        });

        chatListContainer.appendChild(chatItem);
    });
}

// Select and activate a chat
function selectChat(chat) {
    activeChat = chat;
    renderChatList(); // Update active state in the list
    renderChatWindow(chat);

    // Сначала отмечаем чат как прочитанный
    markChatAsRead(chat.id);

    // Затем загружаем сообщения
    fetchMessages(chat.id);
}

// Mark chat messages as read
function markChatAsRead(chatId) {
    if (!wsConnection) {
        logToConsole('WebSocket connection does not exist, attempting to reconnect...', 'warning');
        ensureValidToken()
            .then(() => {
                connectWebSocket();
                setTimeout(() => markChatAsRead(chatId), 1000); // Попробуем снова через секунду
            })
            .catch(error => {
                logToConsole(`Error refreshing token for markChatAsRead: ${error.message}`, 'error');
            });
        return;
    }

    if (wsConnection.readyState !== WebSocket.OPEN) {
        logToConsole(`WebSocket connection is not open (state: ${wsConnection.readyState}), cannot mark messages as read`, 'warning');

        // Если соединение закрыто (readyState === 3), попытаемся переподключиться
        if (wsConnection.readyState === WebSocket.CLOSED) {
            logToConsole('Attempting to reconnect WebSocket...', 'info');
            ensureValidToken()
                .then(() => {
                    connectWebSocket();
                    setTimeout(() => markChatAsRead(chatId), 1000); // Попробуем снова через секунду
                })
                .catch(error => {
                    logToConsole(`Error refreshing token for reconnection: ${error.message}`, 'error');
                });
        }
        return;
    }

    const readMessage = {
        type: 'read',
        chat_id: chatId
    };

    try {
        wsConnection.send(JSON.stringify(readMessage));
        logToConsole(`Marked chat ${chatId} as read`, 'info');

        // Обновляем локальное состояние чата, чтобы сразу показать, что чат прочитан
        // Это сделает UI более отзывчивым, не дожидаясь обновления с сервера
        if (activeChat && activeChat.id === chatId) {
            activeChat.read = true;
        }

        // Обновляем индикатор в списке чатов
        chatList.forEach(chat => {
            if (chat.id === chatId) {
                chat.read = true;
            }
        });

        // Перерисовываем список чатов с обновленным состоянием
        renderChatList();
    } catch (error) {
        logToConsole(`Error sending read event: ${error.message}`, 'error');
    }
}

// Render the active chat window
function renderChatWindow(chat) {
    // Get user data for avatar and name
    const userData = userCache[chat.user_id] || {};

    // Determine chat title and avatar
    let chatTitle = "Chat";
    let avatarContent = "";
    let avatarStyle = "";

    if (chat.adv_title) {
        chatTitle = chat.adv_title;
    }

    if (userData) {
        // Create avatar content
        if (userData.avatar) {
            avatarStyle = `background-image: url('${userData.avatar}')`;
        } else if (userData.first_name) {
            avatarContent = userData.first_name.charAt(0);
        } else {
            avatarContent = chat.chatType === 'renter' ? 'R' : 'O';
        }

        // If no adv title, use user name
        if (!chat.adv_title) {
            if (userData.first_name && userData.last_name) {
                chatTitle = `${userData.first_name} ${userData.last_name}`;
            } else if (userData.first_name) {
                chatTitle = userData.first_name;
            } else if (userData.business_name) {
                chatTitle = userData.business_name;
            }
        }
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

    // Add event listener for sending messages
    document.getElementById('send-message').addEventListener('click', () => {
        sendMessage();
    });

    document.getElementById('message-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
}

// Fetch messages for the active chat
function fetchMessages(chatId) {
    logToConsole(`Fetching messages for chat: ${chatId}...`, 'info');

    fetch(`${config.apiDomain}/messages/${chatId}`, {
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
                renderMessages(data.items);
                logToConsole(`Fetched ${data.items.length} messages`, 'success');
            } else {
                logToConsole('No messages found or invalid response format', 'info');
                renderMessages([]);
            }
        })
        .catch(error => {
            logToConsole(`Error fetching messages: ${error.message}`, 'error');
        });
}

// Render messages in the chat window
function renderMessages(messages) {
    const messagesContainer = document.getElementById('chat-messages');
    messagesContainer.innerHTML = '';

    if (messages.length === 0) {
        const emptyMessage = document.createElement('div');
        emptyMessage.className = 'empty-state';
        emptyMessage.style.padding = '20px';
        emptyMessage.innerHTML = '<p>No messages yet</p>';
        messagesContainer.appendChild(emptyMessage);
        return;
    }

    // Get the JWT payload to identify the current user
    let currentUserId = '';
    try {
        const base64Url = authToken.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(base64));
        currentUserId = payload.sub || '';
    } catch (e) {
        logToConsole('Could not parse JWT token for user ID', 'warning');
    }

    // Sort messages by created_at timestamp in ascending order (oldest first)
    messages.sort((a, b) => {
        return new Date(a.created_at) - new Date(b.created_at);
    });

    messages.forEach(message => {
        const messageElement = document.createElement('div');
        const isSent = message.sender_id === currentUserId;
        messageElement.className = `message ${isSent ? 'sent' : 'received'}`;

        const timestamp = formatTimestamp(new Date(message.created_at));

        messageElement.innerHTML = `
            <div class="message-content">${message.text}</div>
            <div class="message-time">${timestamp}</div>
        `;

        messagesContainer.appendChild(messageElement);
    });

    // Scroll to the bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Send a message in the active chat
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
                type: 'sendMessage',
                chat_id: activeChat.id,
                payload: {
                    text: messageText
                }
            };

            wsConnection.send(JSON.stringify(message));
            logToConsole(`Message sent: ${messageText}`, 'info');
            messageInput.value = '';

            // Оптимистично обновляем данные чата
            const now = new Date();

            // Обновляем активный чат
            activeChat.last_message = messageText;
            activeChat.last_message_at = now.toISOString();
            activeChat.read = true; // Наши собственные сообщения всегда прочитаны

            // Обновляем чат в списке
            const chatIndex = chatList.findIndex(chat => chat.id === activeChat.id);
            if (chatIndex !== -1) {
                chatList[chatIndex].last_message = messageText;
                chatList[chatIndex].last_message_at = now.toISOString();
                chatList[chatIndex].read = true;
            }

            // Перерисовываем список чатов
            renderChatList();

            // Оптимистично добавляем сообщение в UI
            const messagesContainer = document.getElementById('chat-messages');
            const messageElement = document.createElement('div');
            messageElement.className = 'message sent';

            const timestamp = formatTimestamp(now);

            messageElement.innerHTML = `
                <div class="message-content">${messageText}</div>
                <div class="message-time">${timestamp}</div>
            `;

            messagesContainer.appendChild(messageElement);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        })
        .catch(error => {
            logToConsole(`Error refreshing token before sending message: ${error.message}`, 'error');
        });
}

// Connect to the WebSocket server
function connectWebSocket() {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        wsConnection.close();
        clearInterval(pingInterval);
    }

    // Check if we have a valid token first
    if (!authToken) {
        logToConsole('Cannot connect to WebSocket: No authentication token available', 'error');
        return;
    }

    logToConsole(`Connecting to WebSocket: ${config.wsDomain}...`, 'info');

    try {
        // For WebSockets, we need to manually construct the URL with authentication
        // Since we can't set headers directly with the WebSocket API
        let wsUrlString = config.wsDomain;

        // Add the token to the URL as a query parameter if it doesn't have one already
        if (!wsUrlString.includes('?')) {
            wsUrlString += '?';
        } else if (!wsUrlString.endsWith('&') && !wsUrlString.endsWith('?')) {
            wsUrlString += '&';
        }

        wsUrlString += `token=${encodeURIComponent(authToken)}`;

        logToConsole(`Connecting with token in URL: ${wsUrlString}`, 'info');

        // Create WebSocket connection with token in URL
        wsConnection = new WebSocket(wsUrlString);

        wsConnection.onopen = () => {
            logToConsole('WebSocket connection established', 'success');

            // Setup ping interval
            pingInterval = setInterval(() => {
                if (wsConnection.readyState === WebSocket.OPEN) {
                    const pingMessage = {
                        type: 'ping'
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
            } else if (data.type === 'readed') {
                logToConsole('Message read confirmation received', 'info');
                // Update chat list to reflect read status
                // Обновляем список чатов только если не ожидаем обновления от получения сообщения
                if (!window.pendingChatListUpdate) {
                    fetchChats();
                }
                window.pendingChatListUpdate = false;
            } else if (data.type === 'recvMsg' || data.type === 'recvMessage') { // Поддержка обоих типов сообщений
                // Get the JWT payload to identify the current user
                let currentUserId = '';
                try {
                    const base64Url = authToken.split('.')[1];
                    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                    const payload = JSON.parse(atob(base64));
                    currentUserId = payload.sub || '';
                } catch (e) {
                    logToConsole('Could not parse JWT token for user ID', 'warning');
                }

                // Проверяем, является ли отправитель текущим пользователем
                const isSelfMessage = data.payload.sender === currentUserId;

                if (isSelfMessage) {
                    logToConsole('Received confirmation of our own message', 'info');
                    // Не добавляем сообщение в UI и не показываем тост, так как это наше собственное сообщение
                } else {
                    // Находим чат в списке чатов
                    const chatIndex = chatList.findIndex(chat => chat.id === data.chat_id);

                    if (chatIndex === -1) {
                        // Если чата нет в списке, обновляем весь список через API
                        logToConsole('Received message for a chat not in the list, refreshing chat list', 'info');
                        ensureValidToken().then(() => fetchChats());
                        return;
                    }

                    // Локально обновляем информацию в чате
                    const timestamp = data.meta && data.meta.created_at ? new Date(data.meta.created_at) : new Date();

                    // Обновляем данные чата
                    chatList[chatIndex].last_message = data.payload.text;
                    chatList[chatIndex].last_message_at = timestamp.toISOString();

                    // Если сообщение не от нас, помечаем как непрочитанное
                    chatList[chatIndex].read = false;

                    // Перерисовываем список чатов с обновленными данными
                    renderChatList();

                    if (activeChat && data.chat_id === activeChat.id) {
                        // Если чат активен, добавляем сообщение в UI
                        const messagesContainer = document.getElementById('chat-messages');
                        const messageElement = document.createElement('div');
                        messageElement.className = 'message received';

                        const formattedTimestamp = formatTimestamp(timestamp);

                        messageElement.innerHTML = `
                    <div class="message-content">${data.payload.text}</div>
                    <div class="message-time">${formattedTimestamp}</div>
                `;

                        messagesContainer.appendChild(messageElement);
                        messagesContainer.scrollTop = messagesContainer.scrollHeight;

                        // Mark the message as read since we're in the chat
                        window.pendingChatListUpdate = true; // Устанавливаем флаг ожидания обновления
                        markChatAsRead(data.chat_id);
                    } else {
                        // Если чат не активен, показываем тост с уведомлением
                        showToast(chatList[chatIndex], data.payload.text);
                    }
                }
            }
        };
    } catch (error) {
        logToConsole(`Failed to connect to WebSocket: ${error.message}`, 'error');
    }

    wsConnection.onclose = () => {
        logToConsole('WebSocket connection closed', 'warning');
        clearInterval(pingInterval);
    };

    wsConnection.onerror = (error) => {
        logToConsole(`WebSocket error: ${error}`, 'error');
    };
}

// Helper function to format timestamps
function formatTimestamp(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Log messages to the debug console
function logToConsole(message, type = 'info') {
    const logElement = document.createElement('div');
    logElement.className = `log ${type}`;
    logElement.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    debugConsole.appendChild(logElement);
    debugConsole.scrollTop = debugConsole.scrollHeight;
}

// Get authentication token from server
function getAuthToken() {
    logToConsole('Getting authentication token...', 'info');

    // Get the base API domain (remove /chat suffix if present)
    const baseDomain = config.apiDomain.replace(/\/chat$/, '');
    const refreshTokenUrl = `${baseDomain}/client/auth/refresh-token`;

    // Make a GET request to the authentication endpoint with credentials
    return fetch(refreshTokenUrl, {
        method: 'GET',
        headers: {
            'Accept': 'application/json'
        },
        credentials: 'include' // Include cookies
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

                // Parse JWT to get expiration time
                try {
                    const base64Url = authToken.split('.')[1];
                    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
                    const payload = JSON.parse(atob(base64));
                    tokenExpiry = payload.exp * 1000; // Convert to milliseconds

                    logToConsole(`Token acquired, expires: ${new Date(tokenExpiry).toLocaleString()}`, 'success');
                } catch (e) {
                    // If we can't parse the token, set a default expiry (15 minutes)
                    tokenExpiry = Date.now() + (15 * 60 * 1000);
                    logToConsole('Could not parse token expiry, using default (15min)', 'warning');
                }

                return authToken;
            } else {
                throw new Error('Invalid token response');
            }
        });
}

// Check if token is valid and refresh if needed
function ensureValidToken() {
    // Token is considered invalid if we don't have one or it expires in less than 30 seconds
    const isTokenValid = authToken && tokenExpiry > (Date.now() + 30000);

    if (isTokenValid) {
        return Promise.resolve(authToken);
    } else {
        logToConsole('Token expired or invalid, refreshing...', 'info');
        return getAuthToken();
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    init();

    // Set initial tab state
    setActiveTab('renter');

    // Attempt to get a token automatically
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