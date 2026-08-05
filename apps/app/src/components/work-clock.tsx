/**
 * Voluntary work clock (client meeting 2026-07-28).
 *
 * Sits in the sidebar. You start it yourself, you stop it yourself, and every
 * 30 minutes it asks whether you are still working — because a timer somebody
 * forgot to stop is worse than no timer at all.
 *
 * The prompt plays a short chime, as asked ("that sound ching"), generated with
 * the Web Audio API rather than shipping an asset — it is two oscillator notes
 * and needs no network fetch or file. Browsers block audio until the user has
 * interacted with the page; clicking Start counts, so by the time a prompt can
 * fire the gesture has already happened.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ListChecks, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getApiUrl } from "@/fetchers/get-api-url";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";
import { useNotificationSound } from "@/hooks/use-notification-sound";

/**
 * 25 minutes, per the client meeting. The server's accountability job uses the
 * same figure plus a 5-minute grace (scheduler/stale-work-clocks.ts); if this
 * moves, that must move with it or people get docked for a prompt that never
 * fired.
 */
const PROMPT_INTERVAL_MS = 25 * 60_000;

/** How long they have to answer before the server pauses and penalises. */
const ANSWER_WINDOW_MS = 5 * 60_000;

/**
 * How often to ask "is a prompt due yet?". Cheap local arithmetic against a
 * timestamp we already hold — no request — so this can be frequent enough that a
 * freshly reloaded tab shows an overdue prompt almost immediately.
 */
const PROMPT_CHECK_MS = 10_000;

/**
 * Speak the prompt aloud.
 *
 * VK asked for "a robotic voice... maybe we'll add female voice". A beep is
 * easy to ignore with headphones half-on; a sentence is not. Prefers a female
 * English voice where the platform exposes one and otherwise takes whatever is
 * available — voice inventory differs per OS and browser, and silence would be
 * worse than the wrong timbre.
 */
function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    const preferred =
      voices.find((v) => /female/i.test(v.name) && v.lang.startsWith("en")) ??
      voices.find((v) => /samantha|zira|victoria|karen|moira/i.test(v.name)) ??
      voices.find((v) => v.lang.startsWith("en"));
    if (preferred) utterance.voice = preferred;
    utterance.rate = 0.95;
    synth.cancel(); // never queue a backlog of prompts
    synth.speak(utterance);
  } catch {
    // No speech support — the chime and the on-screen card still fire.
  }
}

type WorkTask = {
  id: string;
  title: string;
  projectName: string | null;
};

type Status = {
  running: boolean;
  /** Server paused it for an unanswered prompt — see stale-work-clocks.ts. */
  paused: boolean;
  pausedAt: string | null;
  /** Cumulative seconds docked by unanswered prompts. */
  penaltySeconds: number;
  startedAt: string | null;
  /**
   * When the last prompt was answered (or the clock started). The SERVER owns
   * the prompt schedule; the client only renders it when it comes due.
   */
  lastPromptAt: string | null;
  secondsToday: number;
  /** What the clock is attributed to right now, if anything. */
  currentTask: { id: string; title: string } | null;
};

function hhmm(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Two short notes. Deliberately quiet — this fires every 30 minutes. */
/**
 * Ask for OS-notification permission, from inside a user gesture.
 *
 * Called when the clock starts: the browser only honours permission prompts
 * triggered by a click, and starting the clock is the one click every tracked
 * session is guaranteed to contain.
 */
function ensureNotifyPermission() {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

/**
 * The half-hour prompt as an OS notification, not just an in-page card.
 *
 * The card is invisible the moment the employee is in another window — which
 * is where someone doing design work in Figma or a call in Meet actually is.
 * VK: "keep the dashboard open all the time, maybe pin it, so they will all
 * get the notification every half an hour." A pinned background tab only
 * delivers that with a real Notification; clicking it focuses the dashboard.
 *
 * requireInteraction keeps it on screen until acted on — a toast that fades
 * after five seconds while someone is away from the desk never happened.
 */
/*
 * ACTION BUTTONS REQUIRE THE SERVICE WORKER.
 *
 * These both used `new Notification(...)`, and the Notification CONSTRUCTOR
 * cannot carry action buttons — only
 * ServiceWorkerRegistration.showNotification() can. So the OS notification
 * arrived with nothing but "Close" on it, and the only way to answer a prompt or
 * resume a paused clock was to find the tab and click in the app. VK, having done
 * exactly that: "I had to go all the way to app to resume."
 *
 * Routed through the registration instead, the buttons appear and sw.js's
 * notificationclick handler completes them by calling the API directly — no
 * window required.
 */
async function showActionable(
  title: string,
  body: string,
  tag: string,
  actions: { action: string; title: string }[],
) {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      body,
      tag, // replaces, never stacks
      requireInteraction: true,
      icon: "/web-app-manifest-192x192.png",
      badge: "/web-app-manifest-192x192.png",
      actions,
    });
  } catch {
    // No worker (or the platform refuses actions) — the in-page card, the chime
    // and the flashing tab title all still exist.
  }
}

