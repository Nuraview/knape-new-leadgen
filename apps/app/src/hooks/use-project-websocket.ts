import { windowId } from "@nuraview/libs";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getApiUrl } from "@/fetchers/get-api-url";
import { authClient } from "@/lib/auth-client";
import { useNotificationSound } from "@/hooks/use-notification-sound";
import {
  REALTIME_POLL_INTERVAL_MS,
  useRealtimeTransport,
} from "@/hooks/use-realtime-transport";

export function getWsUrl(projectId: string) {
  const base = getApiUrl("ws");
  const wsBase = base.replace(/^http/, "ws");
  return `${wsBase}/${encodeURIComponent(projectId)}?windowId=${encodeURIComponent(windowId)}`;
}

const MAX_RETRIES = 5;
const BASE_DELAY = 1000; // 1 second

// Cloudflare closes idle WebSocket connections after 100 seconds of no traffic.
// We send a lightweight ping every 30 seconds to keep the connection alive.
const WS_PING_INTERVAL_MS = 30_000;

export function useProjectWebSocket(projectId: string) {
  const queryClient = useQueryClient();
  const { data: session } = authClient.useSession();
  const transport = useRealtimeTransport();

  /*
   * A ref, not the value: the socket handler is installed once and would
   * otherwise capture the first render's copy of `play` forever, so toggling
   * mute would never reach it.
   */
  const { play } = useNotificationSound();
  const playRef = useRef(play);
  playRef.current = play;
  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /*
   * Serverless fallback — see the same block in use-user-websocket.
   *
   * Only the task list is refetched, not every per-task query the socket path
   * invalidates: those are keyed by the id of whatever changed, which polling
   * has no way to learn. Refetching the list is what keeps a board honest; an
   * open task detail refreshes on focus.
   *
   * No sound here. The socket suppresses the initiator's own events server-side
   * (broadcastToProject's excludeInitiatorId), so a beep there always means
   * somebody else did something. A poll cannot tell the difference, and a beep
   * every ten seconds for your own edits is worse than no beep at all.
   */
  useEffect(() => {
    if (transport !== "poll") return;
    if (!projectId || !session?.user?.id) return;

    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
    }, REALTIME_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [transport, projectId, session?.user?.id, queryClient]);

  useEffect(() => {
    if (transport !== "websocket") return;
    if (!projectId || !session?.user?.id) return;

    retriesRef.current = 0;

    function clearPing() {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
    }

    function connect() {
      const url = getWsUrl(projectId);
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retriesRef.current = 0; // Reset retries on successful connection
        // Start keepalive pings to prevent Cloudflare idle timeout (100s)
        clearPing();
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, WS_PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (
            message.type === "TASK_UPDATED" ||
            message.type === "TASK_CREATED" ||
            message.type === "TASK_DELETED" ||
            message.type === "TASK_LABEL_UPDATED" ||
            message.type === "TASK_MOVED" ||
            message.type === "TASK_RELATION_UPDATED" ||
            message.type === "COMMENT_UPDATED"
          ) {
            queryClient.invalidateQueries({
              queryKey: ["tasks", message.projectId],
            });

            /*
             * Audible on ANY project change. VK: "all employees and Varshith
             * should get a loud unmissable notification sound on any kinds of
             * project updates — a simple beep won't suffice."
             *
             * No self-check needed: the server already excludes the person who
             * caused the change (broadcastToProject's excludeInitiatorId), so
             * anything arriving here was somebody else's doing. Filtering again
             * on the client would be dead code — the payload carries no actor.
             */
            playRef.current();

            if (message.type === "TASK_RELATION_UPDATED") {
              if (message.sourceTaskId) {
                queryClient.invalidateQueries({
                  queryKey: ["task", message.sourceTaskId],
                });
                queryClient.invalidateQueries({
                  queryKey: ["task-relations", message.sourceTaskId],
                });
              }
              if (message.targetTaskId) {
                queryClient.invalidateQueries({
                  queryKey: ["task", message.targetTaskId],
                });
                queryClient.invalidateQueries({
                  queryKey: ["task-relations", message.targetTaskId],
                });
              }
              if (!message.sourceTaskId && !message.targetTaskId) {
                queryClient.invalidateQueries({
                  queryKey: ["task-relations"],
                });
              }
            } else {
              queryClient.invalidateQueries({
                queryKey: ["task", message.taskId],
              });
            }

            if (message.type === "TASK_LABEL_UPDATED") {
              queryClient.invalidateQueries({
                queryKey: ["labels", message.taskId],
              });
            }

            if (message.type === "COMMENT_UPDATED") {
              queryClient.invalidateQueries({
                queryKey: ["activities", message.taskId],
              });
              queryClient.invalidateQueries({
                queryKey: ["comments", message.taskId],
              });
            }
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        clearPing();
        wsRef.current = null;

        if (retriesRef.current < MAX_RETRIES) {
          const delay = BASE_DELAY * 2 ** retriesRef.current; // 1s, 2s, 4s, 8s, 16s
          retriesRef.current += 1;
          timeoutRef.current = setTimeout(connect, delay);
        }
      };
    }
    connect();

    return () => {
      retriesRef.current = MAX_RETRIES; // Prevent reconnect after unmount
      clearPing();
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [transport, projectId, session?.user?.id, queryClient]);
}
