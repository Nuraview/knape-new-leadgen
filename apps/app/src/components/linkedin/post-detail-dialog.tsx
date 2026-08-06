import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { BodyEditor } from "./body-editor";
import { Creatives } from "./creatives";
import { actorName, toZonedInput, whenInZone, whenLocal } from "./dates";
import {
  api,
  type Post,
  type PostEvent,
  type PostMedia,
  type SchedulerMeta,
  STATUS_LABEL,
  STATUS_TONE,
  TIMEZONES,
  uploadCreative,
} from "./types";

/**
 * One post: read it, fix it, approve it, record where it ended up.
 *
 * The review path is short — open, read, look at the creative, tick or ask for
 * a change — so those controls sit at the top, above the housekeeping.
 */
export function PostDetailDialog({
  postId,
  onClose,
  author,
  meta,
}: {
  postId: string | null;
  onClose: () => void;
  author: string;
  meta?: SchedulerMeta;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [changesOpen, setChangesOpen] = useState(false);
  const [changesText, setChangesText] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [uploading, setUploading] = useState(false);

  const detail = useQuery({
    queryKey: ["linkedin-post", postId],
    queryFn: () =>
      api<{ post: Post; media: PostMedia[]; events: PostEvent[] }>(
        `linkedin/posts/${postId}`,
      ),
    enabled: Boolean(postId),
  });

  const post = detail.data?.post;
  const media = detail.data?.media ?? [];
  const events = detail.data?.events ?? [];
  const published = post?.status === "published";

  useEffect(() => {
    if (!post) return;
    setBody(post.body);
    setTitle(post.title ?? "");
    setLiveUrl(post.linkedinPostUrl ?? "");
    setError("");
  }, [post]);

  function refresh() {
    void qc.invalidateQueries({ queryKey: ["linkedin-post", postId] });
    void qc.invalidateQueries({ queryKey: ["linkedin-posts"] });
    void qc.invalidateQueries({ queryKey: ["linkedin-review-count"] });
  }

  const mutate = useMutation({
    mutationFn: ({ path, init }: { path: string; init: RequestInit }) =>
      api<unknown>(path, init),
    onSuccess: refresh,
    onError: (e: Error) => setError(e.message),
  });

  function patch(fields: Record<string, unknown>) {
    setError("");
    mutate.mutate({
      path: `linkedin/posts/${postId}`,
      init: { method: "PATCH", body: JSON.stringify(fields) },
    });
  }

  function action(path: string, payload?: Record<string, unknown>) {
    setError("");
    mutate.mutate({
      path: `linkedin/posts/${postId}/${path}`,
      init: { method: "POST", body: JSON.stringify(payload ?? {}) },
    });
  }

  async function copy(what: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      setError("Could not reach the clipboard — copy it by hand.");
    }
  }

  async function uploadFiles(files: File[]) {
    if (!postId || files.length === 0) return;
    setUploading(true);
    setError("");
    try {
      for (const file of files) await uploadCreative(postId, file);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open={Boolean(postId)} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{post?.title?.trim() || "Post"}</DialogTitle>
        </DialogHeader>

        <DialogPanel className="space-y-5">
          {!post ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 font-medium text-[11px]",
                    STATUS_TONE[post.status] ?? "bg-muted text-muted-foreground",
                  )}
                >
                  {STATUS_LABEL[post.status] ?? post.status}
                </span>
                {post.approvedBy && post.approvedAt ? (
                  <span className="text-[11.5px] text-muted-foreground">
                    by {actorName(post.approvedBy)} · {whenLocal(post.approvedAt)}
                  </span>
                ) : null}
                <span className="ms-auto text-[11.5px] text-muted-foreground">
                  Created {whenLocal(post.createdAt)}
                </span>
              </div>

              {/* The whole job, on most opens. */}
              <div className="flex flex-wrap items-center gap-2">
                {post.status === "draft" || post.status === "needs_changes" ? (
                  <Button
                    type="button"
                    onClick={() => action("submit")}
                    disabled={mutate.isPending}
                  >
                    Submit for approval
                  </Button>
                ) : null}
                {post.status === "pending_approval" ? (
                  <Button
                    type="button"
                    className="bg-emerald-600 text-white hover:bg-emerald-600/90"
                    onClick={() => action("approve")}
                    disabled={mutate.isPending}
                  >
                    <Check className="size-4" /> Approve
                  </Button>
                ) : null}
                {post.status === "failed" ? (
                  <Button
                    type="button"
                    onClick={() => action("approve")}
                    disabled={mutate.isPending}
                  >
                    Re-approve &amp; retry
                  </Button>
                ) : null}
                {post.status === "pending_approval" ||
                post.status === "approved" ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setChangesOpen((v) => !v)}
                  >
                    Request changes
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void copy("text", body)}
                >
                  {copied === "text" ? "Copied" : "Copy post text"}
                </Button>
              </div>

              {changesOpen ? (
                <div className="flex items-start gap-2">
                  <Textarea
                    rows={2}
                    value={changesText}
                    onChange={(e) => setChangesText(e.target.value)}
                    placeholder="What should change?"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    disabled={!changesText.trim() || mutate.isPending}
                    onClick={() => {
                      action("request-changes", { comment: changesText.trim() });
                      setChangesText("");
                      setChangesOpen(false);
                    }}
                  >
                    Send
                  </Button>
                </div>
              ) : null}

              <label className="flex flex-col gap-1.5">
                <span className="font-medium text-foreground text-xs">
                  Internal title (never published)
                </span>
                <Input
                  value={title}
                  maxLength={255}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => {
                    if (title.trim() !== (post.title ?? "")) {
                      patch({ title: title.trim() || null });
                    }
                  }}
                />
              </label>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="font-medium text-foreground text-xs">
                    Publish at
                  </span>
                  {/* Shown and sent in the post's own zone — see toZonedInput. */}
                  <Input
                    type="datetime-local"
                    value={toZonedInput(post.scheduledAt, post.timezone)}
                    disabled={published}
                    onChange={(e) =>
                      patch({ scheduledLocal: e.target.value || null })
                    }
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="font-medium text-foreground text-xs">
                    Timezone
                  </span>
                  <select
                    className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
                    value={post.timezone}
                    disabled={published}
                    onChange={(e) => patch({ timezone: e.target.value })}
                  >
                    {TIMEZONES.map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {published && post.linkedinPostUrl ? (
                <p className="m-0 text-[13px] text-muted-foreground">
                  Live on LinkedIn since{" "}
                  <strong className="text-foreground">
                    {whenLocal(post.publishedAt)}
                  </strong>{" "}
                  —{" "}
                  <a
                    href={post.linkedinPostUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    view the post
                  </a>
                </p>
              ) : post.scheduledAt ? (
                <p className="m-0 text-[13px] text-muted-foreground">
                  Goes out{" "}
                  <strong className="text-foreground">
                    {whenInZone(post.scheduledAt, post.timezone)}
                  </strong>
                </p>
              ) : (
                <p className="m-0 text-[13px] text-muted-foreground">
                  Not scheduled — it sits in the tray until you give it a day.
                </p>
              )}

              {post.status === "failed" && post.publishError ? (
                <p className="m-0 text-rose-500 text-sm">
                  Auto-publish failed after {post.publishAttempts} attempts:{" "}
                  {post.publishError}
                </p>
              ) : null}

              <BodyEditor
                body={body}
                onChange={setBody}
                readOnly={published}
                media={media.map((m) => ({
                  key: m.id,
                  kind: m.kind,
                  url: m.url,
                  name: m.fileName,
                }))}
                author={author}
                meta={meta}
                when={
                  post.scheduledAt
                    ? whenInZone(post.scheduledAt, post.timezone)
                    : undefined
                }
                onError={setError}
              />
              {!published ? (
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={body === post.body || !body.trim()}
                    onClick={() => patch({ body })}
                  >
                    Save text
                  </Button>
                </div>
              ) : null}

              <Creatives
                items={media}
                onFiles={(files) => void uploadFiles(files)}
                onRemove={(id) =>
                  mutate.mutate({
                    path: `linkedin/media/${id}`,
                    init: { method: "DELETE" },
                  })
                }
                busy={uploading}
                hint={
                  meta && !meta.storageConfigured
                    ? "Object storage is not configured on this deployment, so creatives are stored inline and must be small images."
                    : undefined
                }
              />

              {/*
                Share links are not available against the cockpit's post store.
                Upstream can mint a token that grants read access with NO
                session, which is the one guarantee everything behind the
                lead-gen proxy is supposed to keep — so those paths are refused
                there (the DENIED list in apps/api/src/leadgen/index.ts) and the
                control is removed here rather than left to fail on click.
              */}

              <div className="space-y-2">
                <h3 className="m-0 font-semibold text-[12px] text-muted-foreground uppercase tracking-[0.07em]">
                  Published on LinkedIn
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={liveUrl}
                    onChange={(e) => setLiveUrl(e.target.value)}
                    placeholder="https://www.linkedin.com/feed/update/…"
                    className="min-w-[220px] flex-1"
                  />
                  <Button
                    type="button"
                    disabled={
                      mutate.isPending ||
                      !liveUrl.trim() ||
                      liveUrl.trim() === (post.linkedinPostUrl ?? "")
                    }
                    onClick={() =>
                      action("published", { url: liveUrl.trim() })
                    }
                  >
                    {published ? "Update link" : "Mark as published"}
                  </Button>
                  {published && !post.autoPublished ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-rose-500 hover:bg-rose-500/10"
                      onClick={() =>
                        mutate.mutate({
                          path: `linkedin/posts/${postId}/published`,
                          init: { method: "DELETE" },
                        })
                      }
                    >
                      Undo
                    </Button>
                  ) : null}
                </div>
                <p className="m-0 text-[12px] text-muted-foreground">
                  Post it on LinkedIn yourself at the scheduled time, then paste
                  the link here so this stays an accurate record of what went
                  out.
                </p>
              </div>

              <div className="space-y-2">
                <h3 className="m-0 font-semibold text-[12px] text-muted-foreground uppercase tracking-[0.07em]">
                  Activity
                </h3>
                <ol className="m-0 flex list-none flex-col gap-3 p-0">
                  {events.length === 0 ? (
                    <li className="text-[12.5px] text-muted-foreground">
                      Nothing yet.
                    </li>
                  ) : null}
                  {events.map((ev) => (
                    <li key={ev.id} className="flex gap-3">
                      <span
                        className={cn(
                          "mt-1.5 size-2 shrink-0 rounded-full",
                          ev.kind === "approval"
                            ? "bg-emerald-500"
                            : ev.kind === "change_request"
                              ? "bg-rose-500"
                              : "bg-muted-foreground/50",
                        )}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                          <strong className="text-foreground">
                            {actorName(ev.author)}
                          </strong>
                          {ev.kind === "change_request" ? (
                            <span className="rounded-full bg-rose-500/15 px-2 py-px font-medium text-[10px] text-rose-500 uppercase">
                              requested changes
                            </span>
                          ) : null}
                          {ev.kind === "approval" ? (
                            <span className="rounded-full bg-emerald-500/15 px-2 py-px font-medium text-[10px] text-emerald-500 uppercase">
                              approved
                            </span>
                          ) : null}
                          <span className="ms-auto">
                            {whenLocal(ev.createdAt)}
                          </span>
                        </div>
                        <p className="m-0 whitespace-pre-wrap text-[13px] text-muted-foreground">
                          {ev.body}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="flex items-center gap-2">
                  <Input
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Write a note…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && comment.trim()) {
                        e.preventDefault();
                        action("comment", { body: comment.trim() });
                        setComment("");
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!comment.trim() || mutate.isPending}
                    onClick={() => {
                      action("comment", { body: comment.trim() });
                      setComment("");
                    }}
                  >
                    Add note
                  </Button>
                </div>
              </div>

              {error ? <p className="text-rose-500 text-sm">{error}</p> : null}

              <div className="border-border border-t pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  className="text-rose-500 hover:bg-rose-500/10"
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Delete this post? ("${(post.title || post.body).slice(0, 60)}…")`,
                      )
                    ) {
                      return;
                    }
                    mutate.mutate(
                      {
                        path: `linkedin/posts/${postId}`,
                        init: { method: "DELETE" },
                      },
                      { onSuccess: () => { refresh(); onClose(); } },
                    );
                  }}
                >
                  <Trash2 className="size-4" /> Delete post
                </Button>
              </div>
            </>
          )}
        </DialogPanel>
      </DialogContent>
    </Dialog>
  );
}
