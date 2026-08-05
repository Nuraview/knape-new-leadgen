/**
 * Height cap around the task description.
 *
 * Imported Trello cards carry the real brief in the description — the Uncorp
 * Wear card is ~9,000 characters of copy deck. Rendered unbounded that pushes
 * attachments, subtasks and the whole comment thread several screens down, so
 * the card reads as one endless block of text and the discussion looks missing.
 *
 * The cap is a max-height with overflow-y-auto, NOT overflow-hidden: the
 * description is an always-live tiptap editor, and hiding overflow would make
 * the tail of a long brief unreachable for editing. Scroll keeps every
 * character reachable; the toggle removes the cap entirely for full-page
 * reading.
 *
 * Short descriptions never see any of this — the toggle only appears once the
 * content actually overflows, measured rather than guessed from length, since
 * a few long paragraphs and many short lines occupy very different heights.
 */
import { ChevronDown, ChevronUp } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

const MAX_HEIGHT_PX = 460;

export function CollapsibleDescription({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => setOverflows(el.scrollHeight > MAX_HEIGHT_PX + 24);
    measure();

    // The editor renders asynchronously and the user keeps typing into it, so
    // a one-shot measurement on mount would be wrong for most tasks.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const capped = overflows && !expanded;

  return (
    <div>
      <div
        ref={ref}
        className={capped ? "overflow-y-auto" : undefined}
        style={capped ? { maxHeight: MAX_HEIGHT_PX } : undefined}
      >
        {children}
      </div>

      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? (
            <>
              <ChevronUp className="size-3.5" />
              {t("tasks:detail.showLess")}
            </>
          ) : (
            <>
              <ChevronDown className="size-3.5" />
              {t("tasks:detail.showMore")}
            </>
          )}
        </button>
      )}
    </div>
  );
}

export default CollapsibleDescription;
