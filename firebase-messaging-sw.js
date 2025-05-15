// Firebase Messaging Service Worker

importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/8.10.1/firebase-messaging.js');

// Конфигурация Firebase (должна совпадать с конфигурацией в index.html)
const firebaseConfig = {
    apiKey: "AIzaSyAalCX2FgJioQ1iWBn26_gmk5Mh89UGpTo",
    authDomain: "volos-rent-357a1.firebaseapp.com",
    projectId: "volos-rent-357a1",
    storageBucket: "volos-rent-357a1.firebasestorage.app",
    messagingSenderId: "512437606780",
    appId: "1:512437606780:web:241842c1ef826307efacf9"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Обработка сообщений в фоновом режиме
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Получено фоновое сообщение ', payload);

    // Настройка уведомления
    const notificationTitle = payload.notification.title || 'Уведомление';
    const notificationOptions = {
        body: payload.notification.body || 'Новое уведомление',
        icon: payload.notification.icon || '/favicon.ico',
        data: payload.data || {}
    };

    // Показываем уведомление
    self.registration.showNotification(notificationTitle, notificationOptions);
});

// Обработка клика по уведомлению
self.addEventListener('notificationclick', (event) => {
    console.log('[firebase-messaging-sw.js] Клик по уведомлению', event);

    // Закрываем уведомление
    event.notification.close();

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
                    notification: event.data.notification
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