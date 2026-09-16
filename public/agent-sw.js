/**
 * The console's service worker.
 *
 * It deliberately caches nothing. Its only job is to exist: Android needs a
 * worker with a fetch handler before it will install a page as a real app
 * rather than a browser shortcut.
 *
 * Caching here would be actively harmful. The console streams its answers over
 * SSE and sits behind a session cookie, so a stale cached page could show one
 * person's work to the next, or serve a signed-out shell as though it were
 * live. Every request goes to the network, exactly as it would without this.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => { /* pass through to the network */ });