function notifyPrompt() {
  // The in-page card is already in front of them when the tab has focus.
  if (typeof document !== "undefined" && document.hasFocus()) return;
  void showActionable(
    "Are you working?",
    "Answer here — no need to open the app. 15 minutes is deducted if this goes unanswered.",
    "nuraview-work-clock",
    [
      { action: "confirm_working", title: "✅ Yes, working" },
      { action: "stop_clock", title: "⏹ Stop clock" },
    ],
  );
}

/**
 * "Your clock is PAUSED" as an OS notification. Separate tag from the prompt so a
 * stale "are you working?" card cannot swallow it, and it carries Resume so the
 * clock can be restarted without opening the app.
 */
function notifyPaused() {
  void showActionable(
    "Your work clock is PAUSED",
    "It stopped counting because a prompt went unanswered. Resume from here — no need to open the app.",
    "nuraview-work-clock-paused",
    [{ action: "resume_clock", title: "▶️ Resume clock" }],
  );
}

/*
 * ONE AudioContext for the page, unlocked on the first gesture and KEPT.
 *
 * The old chime() built a fresh context per prompt. In a background tab with
 * no user gesture since page load, a fresh context starts SUSPENDED and its
 * oscillators never make a sound — and "no gesture since page load" is the
 * normal state here, because every deploy auto-reloads background tabs
 * (use-deploy-reload) and wipes the gesture unlock. VK sat on YouTube while
 * prompts fired silently and ate the penalty: the mp3's play() was rejected,
 * the fresh context stayed suspended, and speechSynthesis is gesture-gated
 * too. All three channels dead, precisely in the tab-not-focused case the
 * alert exists for.
 *
 * A context RESUMED during any earlier gesture keeps playing in background
 * tabs, so the beep survives both the reload and the backgrounding.
 */
let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (sharedCtx) return sharedCtx;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    sharedCtx = new Ctx();

    const resume = () => {
      sharedCtx?.resume().catch(() => {});
    };
    // Any gesture anywhere in the app unlocks it — not just clicks on the
    // clock. Keep listening (not {once:true}): the browser may re-suspend.
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
    resume();
  } catch {
    sharedCtx = null;
  }
  return sharedCtx;
}

function chime() {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      // One more attempt; without a prior gesture this fails and the other
      // channels (notification, title flash) carry the alert.
      ctx.resume().catch(() => {});
    }

    const gain = ctx.createGain();
    // Louder than the old 0.06 — this competes with music in another tab.
    gain.gain.value = 0.25;
    gain.connect(ctx.destination);

    // Three rising two-tone pairs, ~1.1s total — a page, not a tick.
    [880, 1320, 880, 1320, 1100, 1650].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.16);
    });

    setTimeout(() => gain.disconnect(), 1600);
  } catch {
    // Audio is a nicety; never let it break the prompt itself.
  }
}

