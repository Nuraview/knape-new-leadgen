/**
 * The in-app assistant, on every page.
 *
 * A dashboard full of correct numbers still leaves "so what do I do?"
 * unanswered. This answers it in a sentence, against live data, wherever you
 * happen to be standing.
 *
 * It knows the current route and sends it along, so "what am I looking at?" and
 * "who should I call?" mean something different on Leads than on Outreach.
 *
 * The model runs server-side — see apps/api/src/assistant. The key is never in
 * this bundle, and every tool the assistant can reach is read-only, so nothing
 * it is asked to do can send an email or change a setting.
 *
 * Hides itself entirely when the server says it is not configured, rather than
 * offering a button that answers 503.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import { getApiUrl } from "@/fetchers/get-api-url";

type Msg = { role: "user" | "assistant"; content: string };

type Point = { x: number; y: number };

/**
 * Where the launcher sits, and why it is draggable.
 *
 * Pinned to the bottom-right corner it covered the last row of every table —
 * the "remove" and "stop follow-ups" links on Communications sit exactly there.
 * A button that hides other buttons is a bug, so the default moved to the top
 * right and the whole thing now drags anywhere the user wants it.
 *
 * The chosen spot is remembered per browser; nothing about it is server state.
 */
const LAUNCHER_POSITION_KEY = "assistant:launcher-position";
/** Gap kept between the launcher and any viewport edge, in px. */
const EDGE_GAP = 20;
/** Pointer travel that turns a click into a drag, in px. Below this the press
 *  still opens the panel, so a slightly shaky tap is not swallowed. */
const DRAG_THRESHOLD = 4;
/** Panel box, matching the rem sizes on the element below. */
const PANEL_W = 416;
const PANEL_H = 512;

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

/** Keep a point fully on screen given the size of the thing being placed. */
function clampToViewport(p: Point, w: number, h: number): Point {
  return {
    x: clamp(p.x, EDGE_GAP, Math.max(EDGE_GAP, window.innerWidth - w - EDGE_GAP)),
    y: clamp(p.y, EDGE_GAP, Math.max(EDGE_GAP, window.innerHeight - h - EDGE_GAP)),
  };
}

