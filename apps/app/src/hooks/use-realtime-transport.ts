import useGetConfig from "@/hooks/queries/config/use-get-config";

export type RealtimeTransport = "websocket" | "poll" | "unknown";

/**
 * How this deployment delivers live updates — decided by the server, not
 * guessed here. See getSettings() in apps/api for why.
 *
 * "unknown" until GET /api/config answers, and callers must do nothing with it.
 *
 * This used to default to "websocket" while that request was in flight, on the
 * reasoning that the socket deployment should not pay a round trip before
 * connecting. On the serverless deployment that guess was wrong every time: two
 * sockets opened on first paint, config arrived a moment later, the effects
 * tore them down mid-handshake, and the console filled with
 *
 *   WebSocket connection to 'wss://…/api/ws/user' failed:
 *   WebSocket is closed before the connection is established.
 *
 * on every page load. One round trip beats an error that reads as a broken app.
 */
export function useRealtimeTransport(): RealtimeTransport {
  const { data } = useGetConfig();
  if (!data) return "unknown";
  return data.realtimeTransport === "poll" ? "poll" : "websocket";
}

/**
 * Refetch cadence used wherever a socket would otherwise have pushed.
 *
 * Ten seconds is a deliberate compromise: fast enough that a Kanban card moved
 * by a colleague appears before you wonder whether it saved, slow enough that
 * an idle tab costs six requests a minute rather than sixty. Only applied when
 * the transport is "poll" — when a socket is available these queries stay
 * event-driven and never poll at all.
 */
export const REALTIME_POLL_INTERVAL_MS = 10_000;
