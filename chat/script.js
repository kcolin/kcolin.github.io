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
    fetchMessages(chat.id);

    // Mark messages as read when selecting a chat
    markChatAsRead(chat.id);
}

// Mark chat messages as read
function markChatAsRead(chatId) {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
        logToConsole('WebSocket connection is not open, cannot mark messages as read', 'error');
        return;
    }

    const readMessage = {
        type: 'read',
        chat_id: chatId
    };

    wsConnection.send(JSON.stringify(readMessage));
    logToConsole(`Marked chat ${chatId} as read`, 'info');
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

            // Optimistically add the message to the UI
            const messagesContainer = document.getElementById('chat-messages');
            const messageElement = document.createElement('div');
            messageElement.className = 'message sent';

            const timestamp = formatTimestamp(new Date());

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
                if (activeChat && data.chat_id === activeChat.id) {
                    // Update the messages display if this is for the active chat
                    const messagesContainer = document.getElementById('chat-messages');
                    const messageElement = document.createElement('div');
                    messageElement.className = 'message received';

                    const timestamp = data.meta && data.meta.created_at ?
                        formatTimestamp(new Date(data.meta.created_at)) :
                        formatTimestamp(new Date());

                    messageElement.innerHTML = `
                        <div class="message-content">${data.payload.text}</div>
                        <div class="message-time">${timestamp}</div>
                    `;

                    messagesContainer.appendChild(messageElement);
                    messagesContainer.scrollTop = messagesContainer.scrollHeight;

                    // Mark the message as read since we're in the chat
                    window.pendingChatListUpdate = true; // Устанавливаем флаг ожидания обновления
                    markChatAsRead(data.chat_id);
                } else {
                    // Если чат не активен, просто обновляем список чатов
                    ensureValidToken().then(() => fetchChats());
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