/**
 * Communications — the mailbox, ported from the cockpit's Emails tab.
 *
 * Four panes over the same sending domain:
 *
 *   Inbox     live IMAP for the outreach mailbox. This is the "centralised
 *             inbox" from the 2026-08-03 call — replies to Dan's campaigns
 *             arrive here rather than in a separate webmail nobody opens.
 *   Sent      sequences that went out, newest first.
 *   Bounced   dead addresses, and the recovery job. This one earns its place:
 *             it fences off the bad address, finds another human at the same
 *             account, validates, redrafts and re-enrols. With 32 bounces on
 *             a 16-lead pool, recovering even a few is material.
 *   Outbox    manually composed mail, kept apart from campaign sends.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import Layout from "@/components/common/layout";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { leadgen } from "@/fetchers/leadgen/client";
import { toast } from "@/lib/toast";
import { leadgenEmailExtras } from "@/fetchers/leadgen/emails";
import { InboxMessageDialog } from "@/components/leadgen/inbox-message-dialog";
import { SentEmailDialog } from "@/components/leadgen/sent-email-dialog";

type InboxMessage = {
  id: string | number;
  from_name?: string;
  from_email?: string;
  subject?: string;
  date?: string;
  seen?: boolean;
  /** reply | ooo | delivery | other — decided server-side by the inbox agent. */
  category?: string;
  /** What the agent did about it, when it did something worth reporting. */
  agent_note?: string;
  /** Which of Dan's five mailboxes this message belongs to. */
  account?: string;
  to_email?: string;
};

type InboxCounts = {
  reply?: number;
  ooo?: number;
  delivery?: number;
  other?: number;
  all?: number;
};

type Bounced = {
  sequence_id: number;
  company?: string;
  person_name?: string;
  to_email: string;
  angle?: string;
  bounce_at?: number;
  bounce_info?: string;
  requeued?: boolean | number;
  alternate?: { email?: string; person_name?: string } | null;
};

type BouncedResponse = {
  items: Bounced[];
  summary?: {
    total: number;
    with_alternate: number;
    no_alternate: number;
    requeued: number;
  };
  job?: { status?: string; phase?: string; processed?: number; total?: number };
};

type OutboxMessage = {
  id: number;
  to_email?: string;
  subject?: string;
  ts?: number;
};

/*
 * Replies first, delivery notices last.
 *
 * The mailbox is 30 delivery notices to 2 real messages, so an undifferentiated
 * "Inbox" buried the only things worth reading. These map to the categories the
 * inbox agent already decides for every message.
 */
/*
 * No "delivery" tab.
 *
 * 27 of the 40 messages in these mailboxes are bounce notices, and the bounce
 * scanner has already suppressed every address in them, so the tab was a
 * standing pile of work that was in fact already done — "please remove the
 * mail delivery failure" (VK, 2026-08-05).
 *
 * They are filtered OUT of the tab strip, not out of the data: the category is
 * still computed, the notices are still in All, and Recovery still works the
 * bounces. Nothing was deleted, it simply stopped being offered as somewhere
 * to look.
 */
const TABS = [
  "replies",
  "out of office",
  "all",
  "sent",
  "trash",
  "spam",
  "campaign log",
  "recovery",
  "outbox",
  "compose",
] as const;

/** Tab label -> the category the API filters on. */
const TAB_CATEGORY: Record<string, string> = {
  replies: "reply",
  "out of office": "ooo",
  all: "all",
};

/**
 * Which IMAP folder role a tab reads. The first four are all INBOX, split by
 * the agent's category; the rest are real folders on the server.
 *
 * "sent" used to mean the outreach step log, which is a different thing from
 * the mail actually in a Sent folder — a manual reply typed in Zoho never
 * appeared, and neither did anything sent before this system existed.
 */
const TAB_FOLDER: Record<string, string> = {
  replies: "inbox",
  "out of office": "inbox",
  all: "inbox",
  sent: "sent",
  trash: "trash",
  spam: "spam",
};