function readStoredPosition(): Point | null {
  try {
    const raw = localStorage.getItem(LAUNCHER_POSITION_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<Point>;
    if (typeof p?.x !== "number" || typeof p?.y !== "number") return null;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    return { x: p.x, y: p.y };
  } catch {
    return null;
  }
}

/** Plain-language name for the route, for the model and the header. */
function pageName(path: string): string {
  if (path.startsWith("/home")) return "Home";
  if (path.startsWith("/pipeline/")) return "a lead's detail";
  if (path.startsWith("/pipeline")) return "Leads";
  if (path.startsWith("/emails")) return "Outreach";
  if (path.startsWith("/communications")) return "Communications";
  if (path.startsWith("/finder")) return "Live Finder";
  if (path.startsWith("/inboxes")) return "Inboxes";
  if (path.startsWith("/pipeline-settings")) return "Pipeline settings";
  if (path.startsWith("/orders")) return "Orders";
  if (path.startsWith("/proposals")) return "Proposals";
  if (path.startsWith("/invoices")) return "Invoices";
  return path.replace(/^\//, "") || "Home";
}

/** Openers worth one tap. Deliberately the questions people actually ask. */
const PROMPTS = [
  "Who should I call today?",
  "How is the campaign doing?",
  "Why is nothing sending?",
  "Did we find new leads today?",
];

/**
 * Render the assistant's markdown, rather than printing it.
 *
 * The model writes lists and emphasis because it has been asked for scannable
 * answers, and the panel was showing the source: literal "**1 lead left**" and
 * hyphens where bullets belonged. react-markdown is already a dependency of
 * this app, so this costs no bundle weight and no new supply chain.
 *
 * Raw HTML is NOT enabled. Without rehype-raw, react-markdown escapes any
 * markup in the model's output, so a prompt-injected <script> or <img onerror>
 * arriving through a school's auto-reply cannot execute here.
 *
 * Every element is restyled for a narrow chat bubble: prose defaults assume an
 * article column and leave far too much vertical space at this width.
 */
function AssistantText({ children }: { children: string }) {
  return (
    <div className="space-y-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <Markdown
        components={{
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => (
            <ul className="ms-1 list-none space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="ms-4 list-decimal space-y-1">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="relative ps-3.5 leading-relaxed before:absolute before:start-0 before:text-primary before:content-['•']">
              {children}
            </li>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline underline-offset-2"
            >
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="rounded bg-background/70 px-1 py-0.5 font-mono text-[0.85em]">
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-md bg-background/70 p-2 text-xs">
              {children}
            </pre>
          ),
          h1: ({ children }) => (
            <div className="text-sm font-semibold">{children}</div>
          ),
          h2: ({ children }) => (
            <div className="text-sm font-semibold">{children}</div>
          ),
          h3: ({ children }) => (
            <div className="text-sm font-semibold">{children}</div>
          ),
          hr: () => <hr className="border-border/60" />,
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border px-1.5 py-1 text-start font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border/50 px-1.5 py-1">{children}</td>
          ),
        }}
      >
        {children}
      </Markdown>
    </div>
  );
}

/**
 * Drag the launcher with a pointer, without losing the tap that opens it.
 *
 * Position stays null until either storage or a drag supplies one, so the first
 * render (and any server render) is pure CSS classes with no window access.
 */
function useDraggableLauncher() {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [position, setPosition] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    dx: number;
    dy: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  /** Set on the drag that just ended, so its trailing click does not open. */
  const suppressClick = useRef(false);

  useEffect(() => {
    const stored = readStoredPosition();
    if (!stored) return;
    const el = ref.current;
    setPosition(
      clampToViewport(stored, el?.offsetWidth ?? 0, el?.offsetHeight ?? 0),
    );
  }, []);

  const placed = position !== null;
  useEffect(() => {
    if (!placed) return;
    const onResize = () => {
      const el = ref.current;
      setPosition((p) =>
        p ? clampToViewport(p, el?.offsetWidth ?? 0, el?.offsetHeight ?? 0) : p,
      );
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [placed]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = {
      dx: e.clientX - r.left,
      dy: e.clientY - r.top,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    el.setPointerCapture(e.pointerId);
    setDragging(true);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el) return;
    if (
      !d.moved &&
      Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD
    ) {
      return;
    }
    d.moved = true;
    setPosition(
      clampToViewport(
        { x: e.clientX - d.dx, y: e.clientY - d.dy },
        el.offsetWidth,
        el.offsetHeight,
      ),
    );
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    ref.current?.releasePointerCapture?.(e.pointerId);
    if (!d?.moved) return;
    suppressClick.current = true;
    setPosition((p) => {
      if (p) {
        try {
          localStorage.setItem(LAUNCHER_POSITION_KEY, JSON.stringify(p));
        } catch {}
      }
      return p;
    });
  }, []);

  /** Nudge with the keyboard, so the button is movable without a pointer. */
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 32 : 8;
    const delta: Record<string, Point> = {
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
    };
    const d = delta[e.key];
    if (!d) return;
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const base = { x: r.left + d.x, y: r.top + d.y };
    const next = clampToViewport(base, el.offsetWidth, el.offsetHeight);
    setPosition(next);
    try {
      localStorage.setItem(LAUNCHER_POSITION_KEY, JSON.stringify(next));
    } catch {}
  }, []);

  const consumeClick = useCallback(() => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  }, []);

  return {
    ref,
    position,
    dragging,
    consumeClick,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown,
    },
  };
}

/** Open the panel from wherever the launcher was left, clamped on screen. */
function panelStyle(p: Point | null): CSSProperties | undefined {
  if (!p) return undefined;
  const w = Math.min(PANEL_W, window.innerWidth - 2 * EDGE_GAP);
  const h = Math.min(PANEL_H, window.innerHeight - 2 * EDGE_GAP);
  const { x, y } = clampToViewport(p, w, h);
  return { left: x, top: y, width: w, height: h };
}

