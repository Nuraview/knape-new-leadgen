import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BodyEditor } from "./body-editor";
import { Creatives } from "./creatives";
import type { PreviewMedia } from "./linkedin-preview";
import {
  api,
  type Post,
  type SchedulerMeta,
  TIMEZONES,
  uploadCreative,
} from "./types";

/**
 * Writing a new post.
 *
 * Creatives are picked before the post exists, so they are held in memory and
 * uploaded the moment the draft gets an id. That ordering matters on the error
 * path: once the draft is created, a failed upload must not read as "nothing
 * was saved", so the post is opened and the failure reported there instead.
 */
export function PostComposer({
  open,
  onClose,
  onCreated,
  author,
  meta,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  author: string;
  meta?: SchedulerMeta;
}) {
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState("");
  const [tz, setTz] = useState("America/New_York");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setBody("");
      setTitle("");
      setWhen("");
      setFiles([]);
      setBusy("");
      setError("");
    }
  }, [open]);

  // Object URLs leak until revoked, so rebuild them only when the staged file
  // list actually changes.
  const staged: PreviewMedia[] = useMemo(
    () =>
      files.map((f, i) => ({
        key: `${i}-${f.name}-${f.size}`,
        kind: f.type.startsWith("video/") ? "video" : "image",
        url: URL.createObjectURL(f),
        name: f.name,
      })),
    [files],
  );
  useEffect(
    () => () => {
      for (const s of staged) URL.revokeObjectURL(s.url);
    },
    [staged],
  );

  async function submit() {
    if (!body.trim()) {
      setError("Post text is required");
      return;
    }
    setBusy("create");
    setError("");
    try {
      const created = await api<{ post: Post }>("linkedin/posts", {
        method: "POST",
        // The wall clock travels as text and is resolved against `tz` on the
        // server. Converting here would resolve it in the BROWSER's zone, which
        // is not the zone the picker names.
        body: JSON.stringify({
          body: body.trim(),
          title: title.trim() || null,
          scheduledLocal: when || null,
          timezone: tz,
        }),
      });
      for (const file of files) {
        setBusy("upload");
        await uploadCreative(created.post.id, file);
      }
      onCreated(created.post.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New LinkedIn post</DialogTitle>
        </DialogHeader>

        <DialogPanel className="space-y-5">
          <label className="flex flex-col gap-1.5">
            <span className="font-medium text-foreground text-xs">
              Internal title (never published)
            </span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Week 3 — grant deadline hook"
              maxLength={255}
            />
          </label>

          <BodyEditor
            body={body}
            onChange={setBody}
            media={staged}
            author={author}
            meta={meta}
            when={when ? `${when.replace("T", " ")} ${tz}` : undefined}
            onError={setError}
          />

          <Creatives
            items={staged.map((s) => ({
              id: s.key,
              kind: s.kind,
              url: s.url,
              fileName: s.name,
            }))}
            onFiles={(picked) => setFiles((prev) => [...prev, ...picked])}
            onRemove={(key) =>
              setFiles((prev) =>
                prev.filter((_, i) => staged[i] && staged[i].key !== key),
              )
            }
            hint={
              meta && !meta.storageConfigured
                ? "Object storage is not configured on this deployment, so creatives are stored inline and must be small images."
                : undefined
            }
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="font-medium text-foreground text-xs">
                Publish at
              </span>
              <Input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="font-medium text-foreground text-xs">
                Timezone
              </span>
              <select
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                value={tz}
                onChange={(e) => setTz(e.target.value)}
              >
                {TIMEZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="m-0 text-muted-foreground text-xs">
            Leave the time blank to park it in the unscheduled tray and drag it
            onto a day later.
          </p>

          {error ? <p className="text-rose-500 text-sm">{error}</p> : null}
        </DialogPanel>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={!!busy}>
            {busy === "upload"
              ? "Uploading creatives…"
              : busy
                ? "Creating…"
                : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
