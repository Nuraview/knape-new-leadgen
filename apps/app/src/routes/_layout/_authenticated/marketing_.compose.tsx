/**
 * Compose — ported from apps/web/app/(routes)/marketing/compose/page.tsx.
 *
 * The composer was the last thing still opening the legacy app in a new tab.
 * Field order and behaviour follow the original deliberately: template picker,
 * To (+ CC/BCC behind a toggle), subject, Cap video link, body, signature
 * preview, follow-up steps. People send from this screen every day and moving
 * things around costs more than it gains.
 *
 * The signature block is the client's approved asset — rendered by the server
 * from the same helper the send path uses, never re-typed here. If it looks
 * wrong, the fix belongs in email-signature.ts, not in this file.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Loader2,
  Send,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import Layout from "@/components/common/layout";
import { CkEditor } from "@/components/marketing/ck-editor";
import { useSignatureHtml } from "@/hooks/use-signature";
import PageTitle from "@/components/page-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { getApiUrl } from "@/fetchers/get-api-url";
import { toast } from "@/lib/toast";

export const Route = createFileRoute(
  "/_layout/_authenticated/marketing_/compose",
)({
  component: RouteComponent,
});

type Sender = {
  id: string;
  label: string;
  fromEmail: string;
};

type Template = {
  id: number;
  name: string | null;
  subject: string | null;
  body: string | null;
};

type Verdict = { reachable?: string };

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(getApiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error((data as { error?: string }).error || `Failed (${r.status})`);
  }
  return data as T;
}

function RouteComponent() {
  const navigate = useNavigate();
  const signatureHtml = useSignatureHtml();

  const [templateId, setTemplateId] = useState("");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [loomLink, setLoomLink] = useState("");
  const [body, setBody] = useState("");
  const [fromSenderId, setFromSenderId] = useState("");
  const [includeSignature, setIncludeSignature] = useState(true);
  const [showSignaturePreview, setShowSignaturePreview] = useState(true);

  const [enableFollowup, setEnableFollowup] = useState(false);
  /*
   * The real follow-up copy from the legacy composer, verbatim — multi-
   * paragraph HTML with the booking link, not the one-line placeholders I
   * invented. These are the messages that actually go to clients; replacing
   * them with "Just following up on my previous email." changed what the
   * business says.
   */
  const [f1, setF1] = useState(
    '<p>I trust you had a chance to review my previous email.</p><p>Have you had any further thoughts?</p><p>I completely understand that working with someone new can feel uncertain, if it helps, we can start with a small test project.</p><p>If you\'re considering, simply respond <strong>YES</strong> or schedule a quick call here:<br><a href="https://tidycal.com/vkumar">https://tidycal.com/vkumar</a></p><p>Thanks</p>',
  );
  const [f2, setF2] = useState(
    "<p>Should We Start with a Small Test? Just checking in again.</p><p>If scheduling a call feels difficult due to your current workload, feel free to reply directly here with:</p><p>1. Any questions you may have<br>2. A file or brief you'd like us to review<br>3. Or even a small task we can execute as a test</p><p>We can evaluate it and either proceed with a test project or move forward with the actual scope, whatever feels more comfortable for you.</p><p>Happy to make this simple and low-risk.</p><p>Looking forward to your thoughts.</p>",
  );
  const [f3, setF3] = useState(
    "<p>I just wanted to quickly check in.</p><p>Is the hesitation around timing, trust, or has this project shifted in priority for now?</p><p>Completely understand either way, a quick reply would help me close the loop on my end.</p><p>If you'd still like to explore, just reply <strong>YES</strong> and we'll move forward.</p><p>Thanks again.</p>",
  );

  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const { data: senders } = useQuery({
    queryKey: ["marketing", "senders"],
    queryFn: async (): Promise<{ items: Sender[] }> => {
      const r = await fetch(getApiUrl("marketing/senders"), {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load senders");
      return r.json();
    },
  });

  const { data: templates } = useQuery({
    queryKey: ["marketing", "templates"],
    queryFn: async (): Promise<{ items: Template[] }> => {
      const r = await fetch(getApiUrl("marketing/templates"), {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Failed to load templates");
      return r.json();
    },
  });

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates?.items.find((x) => String(x.id) === id);
    if (!t) return;
    if (t.subject) setSubject(t.subject);
    // Templates store body_html; the editor takes HTML.
    if (t.body) setBody(t.body);
  };

  // Deliverability pre-check. The send path enforces the same verdict and 422s
  // on "invalid", so surfacing it here turns a rejected send into a warning
  // before the click rather than an error after it.
  const check = useMutation({
    mutationFn: (email: string) =>
      postJson<Verdict>("marketing/validate-email", { email }),
    onSuccess: setVerdict,
    onError: () => setVerdict(null),
  });

  const send = useMutation({
    mutationFn: () =>
      postJson<{ messageId?: string }>("marketing/send", {
        to: to.trim(),
        cc: cc.trim() || undefined,
        bcc: bcc.trim() || undefined,
        subject: subject.trim(),
        // bodyHtml, not bodyText — the editor produces HTML and that is what
        // the recipient's mail client renders. Sending it as text would strip
        // every bit of the formatting just typed.
        bodyHtml: body,
        loomLink: loomLink.trim() || undefined,
        includeSignature,
        enableFollowup,
        followup1Body: f1,
        followup2Body: f2,
        followup3Body: f3,
        fromSenderId: fromSenderId || undefined,
      }),
    onSuccess: () => {
      toast.success("Email sent");
      navigate({ to: "/marketing", search: { view: "sent" } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSend =
    to.trim().length > 0 && subject.trim().length > 0 && body.trim().length > 0;

  return (
    <Layout>
      <PageTitle title="Compose" />

      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-5">
        <SidebarTrigger className="-ms-1" />
        <button
          type="button"
          onClick={() => navigate({ to: "/marketing" })}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Marketing
        </button>
        <h1 className="text-xl font-semibold">Compose</h1>
        <Button
          className="ms-auto"
          size="sm"
          disabled={!canSend || send.isPending}
          onClick={() => send.mutate()}
        >
          {send.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          Send
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-5">
        <div className="mx-auto w-full max-w-3xl space-y-4">
          <Field label="Template">
            <select
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">— Start from scratch —</option>
              {templates?.items.map((t) => (
                <option key={t.id} value={String(t.id)}>
                  {t.name ?? `Template ${t.id}`}
                </option>
              ))}
            </select>
          </Field>

          <Field label="From">
            <select
              value={fromSenderId}
              onChange={(e) => setFromSenderId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            >
              <option value="">Auto (A/B across senders)</option>
              {senders?.items.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label} · {s.fromEmail}
                </option>
              ))}
            </select>
          </Field>

          <Field label="To">
            <Input
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setVerdict(null);
              }}
              onBlur={() => {
                const v = to.trim();
                if (v.includes("@")) check.mutate(v);
              }}
              placeholder="recipient@example.com"
            />
            <div className="mt-1 flex items-center justify-between">
              <span className="text-xs">
                {check.isPending ? (
                  <span className="text-muted-foreground">Checking…</span>
                ) : verdict?.reachable === "invalid" ? (
                  <span className="inline-flex items-center gap-1 text-destructive">
                    <ShieldAlert className="size-3.5" />
                    Mailbox does not exist — this would bounce
                  </span>
                ) : verdict?.reachable ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="size-3.5" />
                    {verdict.reachable}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => setShowCcBcc((v) => !v)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {showCcBcc ? "Hide CC/BCC" : "Show CC/BCC"}
              </button>
            </div>
          </Field>

          {showCcBcc ? (
            <>
              <Field label="CC">
                <Input value={cc} onChange={(e) => setCc(e.target.value)} />
              </Field>
              <Field label="BCC">
                <Input value={bcc} onChange={(e) => setBcc(e.target.value)} />
              </Field>
            </>
          ) : null}

          <Field label="Subject">
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject line…"
            />
          </Field>

          <Field label="Cap video link">
            <Input
              value={loomLink}
              onChange={(e) => setLoomLink(e.target.value)}
              placeholder="https://cap.nuraview.com/s/…"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Paste the share link (or the embed code — we convert it). Added at
              the end of the email as a clickable animated preview; iframes never
              render in email clients.
            </p>
          </Field>

          <Field label="Message">
            {/*
              The same CKEditor the legacy CRM uses, with its own stylesheet —
              not a lookalike. uploadUrl turns on inline images through the
              adapter contract it already expects.
            */}
            <CkEditor
              content={body}
              onChange={setBody}
              placeholder="Write your message…"
              uploadUrl={getApiUrl("marketing/upload-image")}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeSignature}
              onChange={(e) => setIncludeSignature(e.target.checked)}
            />
            Include email signature
          </label>

          {/*
            Signature preview, as the legacy composer has it. The block is the
            client's approved asset and is rendered from the SAME constant the
            send path appends, so what is previewed is what goes out — not a
            re-typed copy that can drift.
          */}
          {includeSignature ? (
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
              <button
                type="button"
                onClick={() => setShowSignaturePreview((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {showSignaturePreview ? (
                  <ChevronUp className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
                Signature Preview
              </button>
              {showSignaturePreview ? (
                <div className="mt-3 border-t border-border/50 pt-3">
                  <div
                    className="pointer-events-none origin-top-left scale-90 opacity-80"
                    // biome-ignore lint/security/noDangerouslySetInnerHtml: our own constant, not user input
                    dangerouslySetInnerHTML={{ __html: signatureHtml }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-xl border border-border p-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={enableFollowup}
                onChange={(e) => setEnableFollowup(e.target.checked)}
              />
              Schedule follow-ups
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              Three steps, sent +6h, +24h and +36h after this email, as replies
              on the same thread. Cancelled automatically if they reply.
            </p>

            {enableFollowup ? (
              <div className="mt-3 space-y-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Follow-up Messages
                </p>
                {(
                  [
                    ["6 hours (Follow-up #1)", f1, setF1],
                    ["24 hours (Follow-up #2)", f2, setF2],
                    ["36 hours (Follow-up #3)", f3, setF3],
                  ] as const
                ).map(([label, value, setter]) => (
                  <div key={label}>
                    <label className="text-xs text-muted-foreground">
                      {label}
                    </label>
                    <div className="mt-1">
                      {/* CKEditor here too. These are real client-facing
                          messages with links and emphasis — a textarea
                          silently strips all of it. */}
                      <CkEditor
                        content={value}
                        onChange={setter}
                        uploadUrl={getApiUrl("marketing/upload-image")}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Layout>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}
