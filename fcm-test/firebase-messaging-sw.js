// Firebase Messaging Service Worker

importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

// Конфигурации Firebase для разных окружений
const firebaseConfigs = {
    dev: {
        apiKey: "AIzaSyCs84Ur0gz4qCXcHViv-wH4hbU6Y1SO9IE",
        authDomain: "dev-volos-rent.firebaseapp.com",
        projectId: "dev-volos-rent",
        storageBucket: "dev-volos-rent.firebasestorage.app",
        messagingSenderId: "84722802575",
        appId: "1:84722802575:web:56a1d0afdf27102d6cb5fa"
    },
    prod: {
        apiKey: "AIzaSyAalCX2FgJioQ1iWBn26_gmk5Mh89UGpTo",
        authDomain: "volos-rent-357a1.firebaseapp.com",
        projectId: "volos-rent-357a1",
        storageBucket: "volos-rent-357a1.firebasestorage.app",
        messagingSenderId: "512437606780",
        appId: "1:512437606780:web:fa8e8f14a7e6fc48efacf9"
    }
};

// Инициализируем оба приложения Firebase
const apps = {};

// Инициализация dev приложения
apps.dev = firebase.initializeApp(firebaseConfigs.dev, 'dev');
const messagingDev = firebase.messaging(apps.dev);

// Инициализация prod приложения
apps.prod = firebase.initializeApp(firebaseConfigs.prod, 'prod');
const messagingProd = firebase.messaging(apps.prod);

// Функция определения окружения по sender ID
function getEnvironmentBySenderId(senderId) {
    if (senderId === firebaseConfigs.dev.messagingSenderId) {
        return 'dev';
    } else if (senderId === firebaseConfigs.prod.messagingSenderId) {
        return 'prod';
    }
    return 'unknown';
}

// Обработка сообщений в фоновом режиме для DEV
messagingDev.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Получено фоновое сообщение DEV', payload);

    const notificationTitle = `[DEV] ${payload.notification.title || 'Уведомление'}`;
    const notificationOptions = {
        body: payload.notification.body || 'Новое уведомление',
        icon: payload.notification.icon || '/favicon.ico',
        badge: '/favicon.ico',
        tag: `dev-${Date.now()}`,
        data: {
            ...payload.data,
            environment: 'dev'
        }
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

// Обработка сообщений в фоновом режиме для PROD
messagingProd.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Получено фоновое сообщение PROD', payload);

    const notificationTitle = `[PROD] ${payload.notification.title || 'Уведомление'}`;
    const notificationOptions = {
        body: payload.notification.body || 'Новое уведомление',
        icon: payload.notification.icon || '/favicon.ico',
        badge: '/favicon.ico',
        tag: `prod-${Date.now()}`,
        data: {
            ...payload.data,
            environment: 'prod'
        }
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

// Обработка клика по уведомлению
self.addEventListener('notificationclick', (event) => {
    console.log('[firebase-messaging-sw.js] Клик по уведомлению', event);

    // Закрываем уведомление
    event.notification.close();

    // Получаем окружение из данных уведомления
    const environment = event.notification.data && event.notification.data.environment || 'unknown';
    console.log(`[firebase-messaging-sw.js] Окружение уведомления: ${environment}`);

    // Действие при клике (например, переход на определенную страницу)
    const urlToOpen = event.notification.data && event.notification.data.url
        ? event.notification.data.url
        : self.location.origin;

    const promiseChain = clients.matchAll({
        type: 'window',
        includeUncontrolled: true
    })
        .then((windowClients) => {
            // Проверяем, есть ли уже открытая вкладка
            let matchingClient = null;

            for (let i = 0; i < windowClients.length; i++) {
                const windowClient = windowClients[i];
                // Проверяем, открыт ли наш сайт
                if (windowClient.url.startsWith(self.location.origin)) {
                    matchingClient = windowClient;
                    break;
                }
            }

            // Если вкладка уже открыта, фокусируемся на ней
            if (matchingClient) {
                // Отправляем информацию о клике клиенту
                matchingClient.postMessage({
                    type: 'NOTIFICATION_CLICKED',
                    environment: environment,
                    data: event.notification.data
                });
                return matchingClient.focus();
            } else {
                // Иначе открываем новую вкладку
                return clients.openWindow(urlToOpen);
            }
        });

    event.waitUntil(promiseChain);
});

// Обработчик сообщений от страницы
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'NOTIFICATION_RECEIVED') {
        // Отправляем сообщение всем клиентам
        self.clients.matchAll().then(clients => {
            clients.forEach(client => {
                client.postMessage({
                    type: 'NOTIFICATION_RECEIVED',
                    notification: event.data.notification,
                    environment: event.data.environment || 'unknown'
                });
            });
        });
    }
});

// Установка service worker
self.addEventListener('install', (event) => {
    console.log('[firebase-messaging-sw.js] Service Worker установлен');
    self.skipWaiting();
});

// Активация service worker
self.addEventListener('activate', (event) => {
    console.log('[firebase-messaging-sw.js] Service Worker активирован');
    return self.clients.claim();
});

// Обработка push событий (для старых версий браузеров)
self.addEventListener('push', (event) => {
    console.log('[firebase-messaging-sw.js] Push событие получено', event);

    if (event.data) {
        try {
            const data = event.data.json();
            const senderId = data.from;
            const environment = getEnvironmentBySenderId(senderId);

            console.log(`[firebase-messaging-sw.js] Push от ${environment} окружения`);

            // Показываем уведомление с информацией об окружении
            const notificationTitle = `[${environment.toUpperCase()}] ${data.notification?.title || 'Push уведомление'}`;
            const notificationOptions = {
                body: data.notification?.body || 'Новое push уведомление',
                icon: data.notification?.icon || '/favicon.ico',
                badge: '/favicon.ico',
                tag: `${environment}-${Date.now()}`,
                data: {
                    ...data.data,
                    environment: environment
                }
            };

            event.waitUntil(
                self.registration.showNotification(notificationTitle, notificationOptions)
            );
        } catch (error) {
            console.error('[firebase-messaging-sw.js] Ошибка обработки push события:', error);
        }
    }
});