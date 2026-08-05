import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { LinkedInPreview, type PreviewMedia } from "./linkedin-preview";
import { api, FOLD_HINT, MAX_BODY, type SchedulerMeta } from "./types";

/**
 * Write / Preview, the AI draft control, and the two numbers that matter while
 * writing. Shared by the composer and the detail dialog so they cannot drift.
 */

/**
 * The 3000 cap is the one LinkedIn enforces and is almost never the binding
 * constraint. The one that decides whether the post gets read is the opening
 * paragraph, because the feed folds everything after roughly three lines behind
 * "…see more". So the hook length is shown next to the total and turns amber
 * when it runs past the fold. The exact cut is measured for real in Preview —
 * this is the nudge that stops it happening in the first place.
 */
export function BodyMeter({ body }: { body: string }) {
  const hook = body.split(/\n\s*\n/)[0]?.trim() ?? "";
  const long = hook.length > FOLD_HINT;
  return (
    <span className="flex items-center gap-2.5 font-mono text-[10.5px]">
      <span className={long ? "font-semibold text-amber-500" : "text-muted-foreground"}>
        hook {hook.length}
        {long ? " · past the fold" : ""}
      </span>
      <span
        className={
          body.length > MAX_BODY - 100
            ? "font-semibold text-amber-500"
            : "text-muted-foreground"
        }
      >
        {body.length}/{MAX_BODY}
      </span>
    </span>
  );
}

export function BodyEditor({
  body,
  onChange,
  media,
  author,
  when,
  meta,
  readOnly,
  onError,
}: {
  body: string;
  onChange: (next: string) => void;
  media: PreviewMedia[];
  author: string;
  when?: string;
  meta?: SchedulerMeta;
  readOnly?: boolean;
  onError: (message: string) => void;
}) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [aiOpen, setAiOpen] = useState(false);
  const [topic, setTopic] = useState("");
  const [angle, setAngle] = useState("");
  const [drafting, setDrafting] = useState(false);

  async function generate() {
    if (!topic.trim()) {
      onError("Say what the post should be about");
      return;
    }
    setDrafting(true);
    try {
      const result = await api<{ post: string }>("linkedin/draft", {
        method: "POST",
        body: JSON.stringify({ topic: topic.trim(), angle: angle || null }),
      });
      // Lands in the textarea as ordinary editable text. It is a starting
      // point, not a submission — generating saves nothing.
      onChange(result.post);
      setTab("write");
      setAiOpen(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setDrafting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="m-0 font-semibold text-[12px] text-muted-foreground uppercase tracking-[0.07em]">
          Post text
        </h3>
        <BodyMeter body={body} />
        {!readOnly ? (
          <Button
            type="button"
            variant={aiOpen ? "default" : "outline"}
            size="sm"
            className="h-7 gap-1.5 text-[12px]"
            onClick={() => setAiOpen((v) => !v)}
          >
            <Sparkles className="size-3.5" />
            Draft with AI
          </Button>
        ) : null}
        <div className="ms-auto inline-flex gap-0.5 rounded-md bg-muted p-0.5">
          {(["write", "preview"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={cn(
                "rounded px-3.5 py-1 text-[12px] transition-colors",
                tab === t
                  ? "bg-card font-semibold text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => setTab(t)}
            >
              {t === "write" ? "Write" : "Preview"}
            </button>
          ))}
        </div>
      </div>

      {aiOpen ? (
        <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-muted/40 p-3.5">
          <label className="flex flex-col gap-1.5">
            <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
              What is this post about?
            </span>
            <Textarea
              rows={2}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. ADs think they cannot afford a character program, but prevention grants already cover it"
            />
          </label>
          <div className="flex flex-wrap items-end gap-2.5">
            <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
              <span className="font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
                Messaging angle (optional)
              </span>
              {/* A plain select: one field, no search, no multi-select. */}
              <select
                className="h-9 rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
                value={angle}
                onChange={(e) => setAngle(e.target.value)}
              >
                <option value="">No particular angle</option>
                {(meta?.angles ?? []).map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="button" onClick={() => void generate()} disabled={drafting}>
              {drafting ? "Writing…" : "Generate"}
            </Button>
          </div>
          <p className="m-0 text-[11.5px] text-muted-foreground leading-relaxed">
            Replaces whatever is in the box with a first draft, in the same voice
            as the outreach emails. Read it before it goes anywhere.
            {meta && !meta.aiConfigured
              ? " (OPENAI_API_KEY is not set on this deployment yet.)"
              : ""}
          </p>
        </div>
      ) : null}

      {tab === "write" ? (
        <Textarea
          rows={10}
          maxLength={MAX_BODY}
          value={body}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          placeholder="The post exactly as it will read on LinkedIn…"
          className="min-h-[200px] text-[14px] leading-relaxed"
        />
      ) : (
        // Previews the unsaved text on purpose: you check what you are about to
        // save, not what is already stored.
        <LinkedInPreview body={body} media={media} author={author} when={when} />
      )}
    </div>
  );
}

export { type PreviewMedia };
