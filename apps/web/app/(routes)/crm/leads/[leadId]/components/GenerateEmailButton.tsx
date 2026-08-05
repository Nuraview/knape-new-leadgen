"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Copy, Check, Send, Eye, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { EMAIL_SIGNATURE_HTML } from "@/lib/marketing/email-signature";
import {
  buildCapPreviewUrl,
  buildCapShareUrl,
  extractCapVideoId,
  rescueCapEmbedFromBody,
} from "@/lib/videos/cap-link";
import { DeliverabilityCheck } from "@/components/marketing/deliverability-check";
import dynamic from "next/dynamic";

// Dynamic import for CKEditor — keeps the 500KB+ bundle off the initial paint
const CkEditor = dynamic(
  () =>
    import("@/components/marketing/ui/ck-editor").then((mod) => mod.CkEditor),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-[250px] rounded-lg border border-input bg-card px-4 py-3 flex items-center justify-center text-muted-foreground">
        Loading editor...
      </div>
    ),
  }
);

// Updated setup: the four follow-ups (email2..email5) go out at these offsets
// from the initial send (must match UPDATED_FOLLOWUP_DELAYS_SEC in the
// send-email route).
const UPDATED_FOLLOWUP_LABELS = ["10 min", "3h", "9h", "24h"];
// Current setup: email2..email4, scheduled at +3h / +6h / +24h (must match the
// current-setup delays in the send-email route). None are threaded — every
// follow-up is a standalone email.
const CURRENT_FOLLOWUP_LABELS = ["3h", "6h", "24h"];

interface GenerateEmailButtonProps {
  firstName: string;
  lastName: string;
  company: string;
  jobTitle: string;
  description: string;
  recipientEmail?: string;
  /** Secondary email — auto-populated into the CC field per client request. */
  secondaryEmail?: string;
  leadId?: string;
  /** Cap share URL saved on the lead — embedded as a GIF thumbnail card at send time. */
  videoLink?: string | null;
  onEmailSent?: () => void;
  /** Pre-saved generated email subject (from DB) */
  initialSubject?: string | null;
  /** Pre-saved generated email body (from DB) */
  initialBody?: string | null;
  /** Callback to persist generated email to DB */
  onSaveEmail?: (data: { subject: string; body: string }) => Promise<void>;
}