export function WorkClock() {
  const queryClient = useQueryClient();
  const { play: playAlert } = useNotificationSound();
  const [asking, setAsking] = useState(false);
  const [askedAt, setAskedAt] = useState<number | null>(null);
  /*
   * Seconds left to answer. Recomputed from `tick` (the existing 1s ticker)
   * rather than a second timer — one heartbeat is enough and two would drift
   * apart.
   */
  const answerSecondsLeft =
    askedAt == null
      ? null
      : Math.max(
          0,
          Math.ceil((askedAt + ANSWER_WINDOW_MS - Date.now()) / 1000),
        );
  // Render trigger only. The elapsed time is recomputed from Date.now() during
  // render, so the once-a-second setTick is what makes the clock advance —
  // nothing ever reads the value.
  const [, setTick] = useState(0);
  const promptTimer = useRef<number | null>(null);
  /*
   * Which server window we have already prompted for.
   *
   * `asking` alone cannot guard this. setAsking is asynchronous, so two ticks in
   * the same beat both see it false and both fire; and once the answer window
   * lapses (or a notification action resets it) `asking` returns to false while
   * lastPromptAt has NOT moved — the window is still due, so the check fires
   * again, and again, every ten seconds. That is the doubled "Are you working?"
   * voice: not one prompt heard twice, but the same window prompted repeatedly.
   *
   * Keyed on the anchor, so each server window speaks exactly once.
   */
  const promptedFor = useRef<string | null>(null);

  const { data, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["work-time", "me"],
    queryFn: async (): Promise<Status> => {
      const r = await fetch(getApiUrl("work-time/me"), {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load clock");
      return r.json();
    },
    refetchInterval: 60_000,
    // A blip on navigation must not blank the clock — retry before surfacing
    // the no-data state, and re-check whenever the tab comes back.
    retry: 3,
    refetchOnWindowFocus: true,
  });

  const running = data?.running ?? false;
  /*
   * Paused is a THIRD state, not a flavour of stopped. The clock was running,
   * a prompt went unanswered, and the server docked the time and stopped the
   * accrual. Showing it as plain "Not tracking" would hide the penalty and
   * leave someone wondering why their day is short.
   */
  const paused = data?.paused ?? false;
  const penaltyMinutes = Math.round((data?.penaltySeconds ?? 0) / 60);

  /*
   * Blocking notifications is not a quiet preference here — it kills the
   * prompt channel the whole accountability model rests on. When it is
   * blocked: the clock cannot be STARTED (button gated below, with a plain
   * warning saying why), and if it was blocked while already running the
   * server pauses the entry and tells VK on WhatsApp. Polled each minute off
   * the existing data refresh so flipping the browser setting is noticed
   * without a reload.
   */
  const [notifyBlocked, setNotifyBlocked] = useState(
    () =>
      typeof Notification !== "undefined" &&
      Notification.permission === "denied",
  );
  useEffect(() => {
    if (typeof Notification === "undefined") return;
    setNotifyBlocked(Notification.permission === "denied");
  }, [data]);
  useEffect(() => {
    if (!notifyBlocked || !(running || paused)) return;
    // Once per day per browser — the owner needs to know, not to be spammed.
    const key = "nuraview-notify-blocked-reported";
    const today = new Date().toDateString();
    if (localStorage.getItem(key) === today) return;
    localStorage.setItem(key, today);
    fetch(getApiUrl("work-time/notifications-blocked"), {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
  }, [notifyBlocked, running, paused]);

  /*
   * "How long" was never the question on its own — VK: "what about tracking
   * the task and everything, this is just simple check in checkout."
   *
   * Picking a task is OPTIONAL. Clocking in without one still works, because a
   * timer you cannot start without filling in a form is a timer people stop
   * starting. The server does the close-then-open so two task entries can
   * never be open at once.
   */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [taskFilter, setTaskFilter] = useState("");

  const { data: taskList } = useQuery({
    queryKey: ["work-time", "tasks"],
    queryFn: async (): Promise<{ items: WorkTask[] }> => {
      const r = await fetch(getApiUrl("work-time/tasks"), {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load tasks");
      return r.json();
    },
    // Only fetched once the picker is opened — this component mounts on every
    // page and the list is up to 300 rows.
    enabled: pickerOpen,
    staleTime: 5 * 60_000,
  });

  const switchTask = useMutation({
    mutationFn: (taskId: string | null) => post("task", { taskId }),
    onMutate: ensureNotifyPermission,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-time"] });
      setPickerOpen(false);
      setTaskFilter("");
    },
  });

  const tasks = (taskList?.items ?? []).filter((t) => {
    if (!taskFilter.trim()) return true;
    const q = taskFilter.toLowerCase();
    return (
      t.title.toLowerCase().includes(q) ||
      (t.projectName ?? "").toLowerCase().includes(q)
    );
  });

  // Ticks once a second purely to re-render; the figure itself is derived from
  // dataUpdatedAt further down, so this holds no state that can drift.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  const post = useCallback(
    async (path: string, body?: unknown) => {
      const r = await fetch(getApiUrl(`work-time/${path}`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!r.ok) throw new Error(await r.text());
      queryClient.invalidateQueries({ queryKey: ["work-time"] });
      return r.json();
    },
    [queryClient],
  );

  const start = useMutation({
    mutationFn: () => post("start"),
    // Inside the click, which is the only place the browser honours it.
    onMutate: ensureNotifyPermission,
  });
  const stop = useMutation({ mutationFn: () => post("stop") });
  /*
   * Confirming you are working MUST reach the server before the card is
   * dismissed.
   *
   * This used to fire the mutation and hide the card in the same breath. When
   * the POST failed — an API restart during a deploy is enough — the person saw
   * the prompt disappear, believed they had confirmed, and last_prompt_at never
   * moved. The scheduler then treated them as away. That is exactly how VK lost
   * a 50-minute session and then a 3-hour one, and it read as the timer
   * "resetting on its own".
   *
   * Now: the card stays until the server says yes, and says so if it cannot.
   */
  const answer = useMutation({
    mutationFn: (working: boolean) => post("prompt", { working }),
    onSuccess: (_res, working) => {
      setAsking(false);
      setAskedAt(null);
      if (working) toast.success("Confirmed — clock still running");
      refetch();
    },
    onError: () =>
      toast.error(
        "Could not reach the server — still not confirmed. Try again.",
      ),
  });

  /*
   * Ask every 30 minutes, not once.
   *
   * This was a one-shot setTimeout re-armed only when `running` changed — so
   * the FIRST prompt fired, answering "yes" cleared it, and no prompt ever
   * came again; the scheduler then closed the clock at the 65-minute mark as
   * "unanswered". An interval keeps asking for as long as the clock runs, and
   * an unanswered card gets re-chimed and re-notified instead of sitting
   * silent.
   */
  /*
   * The worker can answer the prompt or resume the clock from the notification
   * itself. When it does, this tab is showing state that is already wrong — so
   * refetch and drop any prompt still on screen.
   */
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if ((event.data as { type?: string })?.type !== "WORK_CLOCK_CHANGED") {
        return;
      }
      setAsking(false);
      setAskedAt(null);
      void refetch();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [refetch]);

  /*
   * THE PROMPT SCHEDULE BELONGS TO THE SERVER.
   *
   * This used to be `setInterval(..., 25 minutes)` anchored to the moment this
   * component mounted, ignoring the server's lastPromptAt entirely. Every mount
   * restarted the countdown from zero — so a route change, a remount, or a
   * reload pushed the prompt 25 more minutes out while the server's clock kept
   * running toward its 30-minute deadline.
   *
   * Deploy-triggered auto-reload made that fatal. Ten deploys went out on
   * 2026-07-30, each one reloading every open tab, and prompt_shown_at was NULL
   * on EVERY row in production: not one prompt had ever been displayed to
   * anyone. People were then docked for ignoring prompts that our own reload had
   * suppressed.
   *
   * So: poll cheaply and ask the server's own timestamp whether a prompt is DUE.
   * A reload now inherits the real schedule instead of resetting it — if one was
   * already overdue it appears within seconds, which is the whole point.
   */
  useEffect(() => {
    if (!running) {
      if (promptTimer.current) window.clearInterval(promptTimer.current);
      setAsking(false);
      return;
    }

    const fire = () => {
      setAsking(true);
      setAskedAt(Date.now());
      /*
       * Tell the server the prompt is ON SCREEN. The penalty is gated on this:
       * without it the scheduler cannot tell "ignored the prompt" from "no
       * prompt was ever shown", and it was docking both.
       */
      void post("prompt-shown");
      /*
       * Three channels, deliberately. People were docked 15 minutes for
       * missing this, so it has to be genuinely hard to miss: the real
       * notification sound (not the synthesised chime alone), the spoken
       * question, and an OS notification for a backgrounded tab.
       */
      playAlert();
      chime();
      speak("Are you working?");
      notifyPrompt();
    };

    const check = () => {
      if (asking) return;
      const anchor = data?.lastPromptAt ?? data?.startedAt;
      if (!anchor) return;
      if (promptedFor.current === anchor) return;
      const due = new Date(anchor).getTime() + PROMPT_INTERVAL_MS;
      if (Date.now() >= due) {
        promptedFor.current = anchor;
        fire();
      }
    };

    check();
    promptTimer.current = window.setInterval(check, PROMPT_CHECK_MS);

    return () => {
      if (promptTimer.current) window.clearInterval(promptTimer.current);
    };
  }, [running, asking, data?.lastPromptAt, data?.startedAt]);

  /*
   * REPEAT while unanswered. One chime against YouTube in another tab is a
   * coin toss; fifteen docked minutes should never hang on a coin toss. Every
   * 20s until answered or the window closes: sound, chime, OS notification
   * (tag replaces, so they never stack). Speech only on the first firing —
   * a voice repeating "are you working" every 20 seconds is a haunting.
   */
  useEffect(() => {
    if (!asking || askedAt == null) return;
    const id = window.setInterval(() => {
      if (Date.now() - askedAt > ANSWER_WINDOW_MS) return;
      playAlert();
      chime();
      notifyPrompt();
    }, 20_000);
    return () => window.clearInterval(id);
  }, [asking, askedAt, playAlert]);

  /*
   * FLASH THE TAB TITLE while the prompt is pending or the clock sits paused.
   * Audio can be blocked, notifications can be denied — the tab strip is
   * always there, right next to the tab the person is actually looking at.
   */
  useEffect(() => {
    if (!asking && !paused) return;
    const original = document.title;
    const message = asking ? "⏰ ARE YOU WORKING?" : "⏸ CLOCK PAUSED — RESUME";
    let flip = false;
    const id = window.setInterval(() => {
      flip = !flip;
      document.title = flip ? message : original;
    }, 1000);
    return () => {
      window.clearInterval(id);
      document.title = original;
    };
  }, [asking, paused]);

  /*
   * NAG WHILE PAUSED. This is the state the user actually loses money in: the
   * prompt was missed, the server stopped counting, and they are working away
   * believing they are on the clock. It used to sit completely silent — one
   * amber line in a sidebar nobody looks at. Now: spoken once on entry, then
   * sound + chime + OS notification every 60s until Resume or Stop.
   */
  useEffect(() => {
    if (!paused) return;
    speak("Your work clock is paused. Resume it.");
    playAlert();
    chime();
    notifyPaused();
    const id = window.setInterval(() => {
      playAlert();
      chime();
      notifyPaused();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [paused, playAlert]);

  /*
   * The local second-hand, anchored to the RESPONSE rather than to a ref we
   * re-point ourselves.
   *
   * This used to re-anchor inside an effect keyed on `data.secondsToday`, which
   * only fires when that number CHANGES. Stop then Start broke it: a freshly
   * started entry has run for ~0 seconds, so the refetch returns the very same
   * integer, the effect does not fire, and the anchor is left pointing at
   * whenever the value last moved — possibly hours earlier. The moment `running`
   * flipped back to true the whole stale gap was added at once and the clock
   * jumped. VK saw 3h07 become something else on a single click.
   *
   * `dataUpdatedAt` advances on every successful fetch even when the payload is
   * byte-identical, and it IS the moment the payload was received, so there is
   * no anchor to keep in sync and nothing to go stale. secondsToday already
   * counts the open entry up to the server's now(), so we add only the time
   * since that response landed.
   */
  const sinceFetch =
    running && dataUpdatedAt
      ? Math.max(0, Math.floor((Date.now() - dataUpdatedAt) / 1000))
      : 0;
  const liveSeconds = (data?.secondsToday ?? 0) + sinceFetch;

  /*
   * No data yet — first load, or /work-time/me failed on this navigation.
   *
   * This state used to fall through to the defaults and render "0h 00m /
   * Not tracking / Start", which is a LIE while the server holds a running
   * entry: it reads as "the clock stopped and my morning is gone", and the
   * Start button it offers would close and reopen the real session. VK hit
   * exactly this on the 30 Jul call. Say "—" and wait; react-query keeps the
   * last good payload across background refetch failures, so this only shows
   * when there has never been a success.
   */
  if (!data) {
    return (
      <div className="mx-2 mb-2 rounded-xl border border-sidebar-border p-3 group-data-[collapsible=icon]:hidden">
        <div className="text-xs font-semibold uppercase tracking-wide text-sidebar-foreground">
          Work clock
        </div>
        <div className="mt-0.5 text-lg font-bold tabular-nums text-muted-foreground">
          —
        </div>
        <div className="mt-1.5 text-[11px] text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="mx-2 mb-2 rounded-xl border border-sidebar-border p-3 group-data-[collapsible=icon]:hidden">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-sidebar-foreground">
            Work clock
          </div>
          <div className="mt-0.5 text-lg font-bold tabular-nums">
            {hhmm(liveSeconds)}
          </div>
        </div>
        <Button
          size="sm"
          variant={running ? "outline" : "default"}
          className="h-8 gap-1.5"
          // Blocked notifications gate STARTING only — Stop must always work.
          disabled={
            start.isPending || stop.isPending || (!running && notifyBlocked)
          }
          onClick={() => (running ? stop.mutate() : start.mutate())}
        >
          {running ? (
            <>
              <Pause className="size-3.5" />
              Stop
            </>
          ) : (
            <>
              <Play className="size-3.5" />
              {paused ? "Resume" : "Start"}
            </>
          )}
        </Button>
      </div>

      <div
        className={cn(
          "mt-1.5 text-[11px]",
          running
            ? "text-emerald-600 dark:text-emerald-400"
            : paused
              ? "text-amber-600 dark:text-amber-400"
              : "text-muted-foreground",
        )}
      >
        {running
          ? "On the clock"
          : paused
            ? `Paused — no answer to the prompt${penaltyMinutes ? `, ${penaltyMinutes}m deducted` : ""}`
            : "Not tracking"}
      </div>

      {notifyBlocked ? (
        <div className="mt-2 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-[11px] leading-snug text-red-700 dark:text-red-300">
          <strong>Notifications are blocked in this browser.</strong>{" "}
          {running
            ? "Time tracking will be paused and Varshith has been notified."
            : "The timer cannot be started, and Varshith has been notified."}{" "}
          Allow notifications for this site (padlock icon in the address bar),
          then reload.
        </div>
      ) : null}

      {/* What the time is being attributed to. Always visible, so an
          unattributed session reads as a gap rather than as nothing. */}
      <button
        type="button"
        onClick={() => setPickerOpen((v) => !v)}
        className="mt-2 flex w-full items-center gap-1.5 rounded-lg border border-sidebar-border px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-sidebar-accent"
      >
        <ListChecks className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          {data?.currentTask ? (
            data.currentTask.title
          ) : (
            <span className="text-muted-foreground">No task selected</span>
          )}
        </span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </button>

      {pickerOpen ? (
        <div className="mt-1.5 rounded-lg border border-sidebar-border p-1.5">
          <Input
            autoFocus
            value={taskFilter}
            onChange={(e) => setTaskFilter(e.target.value)}
            placeholder="Search tasks…"
            className="h-7 text-xs"
          />
          <div className="mt-1 max-h-52 overflow-y-auto">
            {data?.currentTask ? (
              <button
                type="button"
                onClick={() => switchTask.mutate(null)}
                className="w-full rounded px-2 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-sidebar-accent"
              >
                Clear task — keep the clock running
              </button>
            ) : null}
            {tasks.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => switchTask.mutate(t.id)}
                className="block w-full rounded px-2 py-1.5 text-left hover:bg-sidebar-accent"
              >
                <span className="block truncate text-xs">{t.title}</span>
                {t.projectName ? (
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {t.projectName}
                  </span>
                ) : null}
              </button>
            ))}
            {tasks.length === 0 ? (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                {taskList ? "No matching tasks" : "Loading…"}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {asking ? (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5">
          <div className="text-sm font-medium">Are you working?</div>
          {/* State the consequence and the deadline. "The timer stops on its
              own" understated it — 15 minutes now comes off. Someone who
              stepped away deserves to know what it cost, not discover it in a
              timesheet later. */}
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Confirm within{" "}
            <span className="font-medium tabular-nums text-amber-700 dark:text-amber-300">
              {answerSecondsLeft != null
                ? `${Math.floor(answerSecondsLeft / 60)}:${String(answerSecondsLeft % 60).padStart(2, "0")}`
                : "5:00"}
            </span>{" "}
            or the clock pauses and 15 minutes are deducted.
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              className="h-7 flex-1"
              disabled={answer.isPending}
              onClick={() => answer.mutate(true)}
            >
              Yes
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 flex-1"
              disabled={answer.isPending}
              onClick={() => answer.mutate(false)}
            >
              No
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default WorkClock;