const MAILBOX_TABS = new Set([
  "replies",
  "out of office",
  "all",
  "sent",
  "trash",
  "spam",
]);

/** Short label for a mailbox chip: the local part is what distinguishes them. */
function shortMailbox(email: string): string {
  return (email || "").split("@")[0] || email;
}

/** Rows per page in Sent. The endpoint caps at 200. */
const SENT_PAGE = 100;
type Tab = (typeof TABS)[number];

function when(value: number | string | undefined): string {
  if (!value) return "—";
  const d =
    typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

function RouteComponent() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("replies");
  /** Which sent email is open in the reader. */
  const [openStep, setOpenStep] = useState<number | null>(null);
  /** Which mailbox message is open in the reader. */
  const [openMsg, setOpenMsg] = useState<{ id: string; note?: string } | null>(
    null,
  );
  const [sentOffset, setSentOffset] = useState(0);
  /** "" = every mailbox. Otherwise one address. */
  const [account, setAccount] = useState("");
  const [draft, setDraft] = useState({ to_email: "", subject: "", body: "" });

  const category = TAB_CATEGORY[tab] ?? "all";
  const folder = TAB_FOLDER[tab] ?? "inbox";

  /** Every mailbox that can be read, for the account filter. */
  const mailboxes = useQuery({
    queryKey: ["leadgen", "mailboxes"],
    queryFn: () =>
      leadgen.get<{ items: { email: string; enabled: boolean }[] }>(
        "/api/emails/mailboxes",
      ),
    staleTime: 300_000,
  });

  const inbox = useQuery({
    queryKey: ["leadgen", "inbox", folder, category, account],
    queryFn: () =>
      leadgen.get<{
        items: InboxMessage[];
        count?: number;
        mailbox?: string;
        counts?: InboxCounts;
        accounts?: string[];
        per_account?: Record<string, number>;
        errors?: { account: string; error: string }[];
      }>("/api/emails/inbox", {
        folder,
        category: folder === "inbox" ? category : "all",
        ...(account ? { account } : {}),
      }),
    enabled: MAILBOX_TABS.has(tab),
    // Counts drive the tab badges, so keep the last set while switching tabs
    // rather than flashing them to zero on every click.
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
  });
  const counts = inbox.data?.counts;

  /** Move a message to its own account's Trash. */
  const trashMsg = useMutation({
    mutationFn: (id: string) =>
      leadgen.del(`/api/emails/inbox/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leadgen", "inbox"] }),
    onError: (e) => toast.error((e as Error).message),
  });

  /*
   * Sent reads /api/emails/recent, not /api/emails/sent.
   *
   * Two reasons. /sent returns a capped snapshot of SEQUENCES, so most of the
   * 800-odd sends were simply unreachable — there was no page two. And its rows
   * are sequence ids, which were being handed to the reader dialog as step ids:
   * every row opened the wrong email or a 404.
   *
   * /recent paginates over email_steps and now returns sequence_id alongside
   * the step id, so the reader gets a step and stop/remove get a sequence.
   */
  const sent = useQuery({
    queryKey: ["leadgen", "recent", sentOffset],
    queryFn: () => leadgenEmailExtras.recent(sentOffset, SENT_PAGE),
    enabled: tab === "campaign log",
    // Keeps the table on screen while the next page loads instead of blanking.
    placeholderData: (prev) => prev,
  });

  const bounced = useQuery({
    queryKey: ["leadgen", "bounced"],
    queryFn: () => leadgen.get<BouncedResponse>("/api/emails/bounced"),
    enabled: tab === "recovery",
  });

  const outbox = useQuery({
    queryKey: ["leadgen", "outbox"],
    queryFn: () => leadgen.get<{ items: OutboxMessage[] }>("/api/emails/outbox"),
    enabled: tab === "outbox",
  });

  const queries = { inbox, sent, bounced, outbox };

  const requeue = useMutation({
    mutationFn: () => leadgen.post("/api/emails/bounced/requeue"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leadgen", "bounced"] }),
  });

  /*
   * Sequence controls. Stopping cancels the PENDING follow-ups and keeps what
   * already went out; deleting only removes it from the Sent log. Both existed
   * in the cockpit and had no equivalent here, so a sequence sent to the wrong
   * person could not be halted from this dashboard at all.
   */
  const stopSeq = useMutation({
    mutationFn: (id: number) => leadgenEmailExtras.stopSequence(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leadgen", "sent"] }),
  });
  const deleteSeq = useMutation({
    mutationFn: (id: number) => leadgenEmailExtras.deleteSequence(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leadgen", "sent"] }),
  });
  const compose = useMutation({
    mutationFn: () => leadgenEmailExtras.compose(draft),
    onSuccess: () => {
      setDraft({ to_email: "", subject: "", body: "" });
      qc.invalidateQueries({ queryKey: ["leadgen", "outbox"] });
    },
  });

  const scanBounces = useMutation({
    mutationFn: () => leadgen.post("/api/emails/scan-bounces"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leadgen"] }),
  });

  // Compose has no query behind it, so the lookup is deliberately partial and
  // callers must tolerate undefined — reading .isLoading off it would crash the
  // tab the moment it opened.
  const active = { inbox, sent, bounced, outbox }[tab as keyof typeof queries] as
    | typeof inbox
    | undefined;
  const summary = bounced.data?.summary;

  return (
    <Layout>
      <PageTitle title="Communications" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <h1 className="text-xl font-semibold">Communications</h1>
        {/*
          "received", not just a bare count. Every number on this page is mail
          that came IN; the send figures live on Home and Outreach. Left
          unqualified, a tab count here gets quoted as a day's send volume.
        */}
        {/*
          "40 received in INBOX" named a folder and not a mailbox, which was
          the confusing part: there are five INBOXes. Say how many accounts the
          number spans, or which one when it is filtered.
        */}
        {MAILBOX_TABS.has(tab) && inbox.data?.count ? (
          <span className="text-sm text-muted-foreground">
            {inbox.data.count} {folder === "sent" ? "sent from" : "in"}{" "}
            {account
              ? account
              : `${inbox.data.accounts?.length ?? 0} mailboxes`}
          </span>
        ) : null}
      </header>

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-1 border-b border-border px-5 py-2">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-sm capitalize ${
                tab === t
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t}
              {(() => {
                const n =
                  t === "replies"
                    ? counts?.reply
                    : t === "out of office"
                      ? counts?.ooo
                      : t === "delivery"
                        ? counts?.delivery
                        : t === "all"
                          ? counts?.all
                          : undefined;
                if (!n) return null;
                // Replies are the only count worth colouring. A big delivery
                // number is not an alert — those addresses are already dealt
                // with, and painting it red reads as "30 problems".
                return (
                  <span
                    className={`ms-1.5 rounded px-1.5 text-xs tabular-nums ${
                      t === "replies"
                        ? "bg-emerald-500/15 text-emerald-500"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {n}
                  </span>
                );
              })()}
            </button>
          ))}
          {tab === "recovery" ? (
            <div className="ms-auto flex gap-2">
              <Button
                variant="outline"
                onClick={() => scanBounces.mutate()}
                disabled={scanBounces.isPending}
              >
                {scanBounces.isPending ? "Scanning…" : "Scan for bounces"}
              </Button>
              <Button
                onClick={() => requeue.mutate()}
                disabled={requeue.isPending || !summary?.with_alternate}
              >
                {requeue.isPending
                  ? "Recovering…"
                  : `Recover ${summary?.with_alternate ?? 0} with an alternate`}
              </Button>
            </div>
          ) : null}
        </div>

        {/*
          Which mailbox. Five accounts send under Dan's name and the page read
          exactly one of them, with nothing on screen saying which — so a reply
          to a second mailbox was invisible and a message that WAS shown could not be
          attributed. The counts are per account so an empty mailbox is
          obviously empty rather than merely absent.
        */}
        {MAILBOX_TABS.has(tab) ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-5 py-2">
            <span className="me-1 text-xs text-muted-foreground">Mailbox</span>
            <button
              type="button"
              onClick={() => setAccount("")}
              className={`rounded-md px-2 py-1 text-xs ${
                account === ""
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              All {inbox.data?.count ? `· ${inbox.data.count}` : ""}
            </button>
            {(mailboxes.data?.items ?? []).map((mb) => {
              const n = inbox.data?.per_account?.[mb.email];
              return (
                <button
                  key={mb.email}
                  type="button"
                  onClick={() => setAccount(mb.email)}
                  title={mb.email + (mb.enabled ? "" : " (retired from sending)")}
                  className={`rounded-md px-2 py-1 text-xs ${
                    account === mb.email
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-muted"
                  } ${mb.enabled ? "" : "opacity-60"}`}
                >
                  {shortMailbox(mb.email)}
                  {typeof n === "number" && account === "" ? (
                    <span className="ms-1 tabular-nums opacity-70">{n}</span>
                  ) : null}
                </button>
              );
            })}
            {inbox.data?.errors?.length ? (
              <span className="ms-auto text-xs text-amber-500">
                {inbox.data.errors.length} mailbox
                {inbox.data.errors.length === 1 ? "" : "es"} could not be read
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="flex-1 overflow-auto p-5">
          {active?.isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : active?.error ? (
            <p className="text-sm text-red-500">{String(active?.error as Error)}</p>
          ) : MAILBOX_TABS.has(tab) ? (
            <>
              {tab === "delivery" ? (
                <p className="mb-3 text-xs text-muted-foreground">
                  Bounce notices. Every address here has already been suppressed
                  from future sending, there is nothing to do by hand.
                </p>
              ) : tab === "sent" ? (
                <p className="mb-3 text-xs text-muted-foreground">
                  Real mail from each mailbox's Sent folder on the server, which
                  includes anything sent by hand from webmail. The campaign log
                  tab is the separate record of what this system sent.
                </p>
              ) : null}

              <ul className="divide-y divide-border rounded-lg border border-border">
                {(inbox.data?.items ?? []).map((m) => (
                  <li key={m.id} className="group relative text-sm">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenMsg({
                          id: String(m.id),
                          note: m.agent_note || undefined,
                        })
                      }
                      className="w-full px-3 py-2 pe-24 text-start hover:bg-muted/50"
                    >
                    <div className="flex gap-3">
                      <span
                        className={`w-56 shrink-0 truncate ${
                          m.category === "delivery"
                            ? "text-muted-foreground"
                            : m.seen
                              ? "text-muted-foreground"
                              : "font-medium"
                        }`}
                      >
                        {m.from_name || m.from_email || "—"}
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate ${
                          m.category === "delivery" || m.seen
                            ? "text-muted-foreground"
                            : ""
                        }`}
                      >
                        {m.subject || "(no subject)"}
                      </span>
                      {tab === "all" && m.category && m.category !== "other" ? (
                        <span className="shrink-0 rounded bg-muted px-1.5 text-xs text-muted-foreground">
                          {m.category === "ooo" ? "away" : m.category}
                        </span>
                      ) : null}
                      {/*
                        Which mailbox this landed in (or went out from). Only
                        shown when looking at all of them, since a filtered
                        view already answers it in the chip above.
                      */}
                      {account === "" && m.account ? (
                        <span className="shrink-0 rounded bg-muted px-1.5 text-xs text-muted-foreground">
                          {shortMailbox(m.account)}
                        </span>
                      ) : null}
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {when(m.date)}
                      </span>
                    </div>
                    {/*
                      What the agent did. This is the only place the automation
                      is visible — without it, a deferred follow-up and a
                      forgotten one look identical.
                    */}
                    {m.agent_note ? (
                      <div className="mt-0.5 ps-1 text-xs text-emerald-500">
                        {m.agent_note}
                      </div>
                    ) : null}
                    </button>
                    {/*
                      Trash, in the message's OWN account. Hidden until hover so
                      it cannot be hit while scanning the list, and absent in
                      Trash itself where it would mean permanent deletion.
                    */}
                    {tab !== "trash" ? (
                      <button
                        type="button"
                        onClick={() => trashMsg.mutate(String(m.id))}
                        disabled={trashMsg.isPending}
                        title="Move to Trash"
                        className="absolute end-2 top-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100 disabled:opacity-40"
                      >
                        Trash
                      </button>
                    ) : null}
                  </li>
                ))}
                {!inbox.data?.items?.length ? (
                  <li className="px-3 py-6 text-sm text-muted-foreground">
                    {tab === "replies"
                      ? "Nobody has written back yet. Real replies land here, bounce notices and out-of-office are filed separately."
                      : tab === "out of office"
                        ? "No out-of-office replies. When one arrives, the follow-ups are pushed past the return date automatically."
                        : tab === "delivery"
                          ? "No delivery failures."
                          : tab === "sent"
                            ? "Nothing in this mailbox's Sent folder. This is real mail on the server, including anything sent by hand from webmail."
                            : tab === "trash"
                              ? "Trash is empty."
                              : tab === "spam"
                                ? "Nothing in Spam."
                                : "Nothing here."}
                  </li>
                ) : null}
              </ul>
            </>
          ) : tab === "campaign log" ? (
            <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    {[
                      "Company",
                      "Person",
                      "To",
                      "Subject",
                      "Step",
                      "Opens",
                      "Clicks",
                      "Sent",
                      "",
                    ].map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap px-3 py-2 font-medium text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(sent.data?.items ?? []).map((r) => (
                    <tr
                      key={r.id}
                      className="cursor-pointer border-t border-border hover:bg-muted/40"
                      onClick={() => setOpenStep(r.id)}
                    >
                      <td className="px-3 py-2">{r.company || "—"}</td>
                      <td className="px-3 py-2">{r.person_name || "—"}</td>
                      <td className="px-3 py-2">{r.to_email}</td>
                      <td className="max-w-64 truncate px-3 py-2 text-muted-foreground">
                        {r.subject || "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {r.step_index === 0
                          ? "opener"
                          : r.step_index
                            ? `follow-up ${r.step_index}`
                            : "—"}
                      </td>
                      {/*
                        Opens and clicks arrive already filtered for scanner
                        traffic — districts run Proofpoint and Safe Links, which
                        auto-open every link. An unfiltered number here would be
                        flattering and wrong.
                      */}
                      <td
                        className={`px-3 py-2 tabular-nums ${r.open_count ? "text-emerald-500" : "text-muted-foreground"}`}
                      >
                        {r.open_count ?? 0}
                      </td>
                      <td
                        className={`px-3 py-2 tabular-nums ${r.click_count ? "text-emerald-500" : "text-muted-foreground"}`}
                      >
                        {r.click_count ?? 0}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {r.sent_at
                          ? new Date(r.sent_at * 1000).toLocaleString()
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {r.bounced ? (
                          <span className="me-3 text-xs text-red-500">
                            bounced
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            stopSeq.mutate(r.sequence_id);
                          }}
                          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        >
                          stop follow-ups
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteSeq.mutate(r.sequence_id);
                          }}
                          className="ms-3 text-xs text-red-500 underline underline-offset-2"
                        >
                          remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(() => {
              const totalRows = sent.data?.total ?? 0;
              const shown = sent.data?.items?.length ?? 0;
              const from = totalRows ? sentOffset + 1 : 0;
              return (
                <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {from}–{sentOffset + shown} of {totalRows}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ms-auto"
                    disabled={sentOffset === 0}
                    onClick={() =>
                      setSentOffset((o) => Math.max(0, o - SENT_PAGE))
                    }
                  >
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={sentOffset + shown >= totalRows}
                    onClick={() => setSentOffset((o) => o + SENT_PAGE)}
                  >
                    Next
                  </Button>
                </div>
              );
            })()}
          </>
          ) : tab === "recovery" ? (
            <>
              {summary ? (
                <p className="mb-3 text-xs text-muted-foreground">
                  {summary.total} bounced · {summary.with_alternate} have another
                  contact at the same account · {summary.no_alternate} do not ·{" "}
                  {summary.requeued} already recovered.
                  {summary.no_alternate > 0
                    ? " Accounts with no alternate need contact enrichment before they can be reached again."
                    : ""}
                </p>
              ) : null}
              {requeue.error ? (
                <p className="mb-3 text-xs text-red-500">
                  {String(requeue.error as Error)}
                </p>
              ) : null}
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      {["Company", "Address", "Reason", "Alternate", "When"].map(
                        (h) => (
                          <th
                            key={h}
                            className="whitespace-nowrap px-3 py-2 font-medium text-muted-foreground"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {(bounced.data?.items ?? []).map((b) => (
                      <tr key={b.sequence_id} className="border-t border-border">
                        <td className="px-3 py-2">{b.company || "—"}</td>
                        <td className="px-3 py-2">{b.to_email}</td>
                        <td
                          className="max-w-sm truncate px-3 py-2 text-muted-foreground"
                          title={b.bounce_info}
                        >
                          {b.bounce_info || "—"}
                        </td>
                        <td className="px-3 py-2">
                          {b.alternate?.email ? (
                            <span className="text-emerald-500">
                              {b.alternate.email}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">none</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          {when(b.bounce_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : tab === "compose" ? (
            <div className="max-w-2xl rounded-lg border border-border bg-card p-4">
              <div className="text-sm font-semibold">Send a one-off email</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Goes out from the rotating outreach mailbox, tracked like any
                campaign send and counted against the same daily cap.
              </p>
              {(["to_email", "subject"] as const).map((field) => (
                <label key={field} className="mt-3 block">
                  <span className="mb-1 block text-xs text-muted-foreground">
                    {field === "to_email" ? "To" : "Subject"}
                  </span>
                  <input
                    value={draft[field]}
                    onChange={(e) =>
                      setDraft({ ...draft, [field]: e.target.value })
                    }
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                  />
                </label>
              ))}
              <label className="mt-3 block">
                <span className="mb-1 block text-xs text-muted-foreground">
                  Message
                </span>
                <textarea
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  rows={10}
                  className="w-full rounded-md border border-border bg-background p-2 text-sm"
                />
              </label>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  onClick={() => compose.mutate()}
                  disabled={
                    compose.isPending ||
                    !draft.to_email.trim() ||
                    !draft.subject.trim()
                  }
                >
                  {compose.isPending ? "Sending…" : "Send"}
                </Button>
                {compose.error ? (
                  <span className="text-xs text-red-500">
                    {String(compose.error as Error)}
                  </span>
                ) : null}
                {compose.isSuccess ? (
                  <span className="text-xs text-emerald-500">Sent.</span>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left">
                  <tr>
                    {["To", "Subject", "Sent"].map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap px-3 py-2 font-medium text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(outbox.data?.items ?? []).map((m) => (
                    <tr key={m.id} className="border-t border-border">
                      <td className="px-3 py-2">{m.to_email || "—"}</td>
                      <td className="px-3 py-2">{m.subject || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                        {when(m.ts)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!outbox.data?.items?.length ? (
                <p className="px-3 py-6 text-sm text-muted-foreground">
                  Nothing sent manually yet.
                </p>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {openStep !== null ? (
        <SentEmailDialog stepId={openStep} onClose={() => setOpenStep(null)} />
      ) : null}

      {openMsg ? (
        <InboxMessageDialog
          messageId={openMsg.id}
          agentNote={openMsg.note}
          onClose={() => setOpenMsg(null)}
        />
      ) : null}
    </Layout>
  );
}

export const Route = createFileRoute("/_layout/_authenticated/communications")({
  component: RouteComponent,
});
