/**
 * Dialer — the Twilio softphone.
 *
 * Ported from apps/web/app/(routes)/dialer. The Voice SDK runs here in the
 * browser; the API only mints the access token and keeps the records.
 *
 * The device is registered once and torn down on unmount. Leaving a registered
 * device behind means Twilio keeps routing inbound calls to a page nobody is
 * looking at, and the caller hears ringing forever.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Delete,
  MessageSquare,
  Mic,
  BellRing,
  MicOff,
  Pencil,
  Phone,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "@/lib/toast";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useDialer } from "@/components/dialer/dialer-provider";
import { getApiUrl } from "@/fetchers/get-api-url";
import { cn } from "@/lib/cn";
import { InstallBanner } from "@/components/dialer/install-banner";
import { TemplatePicker } from "@/components/dialer/template-picker";

type MessageRow = {
  id: number;
  phoneNumber: string;
  messageBody: string;
  messageStatus: string;
  direction: string;
  messageType: string;
  createdAt: string | null;
};

type LeadHit = {
  id: string;
  company: string | null;
  firstName: string | null;
  jobTitle: string | null;
  phone: string | null;
};

const KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

function when(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

function duration(seconds: number | null) {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** A call as Twilio reports it — see the twilio-calls query for why. */
type TwilioCall = {
  id: string;
  phoneNumber: string;
  direction: "inbound" | "outbound";
  status: string;
  duration: number | null;
  createdAt: string;
  leadName: string | null;
};

type DialerContact = {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  requirementTag: string | null;
  smsEnabled: boolean | null;
  whatsappEnabled: boolean | null;
};

type ContactDraft = {
  id?: number;
  name: string;
  phone: string;
  email: string;
  requirementTag: string;
};

const EMPTY_DRAFT: ContactDraft = {
  name: "",
  phone: "",
  email: "",
  requirementTag: "",
};

/** Twilio statuses that mean the call never connected. */
/**
 * Twilio's raw status is not what a salesperson wants to read. VK, verbatim:
 * "it should be called as missed a call". Legacy mapped no-answer to
 * "No answer" (CallLogPanel.tsx:53); this goes one step further because he
 * asked for it explicitly.
 */
