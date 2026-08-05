import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * The post as LinkedIn will render it.
 *
 * Two things the feed does to a post are the whole reason this exists:
 *
 * 1. **The caption fold.** LinkedIn cuts the text after three lines and puts
 *    the rest behind "see more", so a post whose hook lands below the fold is a
 *    different post. The cut is a CSS line clamp at feed width, not a character
 *    count — where three lines end depends on where the words wrap, so it is
 *    measured here rather than guessed.
 * 2. **The image crop.** The feed only shows a window on the creative: portrait
 *    taller than 4:5 and landscape wider than 1.91:1 get cropped to those
 *    limits. A preview that quietly showed the whole image would hide exactly
 *    the problem it exists to catch, so the crop is reproduced and labelled,
 *    with one click to inspect the full creative underneath.
 *
 * Deliberately NOT styled like the rest of the CRM: its job is to look like
 * LinkedIn.
 */

/** LinkedIn's feed window, as width ÷ height. Outside it, the feed crops. */
const MIN_RATIO = 0.8; // 4:5, the tallest portrait shown in full
const MAX_RATIO = 1.91; // 1.91:1, the widest landscape shown in full

export type PreviewMedia = {
  key: string;
  kind: string;
  url: string;
  name: string;
};

type Fit = "ok" | "tall" | "wide";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function LinkedInPreview({
  body,
  media,
  author,
  when,
}: {
  body: string;
  media: PreviewMedia[];
  author: string;
  when?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const [fit, setFit] = useState<Record<string, Fit>>({});
  const [showFull, setShowFull] = useState<Record<string, boolean>>({});
  const bodyRef = useRef<HTMLParagraphElement | null>(null);
  const text = body.trim();
  // Multi-image posts tile at a fixed height in the real feed, so the crop
  // question only arises for a lone creative.
  const single = media.length === 1;

  function measure(key: string, el: HTMLImageElement) {
    if (!el.naturalWidth || !el.naturalHeight) return;
    const ratio = el.naturalWidth / el.naturalHeight;
    const next: Fit =
      ratio < MIN_RATIO ? "tall" : ratio > MAX_RATIO ? "wide" : "ok";
    setFit((prev) => (prev[key] === next ? prev : { ...prev, [key]: next }));
  }

  // Does the clamped caption actually lose anything? Measured, not guessed —
  // it is the same question the reader's feed will answer.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || expanded) return;
    setClipped(el.scrollHeight - el.clientHeight > 2);
  }, [expanded]);

  return (
    <div
      className="mx-auto w-full max-w-[555px] overflow-hidden rounded-lg border border-border bg-card"
      aria-label="LinkedIn preview"
    >
      <header className="flex items-center gap-2.5 px-3.5 pt-3 pb-1.5">
        <span
          className="grid size-11 shrink-0 place-items-center rounded-full bg-primary font-semibold text-primary-foreground text-sm"
          aria-hidden="true"
        >
          {initials(author)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="truncate font-semibold text-[14px] text-foreground">
            {author}
          </span>
          <span className="text-[12px] text-muted-foreground">
            {when || "Now"} · 🌐
          </span>
        </span>
        <span className="shrink-0 font-semibold text-[#0a66c2] text-[13px]">
          ＋ Follow
        </span>
      </header>

      {text ? (
        <>
          <p
            ref={bodyRef}
            className={cn(
              "m-0 whitespace-pre-wrap break-words px-3.5 text-[14px] text-foreground leading-[1.45]",
              expanded ? "pb-3" : "line-clamp-3 pb-0",
            )}
          >
            {text}
          </p>
          {clipped ? (
            <button
              type="button"
              className="block cursor-pointer bg-transparent px-3.5 pt-0.5 pb-3 text-[14px] text-muted-foreground hover:text-[#0a66c2] hover:underline"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "see less" : "…see more"}
            </button>
          ) : null}
        </>
      ) : (
        <p className="m-0 px-3.5 pb-3 text-[14px] text-muted-foreground italic">
          Your post text will appear here.
        </p>
      )}

      {media.length > 0 ? (
        <div
          className={cn(
            "relative grid gap-0.5 bg-border",
            media.length >= 2 && "grid-cols-2",
          )}
        >
          {media.slice(0, 4).map((m) => {
            const thisFit = fit[m.key];
            const cut =
              single &&
              m.kind !== "video" &&
              (thisFit === "tall" || thisFit === "wide");
            const full = Boolean(showFull[m.key]);
            return (
              <div key={m.key} className="relative bg-muted">
                {m.kind === "video" ? (
                  <video
                    src={m.url}
                    controls
                    preload="metadata"
                    className="block max-h-[640px] w-full bg-black object-contain"
                  >
                    <track kind="captions" />
                  </video>
                ) : (
                  <img
                    src={m.url}
                    alt={m.name}
                    loading="lazy"
                    onLoad={(e) => measure(m.key, e.currentTarget)}
                    className={cn(
                      "block h-auto w-full",
                      media.length >= 2 && "h-[210px] object-cover",
                      cut && !full && thisFit === "tall" && "aspect-[4/5] object-cover object-center",
                      cut && !full && thisFit === "wide" && "aspect-[1.91/1] object-cover object-center",
                    )}
                  />
                )}
                {cut ? (
                  <button
                    type="button"
                    className="absolute bottom-2.5 left-2.5 max-w-[calc(100%-20px)] cursor-pointer rounded-full bg-black/75 px-3 py-1 font-medium text-[11.5px] text-white backdrop-blur-sm hover:bg-black/90"
                    onClick={() =>
                      setShowFull((prev) => ({ ...prev, [m.key]: !prev[m.key] }))
                    }
                  >
                    {full
                      ? "Back to the feed crop"
                      : `LinkedIn crops this ${thisFit === "tall" ? "to 4:5" : "to 1.91:1"} — see the whole image`}
                  </button>
                ) : null}
              </div>
            );
          })}
          {media.length > 4 ? (
            <span className="absolute right-2 bottom-2 rounded-full bg-black/70 px-2 py-0.5 font-semibold text-[13px] text-white">
              +{media.length - 4}
            </span>
          ) : null}
        </div>
      ) : null}

      <footer
        className="flex justify-around gap-1 border-border border-t px-2 py-1.5 font-medium text-[12.5px] text-muted-foreground"
        aria-hidden="true"
      >
        <span>👍 Like</span>
        <span>💬 Comment</span>
        <span>🔁 Repost</span>
        <span>➤ Send</span>
      </footer>
    </div>
  );
}
