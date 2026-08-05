/**
 * Fire-and-forget Inngest events over HTTP.
 *
 * Sending an event is just `POST <base>/e/<eventKey>` with a JSON body, so the
 * ingest path does not need the Inngest SDK — which matters because the SDK is
 * pulled in later (with the 24 function definitions and the `/api/inngest`
 * serve handler) and lead ingestion must not wait on that.
 *
 * NuraView runs Inngest self-hosted on the VPS (`nuraview-inngest:8288`), not
 * Inngest Cloud.
 *
 * Never throws. Every caller so far is best-effort: the leads are already
 * committed by the time we get here, and enrichment is async and retryable
 * from the UI. A failure to queue must not turn a successful ingest into a 500
 * that makes the scraper retry and re-insert.
 */
export type InngestEvent = {
  name: string;
  data: Record<string, unknown>;
};

export function isInngestConfigured(): boolean {
  return Boolean(process.env.INNGEST_EVENT_KEY && process.env.INNGEST_BASE_URL);
}

export async function sendInngestEvents(
  events: InngestEvent[],
): Promise<{ sent: number; error?: string }> {
  if (events.length === 0) return { sent: 0 };

  const base = process.env.INNGEST_BASE_URL;
  const key = process.env.INNGEST_EVENT_KEY;

  if (!base || !key) {
    // Not an error state during the migration: the audit rows are still
    // written, so the work is recoverable once Inngest is wired up.
    console.warn(
      `[inngest] INNGEST_BASE_URL/INNGEST_EVENT_KEY unset — dropped ${events.length} event(s): ${[
        ...new Set(events.map((e) => e.name)),
      ].join(", ")}`,
    );
    return { sent: 0, error: "not_configured" };
  }

  try {
    const response = await fetch(
      `${base.replace(/\/+$/, "")}/e/${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(events),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(
        `[inngest] send failed ${response.status}: ${body.slice(0, 300)}`,
      );
      return { sent: 0, error: `http_${response.status}` };
    }

    return { sent: events.length };
  } catch (error) {
    console.error(
      "[inngest] send threw:",
      error instanceof Error ? error.message : error,
    );
    return { sent: 0, error: "request_failed" };
  }
}