function statusLabel(status: string): string {
  switch (status) {
    case "no-answer":
      return "Missed call";
    case "in-progress":
      return "In progress";
    case "busy":
      return "Busy";
    case "canceled":
      return "Cancelled";
    case "failed":
      return "Failed";
    case "completed":
      return "Answered";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

/** Legacy wording (CallLogPanel.tsx:144). */
function directionLabel(direction: string): string {
  return direction.startsWith("outbound") ? "Outgoing" : "Incoming";
}

const MISSED_STATUSES = new Set([
  "no-answer",
  "busy",
  "canceled",
  "failed",
]);

function RouteComponent() {
  const queryClient = useQueryClient();
  /*
   * The device is owned by DialerProvider in the authenticated shell, not here.
   * Creating a second Device on the same identity would register another
   * instance with Twilio: an incoming call rings BOTH, and accept/reject race
   * each other. This page is a consumer like every other screen.
   */
  const { ready, activeCall, muted, dial, hangUp, toggleMute, sendDigit } =
    useDialer();
  const [number, setNumber] = useState("");
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const [tab, setTab] = useState<"calls" | "missed" | "contacts" | "messages">(
    "calls",
  );
  const [draft, setDraft] = useState<ContactDraft | null>(null);
  const push = usePushNotifications();
  const [contactQuery, setContactQuery] = useState("");

  // Device lifecycle and the presence heartbeat both live in DialerProvider so
  // they keep running on every screen, not just this one.


  /*
   * The call log comes from TWILIO, not our dialer_calls table.
   *
   * dialer_calls only ever receives rows when a status webhook reaches us, and
   * it holds zero outbound rows in production — so serving the log from it
   * showed inbound calls only and could never show an outbound call that was
   * never picked up. Twilio is the source of truth for call history.
   */
  const calls = useQuery({
    queryKey: ["dialer", "twilio-calls"],
    queryFn: async (): Promise<{ calls: TwilioCall[] }> => {
      const r = await fetch(getApiUrl("dialer/twilio-calls"), {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load calls");
      return r.json();
    },
    /*
     * Poll hard while a call is up, gently otherwise.
     *
     * With <Dial answerOnBridge> the caller's leg stays "Ringing" at Twilio
     * until the agent's leg bridges, so a live call sat on "Ringing" for up to
     * a full 30s poll even after it had been answered. Five seconds is the
     * difference between a log that tracks the call and one that looks broken.
     */
    refetchInterval: activeCall ? 5_000 : 30_000,
  });

  const contacts = useQuery({
    queryKey: ["dialer", "contacts"],
    queryFn: async (): Promise<{ items: DialerContact[] }> => {
      const r = await fetch(getApiUrl("dialer/contacts"), {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load contacts");
      return r.json();
    },
    enabled: tab === "contacts",
  });

  const saveContact = useMutation({
    mutationFn: async (draft: ContactDraft) => {
      const editing = draft.id != null;
      const r = await fetch(
        getApiUrl(editing ? `dialer/contacts/${draft.id}` : "dialer/contacts"),
        {
          method: editing ? "PUT" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      );
      if (!r.ok) throw new Error("Failed to save contact");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Contact saved");
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ["dialer", "contacts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteContact = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(getApiUrl(`dialer/contacts/${id}`), {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to delete contact");
      return r.json();
    },
    onSuccess: () => {
      toast.success("Contact deleted");
      queryClient.invalidateQueries({ queryKey: ["dialer", "contacts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /*
   * Missed = did not connect, in EITHER direction: a call we never answered,
   * or one we placed that the client never picked up. The second kind is the
   * one that had nowhere to appear before.
   */
  const missed = (calls.data?.calls ?? []).filter((call) =>
    MISSED_STATUSES.has(call.status),
  );

  const messages = useQuery({
    queryKey: ["dialer", "messages"],
    queryFn: async (): Promise<{ items: MessageRow[] }> => {
      const r = await fetch(getApiUrl("dialer/messages"), {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load messages");
      return r.json();
    },
    enabled: tab === "messages",
  });

  const leadHits = useQuery({
    queryKey: ["dialer", "leads-search", debouncedSearch],
    queryFn: async (): Promise<{ items: LeadHit[] }> => {
      const r = await fetch(
        `${getApiUrl("dialer/leads-search")}?q=${encodeURIComponent(debouncedSearch)}`,
        { credentials: "include" },
      );
      if (!r.ok) throw new Error("Search failed");
      return r.json();
    },
    enabled: debouncedSearch.trim().length >= 2,
  });

  // Placing and answering both go through the shared provider.
  const placeCall = useCallback(async () => {
    if (!number.trim()) return;
    await dial(number.trim());
  }, [number, dial]);

  /*
   * Refreshing the log when a call ends is DialerProvider's job now.
   *
   * This is where it used to live, and it invalidated ["dialer", "calls"] while
   * the query above is keyed ["dialer", "twilio-calls"]. TanStack matches key
   * prefixes element by element, so "calls" never matched "twilio-calls": the
   * invalidation did nothing, and a finished call kept its "Ringing" row until
   * the 30s poll came round. Calls are also answered from other screens, where
   * this effect was never mounted at all.
   */

  const sendSms = useMutation({
    mutationFn: async (payload: { to: string; body: string }) => {
      const r = await fetch(getApiUrl("dialer/messages/send"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      toast.success("Message sent");
      queryClient.invalidateQueries({ queryKey: ["dialer", "messages"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not send"),
  });

  const [smsBody, setSmsBody] = useState("");

  return (
    <Layout>
      <PageTitle title="Dialer" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">Dialer</h1>
        <span
          className={cn(
            "ms-2 rounded-full px-2 py-0.5 text-[11px] font-medium",
            ready
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
          )}
        >
          {ready ? "ready" : "connecting…"}
        </span>

        {/*
          Deliberately in the header, not behind a settings menu. Whether calls
          reach you with the tab closed is the single most consequential switch
          on this page, and a control nobody finds is a control that does not
          exist. It states its own state rather than being a silent toggle.
        */}
        {push.supported && push.vapidPublicKey ? (
          push.subscribed ? (
            <span
              className="ms-auto flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400"
              title="Incoming calls will alert this device even with the tab closed"
            >
              <BellRing className="size-3.5" />
              Call alerts on
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => void push.unsubscribe()}
                disabled={push.busy}
              >
                turn off
              </Button>
            </span>
          ) : (
            <Button
              size="sm"
              className="ms-auto h-8 gap-1.5"
              disabled={push.busy}
              onClick={async () => {
                const result = await push.subscribe();
                if (result.ok) {
                  toast.success(
                    "Call alerts on — this device will ring even with the tab closed",
                  );
                } else {
                  toast.error(result.reason);
                }
              }}
            >
              <BellRing className="size-3.5" />
              Turn on call alerts
            </Button>
          )
        ) : null}
      </header>

      {/* Installing measurably improves push reliability on mobile, which is
          the difference between hearing a call and finding it in Missed. */}
      <InstallBanner />

      {/*
        A ringing call used to be a tinted strip right here — easy to miss on
        the one screen where taking calls IS the job. GlobalDialerRuntime now
        renders the full-screen IncomingCallDialog on every route, this one
        included, so there is nothing left for the page to draw.
      */}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Keypad */}
        <div className="w-80 shrink-0 space-y-3 overflow-y-auto border-e border-border p-5">
          <Input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="+1 555 123 4567"
            className="h-11 text-center text-lg tabular-nums"
          />

          <div className="grid grid-cols-3 gap-2">
            {KEYPAD.map((k) => (
              <Button
                key={k}
                variant="outline"
                className="h-12 text-lg"
                onClick={() => {
                  // During a call the keypad sends DTMF; otherwise it types.
                  if (activeCall) sendDigit(k);
                  else setNumber((n) => n + k);
                }}
              >
                {k}
              </Button>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-10 flex-1"
              onClick={() => setNumber((n) => n.slice(0, -1))}
              disabled={!number}
            >
              <Delete className="size-4" />
            </Button>
            {activeCall ? (
              <>
                <Button
                  variant="outline"
                  className="h-10"
                  onClick={() => {
                    toggleMute();
                  }}
                >
                  {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                </Button>
                <Button
                  className="h-10 flex-1 gap-1.5 bg-rose-600 hover:bg-rose-700"
                  onClick={hangUp}
                >
                  <PhoneOff className="size-4" />
                  Hang up
                </Button>
              </>
            ) : (
              <Button
                className="h-10 flex-1 gap-1.5"
                disabled={!ready || !number.trim()}
                onClick={placeCall}
              >
                <Phone className="size-4" />
                Call
              </Button>
            )}
          </div>

          <div className="pt-2">
            <div className="relative">
              <Search className="absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find a lead to call"
                className="h-9 ps-8"
              />
            </div>
            <ul className="mt-2 space-y-1">
              {(leadHits.data?.items ?? []).map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => setNumber(l.phone ?? "")}
                    className="w-full rounded border border-border p-2 text-left text-xs hover:bg-accent/40"
                  >
                    <div className="truncate font-medium">
                      {l.company || l.firstName || l.jobTitle || "Lead"}
                    </div>
                    <div className="tabular-nums text-muted-foreground">
                      {l.phone}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* History */}
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="flex gap-2 border-b border-border px-5 py-2">
            <Button
              size="sm"
              variant={tab === "calls" ? "default" : "ghost"}
              className="h-8"
              onClick={() => setTab("calls")}
            >
              Call Log
            </Button>
            <Button
              size="sm"
              variant={tab === "missed" ? "default" : "ghost"}
              className="h-8 gap-1.5"
              onClick={() => setTab("missed")}
            >
              <PhoneMissed className="size-3.5" />
              Missed
              {missed.length ? (
                <span className="ms-0.5 rounded-full bg-destructive px-1.5 text-[10px] font-semibold text-destructive-foreground">
                  {missed.length}
                </span>
              ) : null}
            </Button>
            <Button
              size="sm"
              variant={tab === "messages" ? "default" : "ghost"}
              className="h-8 gap-1.5"
              onClick={() => setTab("messages")}
            >
              <MessageSquare className="size-3.5" />
              Messages
            </Button>
            <Button
              size="sm"
              variant={tab === "contacts" ? "default" : "ghost"}
              className="h-8 gap-1.5"
              onClick={() => setTab("contacts")}
            >
              <Users className="size-3.5" />
              Contacts
            </Button>
          </div>

          {tab === "missed" ? (
            <div className="p-4">
              <p className="mb-3 text-xs text-muted-foreground">
                Calls that never connected — ones we missed, and ones we placed
                that were never picked up. Tap to call back.
              </p>
              <div className="space-y-1.5">
                {missed.map((call) => (
                  <div
                    key={call.id}
                    className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2"
                  >
                    {call.direction === "outbound" ? (
                      <PhoneOutgoing
                        className="size-4 shrink-0 text-amber-600"
                        aria-label="They did not pick up"
                      />
                    ) : (
                      <PhoneMissed
                        className="size-4 shrink-0 text-red-600"
                        aria-label="Missed incoming call"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {call.leadName || call.phoneNumber}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {call.leadName ? `${call.phoneNumber} · ` : ""}
                        {call.direction === "outbound"
                          ? "Outgoing · they did not pick up"
                          : "Incoming · missed call"}{" "}
                        · {when(call.createdAt)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="h-8"
                      onClick={() => {
                        setNumber(call.phoneNumber);
                        dial(call.phoneNumber);
                      }}
                      title="Call back"
                    >
                      <Phone className="size-3.5" />
                    </Button>
                  </div>
                ))}
                {!calls.isLoading && missed.length === 0 ? (
                  <p className="py-8 text-center text-muted-foreground">
                    No missed calls.
                  </p>
                ) : null}
              </div>
            </div>
          ) : tab === "contacts" ? (
            <div className="p-4">
              <div className="mb-3 flex gap-2">
                <Input
                  value={contactQuery}
                  onChange={(e) => setContactQuery(e.target.value)}
                  placeholder="Search contacts…"
                  className="h-9"
                />
                <Button
                  className="h-9"
                  onClick={() => setDraft({ ...EMPTY_DRAFT })}
                >
                  <Plus className="size-3.5" />
                  New
                </Button>
              </div>

              {draft ? (
                <div className="mb-3 space-y-2 rounded-md border border-border p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      value={draft.name}
                      onChange={(e) =>
                        setDraft({ ...draft, name: e.target.value })
                      }
                      placeholder="John Smith"
                    />
                    <Input
                      value={draft.phone}
                      onChange={(e) =>
                        setDraft({ ...draft, phone: e.target.value })
                      }
                      placeholder="+1 555 000 0000"
                    />
                    <Input
                      value={draft.email}
                      onChange={(e) =>
                        setDraft({ ...draft, email: e.target.value })
                      }
                      placeholder="name@company.com"
                    />
                    <Input
                      value={draft.requirementTag}
                      onChange={(e) =>
                        setDraft({ ...draft, requirementTag: e.target.value })
                      }
                      placeholder="e.g. Web design inquiry"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        !draft.name.trim() ||
                        !draft.phone.trim() ||
                        saveContact.isPending
                      }
                      onClick={() => saveContact.mutate(draft)}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="space-y-1.5">
                {(contacts.data?.items ?? [])
                  .filter((ct) => {
                    const q = contactQuery.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      ct.name.toLowerCase().includes(q) ||
                      ct.phone.includes(q) ||
                      (ct.requirementTag ?? "").toLowerCase().includes(q)
                    );
                  })
                  .map((ct) => (
                    <div
                      key={ct.id}
                      className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {ct.name}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {ct.phone}
                          {ct.requirementTag ? ` · ${ct.requirementTag}` : ""}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        className="h-8"
                        title={`Call ${ct.name}`}
                        onClick={() => {
                          setNumber(ct.phone);
                          dial(ct.phone);
                        }}
                      >
                        <Phone className="size-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8"
                        title={`Message ${ct.name}`}
                        onClick={() => {
                          setNumber(ct.phone);
                          setTab("messages");
                        }}
                      >
                        <MessageSquare className="size-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        onClick={() =>
                          setDraft({
                            id: ct.id,
                            name: ct.name,
                            phone: ct.phone,
                            email: ct.email ?? "",
                            requirementTag: ct.requirementTag ?? "",
                          })
                        }
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 text-destructive"
                        onClick={() => {
                          if (window.confirm(`Delete ${ct.name}?`))
                            deleteContact.mutate(ct.id);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                {!contacts.isLoading &&
                (contacts.data?.items ?? []).length === 0 ? (
                  <p className="py-8 text-center text-muted-foreground">
                    No contacts yet.
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {tab === "calls" ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-5 py-2 text-left font-medium">Number</th>
                  <th className="px-5 py-2 text-left font-medium">Direction</th>
                  <th className="px-5 py-2 text-left font-medium">Status</th>
                  <th className="px-5 py-2 text-right font-medium">Duration</th>
                  <th className="px-5 py-2 text-right font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {(calls.data?.calls ?? []).map((call) => (
                  <tr key={call.id} className="border-b border-border">
                    <td className="px-5 py-2.5">
                      <div className="tabular-nums">{call.phoneNumber}</div>
                      {call.leadName ? (
                        <div className="text-xs text-muted-foreground">
                          {call.leadName}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-5 py-2.5 text-muted-foreground">
                      {directionLabel(call.direction)}
                    </td>
                    <td className="px-5 py-2.5">{statusLabel(call.status)}</td>
                    <td className="px-5 py-2.5 text-right tabular-nums">
                      {duration(call.duration)}
                    </td>
                    <td className="px-5 py-2.5 text-right text-muted-foreground">
                      {when(call.createdAt)}
                    </td>
                  </tr>
                ))}
                {(calls.data?.calls ?? []).length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-5 py-8 text-center text-muted-foreground"
                    >
                      No calls yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          ) : (
            <div className="p-5">
              <div className="mb-2 flex items-center gap-2">
                <TemplatePicker
                  channel="sms"
                  onPick={(t) => setSmsBody(t.messageBody)}
                />
                <span className="text-xs text-muted-foreground">
                  {smsBody.length}/160
                </span>
              </div>
              <div className="mb-3 flex gap-2">
                <Input
                  value={smsBody}
                  onChange={(e) => setSmsBody(e.target.value)}
                  placeholder={
                    number ? `Message ${number}` : "Enter a number on the keypad first"
                  }
                  className="h-9"
                />
                <Button
                  size="sm"
                  className="h-9"
                  disabled={!number.trim() || !smsBody.trim() || sendSms.isPending}
                  onClick={() =>
                    sendSms.mutate(
                      { to: number.trim(), body: smsBody.trim() },
                      { onSuccess: () => setSmsBody("") },
                    )
                  }
                >
                  Send
                </Button>
              </div>

              <ul className="space-y-2">
                {(messages.data?.items ?? []).map((m) => (
                  <li
                    key={m.id}
                    className={cn(
                      "max-w-[75%] rounded-lg border border-border p-2.5 text-sm",
                      m.direction === "outbound"
                        ? "ms-auto bg-primary/10"
                        : "bg-card",
                    )}
                  >
                    <div className="whitespace-pre-wrap">{m.messageBody}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {m.phoneNumber} · {m.messageType} · {m.messageStatus} ·{" "}
                      {when(m.createdAt)}
                    </div>
                  </li>
                ))}
                {(messages.data?.items ?? []).length === 0 ? (
                  <li className="py-8 text-center text-sm text-muted-foreground">
                    No messages yet.
                  </li>
                ) : null}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/dialer")({
  component: RouteComponent,
});
