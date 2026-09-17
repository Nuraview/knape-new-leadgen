// NuraView service worker — two jobs, kept deliberately separate below.
//
//   1. THE APP SHELL. Caching that makes this installable as a real app and
//      survivable on a train: the shell and the hashed bundles are served from
//      cache, so a launch from the home screen paints instantly instead of
//      waiting on the network, and a dropped connection shows the app's own
//      offline screen rather than the browser's dinosaur.
//
//   2. WEB PUSH for incoming calls and work-clock prompts.
//
//   The two share nothing but this file. Push was here first; the shell layer
//   was added underneath it and must not change its behaviour.
//
// Ported verbatim from the legacy app's public/sw.js. Served from /sw.js so it
// claims the ROOT scope; a service worker can only control pages at or below
// its own path, so moving this into /assets/ would silently stop it working on
// /dialer.
//
// Icon paths point at the files this app actually ships (web-app-manifest-*),
// not the legacy /icons/icon-192.png which does not exist here — a missing icon
// makes some browsers drop the notification entirely rather than fall back.

/* ==========================================================================
   1. APP SHELL
   ========================================================================== */

/*
 * Bump this to throw away everything cached by an older worker.
 *
 * The asset cache is keyed by URL and Vite content-hashes every bundle, so a
 * new build writes new keys rather than colliding with old ones — the version
 * is here for the shell and for the day the caching STRATEGY changes, which is
 * the case a URL key cannot express.
 */
const CACHE_VERSION = 'v1';
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const ASSET_CACHE = `assets-${CACHE_VERSION}`;

/*
 * The offline page, and the icons the install prompt needs before there is any
 * network. index.html is NOT precached: see the navigation strategy below for
 * why caching it eagerly would fight the deploy check.
 */
const SHELL_URLS = [
    '/offline.html',
    '/web-app-manifest-192x192.png',
];

/*
 * Hashed bundles accumulate: every deploy adds a new set and the old ones are
 * never requested again. Unbounded, that is a cache that grows until the
 * browser evicts the whole origin — taking the offline page with it. Trimming
 * oldest-first on write keeps roughly the last couple of builds.
 */
const ASSET_CACHE_LIMIT = 160;

async function trimCache(cacheName, limit) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    // keys() returns insertion order, so the front of the list is the oldest.
    for (const key of keys.slice(0, Math.max(0, keys.length - limit))) {
        await cache.delete(key);
    }
}

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        /*
         * Individually, not addAll. addAll is atomic: one 404 rejects the whole
         * install and the worker never activates — so a single renamed icon
         * would silently take out push notifications as well, which is the more
         * important job in this file.
         */
        await Promise.all(SHELL_URLS.map(async (url) => {
            try {
                await cache.add(new Request(url, { cache: 'reload' }));
            } catch {
                // Missing or offline at install time. The fetch handler copes.
            }
        }));
    })());

    // Unchanged: take over as soon as possible rather than waiting for every
    // tab to close. A half-updated CRM is worse than a brief overlap.
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // Drop caches from a previous CACHE_VERSION. Anything we do not
        // recognise is left alone — it may belong to another worker on this
        // origin, and deleting a stranger's cache is not ours to do.
        const names = await caches.keys();
        await Promise.all(
            names
                .filter((name) => /^(shell|assets)-/.test(name))
                .filter((name) => name !== SHELL_CACHE && name !== ASSET_CACHE)
                .map((name) => caches.delete(name)),
        );

        /*
         * Navigation preload, where the browser supports it.
         *
         * Without it, a click starts the worker, waits for it to boot, and only
         * then issues the request — the worker's startup time is added to every
         * navigation. With it the browser fires the request in parallel and the
         * handler just takes the result.
         */
        if (self.registration.navigationPreload) {
            try {
                await self.registration.navigationPreload.enable();
            } catch {
                // Not fatal; the handler falls back to its own fetch.
            }
        }

        await self.clients.claim();
    })());
});

/**
 * Whether this request must never be served from, or written to, a cache.
 *
 * The list is the interesting part of the whole strategy:
 *
 *   - non-GET: a POST is an action, not a document.
 *   - cross-origin: opaque responses cache with no status and would let a
 *     failed CDN fetch be stored as if it had succeeded.
 *   - /api/: CRM data. A cached lead list is a WRONG lead list, and serving
 *     one would mean someone works a stale pipeline believing it is live.
 *     Authentication rides on these too, so a cached response is also a
 *     cached session.
 *   - cache: 'no-store' requests: useDeployReload asks for index.html this way
 *     precisely to get an uncached copy, and compares the hashed entry-script
 *     name in it against the running one. Answer that from cache and the app
 *     can never notice a deploy again — it would compare the old build to
 *     itself, find them equal, and go on running old code forever.
 *   - the worker and the manifest: always live, or an update cannot land.
 */
