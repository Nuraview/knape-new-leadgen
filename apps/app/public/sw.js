// NuraView service worker — web push for incoming calls and work-clock prompts.
//
// Ported verbatim from the legacy app's public/sw.js. Served from /sw.js so it
// claims the ROOT scope; a service worker can only control pages at or below
// its own path, so moving this into /assets/ would silently stop it working on
// /dialer.
//
// Icon paths point at the files this app actually ships (web-app-manifest-*),
// not the legacy /icons/icon-192.png which does not exist here — a missing icon
// makes some browsers drop the notification entirely rather than fall back.

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
        icon: '/web-app-manifest-192x192.png',
        badge: '/web-app-manifest-192x192.png',
        tag: payload.callSid || 'dialer-notification',
        renotify: true,
        requireInteraction: true,
        vibrate: payload.type === 'incoming_call'
            ? [200, 100, 200, 100, 200, 100, 200, 500, 200, 100, 200, 100, 200, 100, 200, 1000]
            : [300, 150, 300],
        data: payload,
        /*
         * ACT FROM THE NOTIFICATION, without opening the app.
         *
         * VK: "employees shouldn't need to go to the app always for resuming."
         * A prompt that costs 15 minutes when missed must be answerable where it
         * is read — on the lock screen, in the corner of the screen — not after a
         * tab switch, a page load and a hunt for the sidebar.
         *
         * These buttons are handled in notificationclick below, which calls the
         * API straight from the worker. Two actions maximum: most platforms show
         * no more than that, and the third is always the one that gets cut.
         */
        actions: payload.type === 'incoming_call'
            ? [
                { action: 'answer', title: 'Answer' },
                { action: 'decline', title: 'Decline' },
            ]
            : payload.type === 'work_clock_prompt'
            ? [
                { action: 'confirm_working', title: '✅ Yes, working' },
                { action: 'stop_clock', title: '⏹ Stop clock' },
            ]
            : payload.type === 'work_clock_paused'
            ? [{ action: 'resume_clock', title: '▶️ Resume clock' }]
            : [],
    };

    event.waitUntil((async () => {
        await self.registration.showNotification(title, options);

        const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });

        /*
         * TELL EVERY OPEN TAB, FOR EVERY PUSH TYPE.
         *
         * This used to fire only for incoming_call, so the work-clock prompt,
         * the lead alarm and project updates showed a silent OS notification
         * and told the page nothing. A service worker cannot play audio itself
         * — only a page can — so without this message there was no sound for
         * anything except a phone call. That is the whole reason the "are you
         * working?" prompt could be missed, and a missed prompt costs someone
         * real minutes.
         */
        for (const client of windowClients) {
            client.postMessage({ type: 'PUSH_RECEIVED', payload });
        }

        if (payload.type === 'incoming_call') {
            for (const client of windowClients) {
                client.postMessage({
                    type: 'PUSH_INCOMING_CALL',
                    payload,
                });
            }
        }
    })());
});

/*
 * Work-clock actions the worker can complete on its own.
 *
 * A service worker's fetch carries the session cookie for its own origin, so it
 * can answer the prompt or resume the clock with no window open at all. That is
 * the difference between a notification that INFORMS you and one that lets you
 * DEAL with it.
 */
const WORK_CLOCK_ACTIONS = {
    confirm_working: {
        url: '/api/work-time/prompt',
        body: { working: true },
        ok: 'Confirmed — your clock is still running.',
    },
    stop_clock: {
        url: '/api/work-time/stop',
        body: {},
        ok: 'Your clock has been stopped.',
    },
    resume_clock: {
        url: '/api/work-time/start',
        body: {},
        ok: 'Your clock is running again.',
    },
};

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    const workClockAction = WORK_CLOCK_ACTIONS[event.action];
    if (workClockAction) {
        event.waitUntil((async () => {
            try {
                const response = await fetch(workClockAction.url, {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(workClockAction.body),
                });
                if (!response.ok) throw new Error('HTTP ' + response.status);

                await self.registration.showNotification('NuraView', {
                    body: workClockAction.ok,
                    icon: '/web-app-manifest-192x192.png',
                    badge: '/web-app-manifest-192x192.png',
                    // Replaces rather than stacks, and stays quiet: this is an
                    // acknowledgement, not a new demand for attention.
                    tag: 'work-clock-result',
                    silent: true,
                });

                // Any tab already showing the clock must not keep showing the
                // old state after the person has just acted on it.
                const openTabs = await clients.matchAll({ type: 'window', includeUncontrolled: true });
                for (const tab of openTabs) {
                    tab.postMessage({ type: 'WORK_CLOCK_CHANGED' });
                }
            } catch (error) {
                /*
                 * Say it failed. Silently swallowing this is how someone believes
                 * they confirmed, walks away, and is docked for it — the exact
                 * failure this whole feature exists to stop.
                 */
                await self.registration.showNotification('Could not update your clock', {
                    body: 'Tap to open NuraView and do it there.',
                    icon: '/web-app-manifest-192x192.png',
                    tag: 'work-clock-result',
                    requireInteraction: true,
                    data: { url: '/dashboard' },
                });
            }
        })());
        return;
    }

    const payload = event.notification.data || {};
    const room = payload.conference || '';
    const callSid = payload.callSid || '';
    const action = event.action || 'open';
    // A generic alert (the 30-minute work-clock prompt) carries its own url and
    // has no call to answer or decline.
    const targetUrl = payload.type !== 'incoming_call'
        ? (payload.url || '/')
        : action === 'decline'
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