export function GenerateEmailButton({
  firstName,
  lastName,
  company,
  jobTitle,
  description,
  recipientEmail = "",
  secondaryEmail = "",
  leadId = "",
  videoLink = null,
  onEmailSent,
  initialSubject,
  initialBody,
  onSaveEmail,
}: GenerateEmailButtonProps) {
  const [loading, setLoading] = useState(false);
  // "current" → original single-email generator (port 8000).
  // "updated" → new agent (port 8002) that drafts a warm-up email + four
  //   follow-ups, sent at 10 min / 3h / 9h / 24h in the same thread.
  const [setupMode, setSetupMode] = useState<"current" | "updated">("current");
  const [generatedEmail, setGeneratedEmail] = useState<{
    subject: string;
    body: string;
  } | null>(null);
  // The four agent-written follow-ups (updated setup only). `followups` holds
  // the plain display copies; `editableFollowups` holds the HTML copies bound
  // to the editors. They stay index-aligned.
  const [followups, setFollowups] = useState<
    { subject: string; body: string }[]
  >([]);
  const [editableFollowups, setEditableFollowups] = useState<
    { subject: string; body: string }[]
  >([]);
  const [followupPreviewOpen, setFollowupPreviewOpen] = useState<
    Record<number, boolean>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"subject" | "body" | null>(null);

  // Send form state
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [toEmail, setToEmail] = useState(recipientEmail);
  // CC defaults to the lead's secondary email (client request); BCC is opt-in.
  const [ccEmail, setCcEmail] = useState(secondaryEmail);
  const [bccEmail, setBccEmail] = useState("");
  const [editableSubject, setEditableSubject] = useState("");
  const [editableBody, setEditableBody] = useState("");
  // Editable in the review dialog; pre-filled from the lead's stored video_link.
  const [videoUrl, setVideoUrl] = useState(videoLink || "");

  // "Send from" identity picker. Options come from /api/marketing/senders
  // (creative-hive + nuraview.us when configured). Empty senderId → the server
  // default (creative-hive). The chosen id is posted as `fromSenderId` and the
  // scheduled follow-ups inherit it.
  const [senders, setSenders] = useState<{ id: string; label: string }[]>([]);
  const [senderId, setSenderId] = useState<string>("");

  useEffect(() => {
    setVideoUrl(videoLink || "");
  }, [videoLink]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/marketing/senders")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (cancelled) return;
        // API shape is { senders: [{id,label}, ...] } — not a bare array.
        const list = Array.isArray(data?.senders)
          ? data.senders
          : Array.isArray(data)
            ? data
            : [];
        setSenders(list);
        // Default to the first (creative-hive) so the From is always explicit.
        setSenderId((prev) => prev || list[0]?.id || "");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Users habitually paste Cap's iframe embed code (it never renders in
  // email). Convert it wherever it lands: body → strip + attach as link;
  // link field → normalize to the canonical share URL.
  const handleEditableBodyChange = (next: string) => {
    const rescued = rescueCapEmbedFromBody(next);
    if (rescued) {
      setEditableBody(rescued.cleaned);
      setVideoUrl((prev) => prev || rescued.shareUrl);
      toast.success("Video embed code converted — attached as Cap video link");
      return;
    }
    setEditableBody(next);
  };
  const handleVideoUrlChange = (next: string) => {
    const id = extractCapVideoId(next);
    setVideoUrl(id && next.includes("<") ? buildCapShareUrl(id) : next);
  };
  const previewVideoId = videoUrl.trim() ? extractCapVideoId(videoUrl) : null;
  const [includeSignature, setIncludeSignature] = useState(true);
  const [showSignaturePreview, setShowSignaturePreview] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Follow-up timing labels + threading semantics differ by setup:
  //  - current: +3h / +6h / +24h; every follow-up is a standalone email (none
  //    threaded).
  //  - updated: +10 min / +3h / +9h / +24h; only email2 replies in-thread, the
  //    rest go out as standalone emails with the same subject.
  const followupLabels =
    setupMode === "updated" ? UPDATED_FOLLOWUP_LABELS : CURRENT_FOLLOWUP_LABELS;
  const isThreadedReply = (idx: number) =>
    setupMode === "updated" && idx === 0;

  // Restore persisted email draft from DB on mount
  useEffect(() => {
    if (initialSubject && initialBody) {
      setGeneratedEmail({ subject: initialSubject, body: initialBody });
      setEditableSubject(initialSubject);
      setEditableBody(initialBody);
    }
  }, [initialSubject, initialBody]);

  const copyToClipboard = (text: string, type: "subject" | "body") => {
    navigator.clipboard.writeText(text);
    setCopied(type);
    toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} copied!`);
    setTimeout(() => setCopied(null), 2000);
  };

  /**
   * Convert plain-text body (newlines) to simple HTML paragraphs
   * so CKEditor renders it properly.
   */
  function textToHtml(text: string): string {
    // If it already contains HTML tags, return as-is
    if (/<[a-z][\s\S]*>/i.test(text)) return text;
    return text
      .split(/\n{2,}/)
      .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
      .join("");
  }

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/leads/generate-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          description: `Person: ${firstName} ${lastName}\nCompany: ${company}\nJob Title: ${jobTitle}\nDescription: ${description}`,
          mode: setupMode,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.detail || data.error || `Error ${response.status}`);
      }

      const subject = data.subject || "No subject received";
      const body = data.body || "No body received";

      setGeneratedEmail({ subject, body });
      setEditableSubject(subject);
      // Convert plain text to HTML for CKEditor
      setEditableBody(textToHtml(body));

      // Both setups return AI-written follow-ups now (current: email2..email4;
      // updated: email2..email5). Show whatever the generator returned.
      if (Array.isArray(data.followups) && data.followups.length > 0) {
        const fus = (
          data.followups as { subject?: string; body?: string }[]
        ).map((f) => ({
          subject: f.subject || `Re: ${subject}`,
          body: f.body || "",
        }));
        setFollowups(fus);
        setEditableFollowups(
          fus.map((f) => ({ subject: f.subject, body: textToHtml(f.body) })),
        );
        setFollowupPreviewOpen({});
      } else {
        setFollowups([]);
        setEditableFollowups([]);
        setFollowupPreviewOpen({});
      }

      // Persist to DB so it survives navigation
      if (onSaveEmail) {
        try {
          await onSaveEmail({ subject, body: textToHtml(body) });
        } catch {
          // Don't fail the generation if persistence fails
          console.warn("[GenerateEmail] Failed to persist draft to DB");
        }
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate email"
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!toEmail?.trim()) {
      toast.error("Please enter a recipient email");
      return;
    }

    setSendingEmail(true);
    try {
      const response = await fetch(`/api/leads/${leadId}/send-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: toEmail,
          cc: ccEmail,
          bcc: bccEmail,
          subject: editableSubject,
          body: editableBody,
          videoLink: videoUrl.trim() || undefined,
          includeSignature,
          fromSenderId: senderId || undefined,
          mode: setupMode,
          // Both setups send AI-written follow-ups only. The send route applies
          // the per-setup delays + threading.
          followups: editableFollowups.map((f) => ({
            subject: f.subject,
            body: f.body,
          })),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to send email");
      }

      toast.success(
        editableFollowups.length > 0
          ? `Email sent! ${editableFollowups.length} follow-ups scheduled (${followupLabels
              .slice(0, editableFollowups.length)
              .join(" / ")}).`
          : "Email sent successfully!"
      );
      setShowSendDialog(false);
      setGeneratedEmail(null);
      setFollowups([]);
      setEditableFollowups([]);
      setFollowupPreviewOpen({});
      setEditableSubject("");
      setEditableBody("");
      setToEmail(recipientEmail || "");
      setCcEmail(secondaryEmail || "");
      setBccEmail("");

      // Clear persisted draft from DB after successful send
      if (onSaveEmail) {
        // We pass empty strings which the PATCH will store as null
        // (the API normalizes empty → null for NullableText fields)
        void onSaveEmail({ subject: "", body: "" }).catch(() => {});
      }

      onEmailSent?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send email");
    } finally {
      setSendingEmail(false);
    }
  };

  // Main generate button and display
  if (!generatedEmail) {
    return (
      <div className="space-y-4">
        {/* Setup selector: current = single email; updated = email + AI follow-up */}
        <div>
          <div className="flex rounded-lg border border-border p-1">
            <button
              type="button"
              onClick={() => setSetupMode("current")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                setupMode === "current"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Current setup
            </button>
            <button
              type="button"
              onClick={() => setSetupMode("updated")}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                setupMode === "updated"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Updated setup
            </button>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {setupMode === "updated"
              ? "Warm-up email + 4 follow-ups (10 min / 3h / 9h / 24h). The 10-min one replies in-thread; the last 3 are sent individually with the same subject."
              : "Initial email + 3 AI follow-ups (3h / 6h / 24h), each sent as a separate email (not threaded), same subject."}
          </p>
        </div>

        <Button
          onClick={handleGenerate}
          disabled={loading}
          className="w-full"
          variant="default"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            "Generate Email"
          )}
        </Button>

        {error && (
          <Card className="border-red-500 bg-red-50">
            <CardContent className="pt-6">
              <p className="text-sm text-red-700">{error}</p>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Generated email preview
  return (
    <div className="space-y-4">
      {followups.length > 0 && (
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <span>1 · Initial Email</span>
          <span className="text-[10px] font-normal normal-case text-muted-foreground/70">
            (sent immediately)
          </span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Subject</CardTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => copyToClipboard(generatedEmail.subject, "subject")}
            >
              {copied === "subject" ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground line-clamp-3">
              {generatedEmail.subject}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Body</CardTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => copyToClipboard(generatedEmail.body, "body")}
            >
              {copied === "body" ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground line-clamp-4 whitespace-pre-wrap">
              {generatedEmail.body}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Follow-ups (updated setup) — shown in the same format as the initial
          email so they can be reviewed together. Sent at 10 min / 3h / 9h / 24h. */}
      {followups.map((fu, idx) => (
        <div key={idx} className="space-y-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span>
              {idx + 2} · Follow-up {idx + 1}
            </span>
            <span className="text-[10px] font-normal normal-case text-muted-foreground/70">
              (sent {followupLabels[idx] ?? ""} later ·{" "}
              {isThreadedReply(idx)
                ? "reply, same thread"
                : "separate email, same subject"})
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base">Subject</CardTitle>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    copyToClipboard(
                      isThreadedReply(idx)
                        ? `Re: ${generatedEmail.subject}`
                        : generatedEmail.subject,
                      "subject",
                    )
                  }
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {isThreadedReply(idx)
                    ? `Re: ${generatedEmail.subject}`
                    : generatedEmail.subject}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                <CardTitle className="text-base">Body</CardTitle>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copyToClipboard(fu.body, "body")}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-4 whitespace-pre-wrap">
                  {fu.body}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      ))}

      <div className="flex gap-2">
        <Button
          onClick={() => {
            setGeneratedEmail(null);
            setFollowups([]);
            setEditableFollowups([]);
            setFollowupPreviewOpen({});
            // Also clear the persisted draft
            if (onSaveEmail) {
              void onSaveEmail({ subject: "", body: "" }).catch(() => {});
            }
          }}
          variant="outline"
          className="flex-1"
        >
          Back
        </Button>
        <Button
          onClick={() => {
            setShowSendDialog(true);
            setToEmail(recipientEmail || "");
            setCcEmail(secondaryEmail || "");
          }}
          className="flex-1"
        >
          <Eye className="mr-2 h-4 w-4" />
          Review Email
        </Button>
      </div>

      {/* Review Email Dialog — flex column: fixed header, scrollable middle,
          fixed footer. Only the middle scrolls, so the action buttons and
          recipient fields never disappear behind a long body. */}
      <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
        <DialogContent
          className="flex max-h-[92vh] w-[95vw] max-w-6xl flex-col gap-0 overflow-hidden p-0"
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter sends — but only when the Send button itself would
            // be enabled (same guard as its `disabled` rule below), so an empty
            // To/Subject or an in-flight send can't be triggered by the shortcut.
            if (
              (e.metaKey || e.ctrlKey) &&
              e.key === "Enter" &&
              !sendingEmail &&
              toEmail?.trim() &&
              editableSubject?.trim()
            ) {
              e.preventDefault();
              void handleSend();
            }
          }}
        >
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>Review Email</DialogTitle>
          </DialogHeader>

          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
            {/* Send-from identity picker: which domain this email (and its
                follow-ups) go out as. Always shown when at least one identity is
                configured so the sender is explicit; add more via *_SMTP_* env. */}
            {senders.length > 0 && (
              <div>
                <label className="mb-2 block text-sm font-semibold text-foreground">
                  Send from
                </label>
                <select
                  value={senderId}
                  onChange={(e) => setSenderId(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground shadow-sm transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                >
                  {senders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  The initial email and all follow-ups send from this address.
                </p>
              </div>
            )}

            {/* Recipients: To + CC + BCC */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-2 block text-sm font-semibold text-foreground">
                  To
                </label>
                <input
                  type="email"
                  value={toEmail}
                  onChange={(e) => setToEmail(e.target.value)}
                  placeholder="recipient@example.com"
                  className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                />
                <DeliverabilityCheck email={toEmail} />
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-foreground">
                  CC
                </label>
                <input
                  type="text"
                  value={ccEmail}
                  onChange={(e) => setCcEmail(e.target.value)}
                  placeholder="cc@example.com"
                  className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                />
                {secondaryEmail && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Auto-filled from secondary email
                  </p>
                )}
              </div>
              <div>
                <label className="mb-2 block text-sm font-semibold text-foreground">
                  BCC
                </label>
                <input
                  type="text"
                  value={bccEmail}
                  onChange={(e) => setBccEmail(e.target.value)}
                  placeholder="bcc@example.com"
                  className="w-full rounded-lg border border-input bg-background px-4 py-2.5 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                />
              </div>
            </div>

            {/* Subject — larger styling */}
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Subject
              </label>
              <input
                type="text"
                value={editableSubject}
                onChange={(e) => setEditableSubject(e.target.value)}
                placeholder="Subject line..."
                className="w-full rounded-lg border border-input bg-background px-5 py-3.5 text-base font-medium text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
              />
            </div>

            {/* Cap video link — visible right in the review dialog so the
                reviewer can attach/see the video without hunting through the
                drawer. Pre-filled from the lead's stored video_link. */}
            <div>
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Cap video link
              </label>
              <input
                type="text"
                value={videoUrl}
                onChange={(e) => handleVideoUrlChange(e.target.value)}
                placeholder="https://cap.nuraview.com/s/…"
                className="w-full rounded-lg border border-input bg-background px-5 py-3 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Paste the share link (or embed code — we convert it). Embedded at the
                end of the email as a clickable animated preview.
              </p>
            </div>

            {/* Body with CKEditor + Preview Toggle */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Message
                </label>
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview)}
                  className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                    showPreview
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Eye size={14} /> {showPreview ? "Edit" : "Preview"}
                </button>
              </div>

              {showPreview ? (
                <div className="min-h-[250px] overflow-x-auto rounded-lg border border-input bg-white p-4 shadow-sm dark:bg-black/20">
                  <div className="prose prose-sm prose-slate max-w-none dark:prose-invert text-sm break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_img]:h-auto">
                    <div dangerouslySetInnerHTML={{ __html: editableBody }} />
                    {previewVideoId && (
                      <div className="my-4 w-[480px] max-w-full">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={buildCapPreviewUrl(previewVideoId)}
                          alt="Video preview"
                          className="block w-full rounded-lg border border-border"
                        />
                        <p className="mt-2 text-sm font-semibold text-blue-600">
                          ▶ watch video (clickable in the sent email)
                        </p>
                      </div>
                    )}
                    {includeSignature && (
                      <div
                        className="mt-4 border-t border-border pt-4"
                        dangerouslySetInnerHTML={{ __html: EMAIL_SIGNATURE_HTML }}
                      />
                    )}
                  </div>
                </div>
              ) : (
                <div className="min-w-0 overflow-hidden [&_.ck-editor__editable]:break-words [&_.ck-editor__editable_*]:max-w-full">
                  <CkEditor
                    content={editableBody}
                    onChange={handleEditableBodyChange}
                    placeholder="Write your email..."
                  />
                </div>
              )}

              {/* Signature Preview */}
              {includeSignature && !showPreview && (
                <div className="mt-[-1px] rounded-b-lg border border-input border-t-0 bg-muted/30 px-4 py-3">
                  <button
                    type="button"
                    onClick={() => setShowSignaturePreview(!showSignaturePreview)}
                    className="flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {showSignaturePreview ? (
                      <ChevronUp size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                    Signature Preview
                  </button>
                  {showSignaturePreview && (
                    <div className="mt-3 overflow-x-auto pt-3 border-t border-border/50">
                      <div
                        className="pointer-events-none origin-top-left scale-90 opacity-80"
                        dangerouslySetInnerHTML={{ __html: EMAIL_SIGNATURE_HTML }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* AI follow-ups — same format as the main email, editable. Timing +
                threading depend on the setup (see followupLabels/isThreadedReply). */}
            {editableFollowups.map((fu, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-primary/30 bg-primary/5 p-4"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                      Follow-up {idx + 1}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Sent {followupLabels[idx] ?? ""} later ·{" "}
                      {isThreadedReply(idx)
                        ? "reply in the same thread"
                        : "separate email, same subject"}
                    </span>
                  </div>

                  <div className="mb-4">
                    <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Follow-up Subject
                    </label>
                    <div className="w-full rounded-lg border border-input bg-muted/40 px-4 py-2.5 text-sm text-foreground">
                      {isThreadedReply(idx)
                        ? `Re: ${editableSubject || "(initial email subject)"}`
                        : editableSubject || "(initial email subject)"}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {isThreadedReply(idx)
                        ? "Sent as a reply to the first email — same subject with a “Re:” prefix, kept in one thread."
                        : "Sent as a separate email with the same subject as the first email (not threaded)."}
                    </p>
                  </div>

                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Follow-up Message
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setFollowupPreviewOpen((prev) => ({
                            ...prev,
                            [idx]: !prev[idx],
                          }))
                        }
                        className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                          followupPreviewOpen[idx]
                            ? "bg-primary/10 text-primary"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        <Eye size={14} />{" "}
                        {followupPreviewOpen[idx] ? "Edit" : "Preview"}
                      </button>
                    </div>

                    {followupPreviewOpen[idx] ? (
                      <div className="min-h-[200px] overflow-x-auto rounded-lg border border-input bg-white p-4 shadow-sm dark:bg-black/20">
                        <div className="prose prose-sm prose-slate max-w-none dark:prose-invert text-sm break-words [overflow-wrap:anywhere] [&_*]:max-w-full [&_img]:h-auto">
                          <div
                            dangerouslySetInnerHTML={{ __html: fu.body }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="min-w-0 overflow-hidden [&_.ck-editor__editable]:break-words [&_.ck-editor__editable_*]:max-w-full">
                        <CkEditor
                          content={fu.body}
                          onChange={(html) =>
                            setEditableFollowups((prev) =>
                              prev.map((p, i) =>
                                i === idx ? { ...p, body: html } : p,
                              ),
                            )
                          }
                          placeholder="Write the follow-up email..."
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}

            {/* Settings */}
            <div className="rounded-lg border border-border/50 bg-card p-4 shadow-sm">
              <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
                Configuration
              </div>

              <div className="space-y-3">
                <label className="flex cursor-pointer items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-muted/50">
                  <span className="text-sm font-medium">Include signature</span>
                  <input
                    type="checkbox"
                    checked={includeSignature}
                    onChange={(e) => setIncludeSignature(e.target.checked)}
                    className="h-4 w-4 cursor-pointer rounded"
                  />
                </label>

                <div className="rounded-lg border border-border p-3 text-xs text-muted-foreground">
                  {setupMode === "updated"
                    ? "4 follow-ups are auto-scheduled at 10 min / 3h / 9h / 24h. The 10-min one replies in the same thread; the last 3 go out as individual emails with the same subject. Edit them above before sending."
                    : `${editableFollowups.length || 3} AI follow-ups are auto-scheduled at 3h / 6h / 24h, each sent as a separate email (not threaded) with the same subject. Edit them above before sending.`}
                </div>

                {videoUrl.trim() ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-700 dark:text-emerald-300">
                    🎬 Video attached — the Cap recording will be embedded at the
                    end of this email as a clickable animated preview.
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Action Buttons — fixed footer, always visible */}
          <div className="flex gap-2 border-t px-6 py-4">
              <Button
                onClick={() => setShowSendDialog(false)}
                variant="outline"
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSend}
                disabled={sendingEmail || !toEmail?.trim() || !editableSubject?.trim()}
                className="flex-1"
              >
                {sendingEmail ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Send Email
                  </>
                )}
              </Button>
            </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