function isBypassed(request, url) {
    return (
        request.method !== 'GET' ||
        url.origin !== self.location.origin ||
        request.cache === 'no-store' ||
        request.headers.get('range') !== null ||
        url.pathname.startsWith('/api/') ||
        url.pathname === '/sw.js' ||
        url.pathname === '/site.webmanifest'
    );
}

/** Content-hashed build output: same URL always means same bytes. */
function isImmutableAsset(url) {
    return (
        url.pathname.startsWith('/assets/') &&
        /\.[0-9a-zA-Z_-]{8,}\.(js|css|woff2?|png|jpe?g|svg|webp|avif|mp3)$/.test(url.pathname)
    );
}

/** Things in public/ that are stable but not hashed. */
function isStaticAsset(url) {
    return /\.(png|jpe?g|svg|ico|webp|avif|woff2?|mp3)$/.test(url.pathname);
}

/**
 * Cache-first, for bytes that cannot change without changing their URL.
 *
 * This is where the offline launch comes from: the entire JavaScript bundle is
 * already on the device, so the app boots with no network at all.
 */
async function cacheFirst(request, cacheName, { trim = false } = {}) {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(request);
    if (hit) return hit;

    const response = await fetch(request);
    // Only a real 200. An opaque or error response cached here would be served
    // as the app's own JavaScript on every later load.
    if (response && response.ok && response.type === 'basic') {
        await cache.put(request, response.clone());
        if (trim) void trimCache(cacheName, ASSET_CACHE_LIMIT);
    }
    return response;
}

/**
 * Network-first, for the HTML document.
 *
 * The network is authoritative so a deploy is picked up on the next
 * navigation — this is a CRM, and silently running last week's build is the
 * failure mode that caching normally introduces. The cached copy exists only
 * for the case the network cannot answer at all.
 */
async function navigationHandler(event) {
    const cache = await caches.open(SHELL_CACHE);

    try {
        // Whatever navigationPreload already started, if anything.
        const response = (await event.preloadResponse) || (await fetch(event.request));
        /*
         * `!response.redirected` matters, and is not paranoia: a navigation
         * request has redirect mode "manual", and replying to one with a
         * response that came back redirected is a TypeError. Store a redirected
         * response (an auth bounce, say) and the offline path would throw
         * instead of serving the shell — turning a working offline launch into
         * a blank page, in exactly the situation with no network to recover
         * from.
         */
        if (response && response.ok && !response.redirected) {
            // Keep the last good shell under a fixed key rather than the
            // request URL: every client-side route resolves to this same
            // document, so one entry serves /leads, /pipeline and the rest.
            await cache.put('/index.html', response.clone());
        }
        return response;
    } catch {
        /*
         * Offline. The last shell we saw, if we have it: the SPA boots, its
         * router restores the route, and the app can show whatever React Query
         * already has plus its own "you are offline" state — which is a working
         * app with stale data, not a dead tab.
         */
        const shell = await cache.match('/index.html');
        if (shell) return shell;

        const offline = await cache.match('/offline.html');
        if (offline) return offline;

        return new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
        });
    }
}

self.addEventListener('fetch', (event) => {
    const { request } = event;

    let url;
    try {
        url = new URL(request.url);
    } catch {
        return;
    }

    if (isBypassed(request, url)) return;

    if (request.mode === 'navigate') {
        event.respondWith(navigationHandler(event));
        return;
    }

    if (isImmutableAsset(url)) {
        event.respondWith(cacheFirst(request, ASSET_CACHE, { trim: true }));
        return;
    }

    if (isStaticAsset(url)) {
        /*
         * Stale-while-revalidate. These URLs are stable but their CONTENTS can
         * change — a re-branded logo keeps the same path — so the cached copy
         * is served for speed and quietly replaced for next time. Cache-first
         * here would pin a client's build to the previous brand's icon.
         */
        event.respondWith((async () => {
            const cache = await caches.open(ASSET_CACHE);
            const hit = await cache.match(request);

            const refresh = fetch(request)
                .then(async (response) => {
                    if (response && response.ok && response.type === 'basic') {
                        await cache.put(request, response.clone());
                        void trimCache(ASSET_CACHE, ASSET_CACHE_LIMIT);
                    }
                    return response;
                })
                .catch(() => null);

            if (hit) {
                // Do not await: the point is to answer from cache now.
                void refresh;
                return hit;
            }

            return (await refresh) || Response.error();
        })());
    }

    // Everything else — anything not matched above — is left to the browser
    // untouched, which is the correct default for a strategy this file cannot
    // reason about.
});

/* ==========================================================================
   2. WEB PUSH
   ========================================================================== */

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
