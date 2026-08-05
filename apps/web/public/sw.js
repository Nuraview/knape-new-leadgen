// NuraView CRM service worker — handles web-push for dialer incoming calls.
// Port of the standalone dialer's sw.js minus workbox (no precaching; the CRM
// doesn't need an offline shell). Served from /sw.js → root scope.

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('push', (event) => {
    let payload = {};

    try {
        payload = event.data ? event.data.json() : {};
    } catch {
        payload = {
            title: 'Incoming Call',
            body: 'You have a new incoming call',
        };
    }

    const title = payload.title || 'Incoming Call';
    const options = {
        body: payload.body || 'Tap to open dialer',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: payload.callSid || 'dialer-notification',
        renotify: true,
        requireInteraction: true,
        vibrate: payload.type === 'incoming_call'
            ? [200, 100, 200, 100, 200, 100, 200, 500, 200, 100, 200, 100, 200, 100, 200, 1000]
            : [300, 150, 300],
        data: payload,
        actions: payload.type === 'incoming_call'
            ? [
                { action: 'answer', title: 'Answer' },
                { action: 'decline', title: 'Decline' },
            ]
            : [],
    };

    event.waitUntil((async () => {
        await self.registration.showNotification(title, options);

        if (payload.type === 'incoming_call') {
            const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
            for (const client of windowClients) {
                client.postMessage({
                    type: 'PUSH_INCOMING_CALL',
                    payload,
                });
            }
        }
    })());
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const payload = event.notification.data || {};
    const room = payload.conference || '';
    const callSid = payload.callSid || '';
    const action = event.action || 'open';
    const targetUrl = action === 'decline'
        ? `/dialer?push_action=decline&call_sid=${encodeURIComponent(callSid)}`
        : `/dialer?push_action=answer&room=${encodeURIComponent(room)}&call_sid=${encodeURIComponent(callSid)}`;

    event.waitUntil((async () => {
        const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windowClients) {
            await client.focus();
            client.postMessage({
                type: 'PUSH_NOTIFICATION_CLICK',
                action,
                payload,
            });
            return;
        }

        await clients.openWindow(targetUrl);
    })());
});