export function AssistantPanel() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const endRef = useRef<HTMLDivElement | null>(null);
  const launcher = useDraggableLauncher();

  const path = useRouterState({ select: (s) => s.location.pathname });
  const page = pageName(path);

  const config = useQuery({
    queryKey: ["assistant", "config"],
    queryFn: async (): Promise<{ enabled: boolean }> => {
      const r = await fetch(getApiUrl("assistant/config"), {
        credentials: "include",
      });
      if (!r.ok) return { enabled: false };
      return r.json();
    },
    staleTime: 10 * 60_000,
  });

  const ask = useMutation({
    mutationFn: async (history: Msg[]) => {
      const r = await fetch(getApiUrl("assistant/chat"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, route: page }),
      });
      if (!r.ok) {
        let m = r.statusText;
        try {
          m = (await r.json())?.message ?? m;
        } catch {}
        throw new Error(m);
      }
      return (await r.json()) as { reply: string; tools_used?: string[] };
    },
    onSuccess: (d) =>
      setMessages((prev) => [...prev, { role: "assistant", content: d.reply }]),
    onError: (e) =>
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `I could not answer: ${(e as Error).message}` },
      ]),
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, ask.isPending]);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || ask.isPending) return;
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setDraft("");
    ask.mutate(next);
  };

  /*
   * Rendered even when unconfigured, deliberately.
   *
   * This used to return null without DEEPSEEK_API_KEY, which meant a deployed,
   * working assistant was indistinguishable from one that had never been
   * built — "where is the copilot?" with no way to tell. A feature that hides
   * itself when it needs something is a feature nobody can debug.
   */
  const ready = config.data?.enabled === true;

  if (!open) {
    return (
      <button
        ref={launcher.ref}
        type="button"
        onClick={() => {
          if (launcher.consumeClick()) return;
          setOpen(true);
        }}
        aria-label="Open the assistant — drag, or arrow keys, to move it"
        title="Drag to move"
        style={
          launcher.position
            ? { left: launcher.position.x, top: launcher.position.y }
            : undefined
        }
        className={`fixed z-50 flex touch-none select-none items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg transition hover:opacity-90 ${
          launcher.position ? "" : "top-24 end-5"
        } ${launcher.dragging ? "cursor-grabbing" : "cursor-grab"}`}
        {...launcher.handlers}
      >
        <Sparkles className="size-4" />
        Ask
      </button>
    );
  }

  return (
    <div
      style={panelStyle(launcher.position)}
      className={`fixed z-50 flex flex-col rounded-xl border border-border bg-card shadow-2xl ${
        launcher.position
          ? ""
          : "top-24 end-5 h-[min(32rem,calc(100vh-7rem))] w-[min(26rem,calc(100vw-2.5rem))]"
      }`}
    >
      <header className="flex items-center gap-2 border-b border-border p-3">
        <Sparkles className="size-4 text-primary" />
        <div className="min-w-0">
          <div className="text-sm font-semibold">Assistant</div>
          <div className="truncate text-xs text-muted-foreground">
            looking at {page}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="ms-auto rounded p-1 hover:bg-muted"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {!ready ? (
          <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-600">
            <p className="font-medium">The assistant needs its API key.</p>
            <p className="text-xs">
              Set <code className="font-mono">DEEPSEEK_API_KEY</code> on this
              deployment and redeploy. Everything else — the tools, the panel,
              the wiring — is already live; it will start answering the moment
              the key exists.
            </p>
          </div>
        ) : !messages.length ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Ask about your leads, emails or what needs doing. I read the live
              numbers — I don't guess them.
            </p>
            <div className="flex flex-col gap-1.5">
              {PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => send(p)}
                  className="rounded-lg border border-border px-3 py-2 text-start text-sm hover:bg-muted"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={`${i}-${m.content.slice(0, 12)}`}
              className={`max-w-[92%] rounded-lg px-3 py-2 text-sm ${
                m.role === "user"
                  ? "ms-auto whitespace-pre-wrap bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              {m.role === "user" ? m.content : <AssistantText>{m.content}</AssistantText>}
            </div>
          ))
        )}
        {ask.isPending ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Checking the numbers…
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-center gap-2 border-t border-border p-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!ready}
          placeholder={ready ? "Ask about your leads…" : "Waiting on the API key"}
          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-sm"
        />
        <button
          type="submit"
          disabled={!ready || !draft.trim() || ask.isPending}
          aria-label="Send"
          className="grid size-9 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground disabled:opacity-40"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}

export default AssistantPanel;
