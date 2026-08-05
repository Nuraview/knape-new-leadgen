/**
 * Fire-and-forget background work in a request handler.
 *
 * On Vercel this was `waitUntil` from @vercel/functions, which kept the
 * serverless invocation alive past the response. Self-hosted, the Node server
 * is long-lived, so the promise simply keeps running — all we have to add is a
 * rejection handler, otherwise a failure becomes an unhandled rejection and can
 * take the process down.
 */
export function waitUntil(promise: Promise<unknown>): void {
  void promise.catch((err) => {
    console.error("[waitUntil] background task failed:", err);
  });
}
