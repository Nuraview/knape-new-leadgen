import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { dayHeading, dayKeyInZone, todayKey, whenInZone } from "./dates";
import {
  type Post,
  STATUS_LABEL,
  STATUS_RAIL,
  STATUS_TONE,
} from "./types";

/**
 * The same month as a reading list.
 *
 * The calendar answers "where are the gaps"; this answers "what are we actually
 * saying this month", which is the view you want when reviewing a batch rather
 * than arranging one. Full post text, grouped by the day it goes out.
 */
export function AgendaList({
  posts,
  onOpen,
}: {
  posts: Post[];
  onOpen: (id: string) => void;
}) {
  const today = todayKey();

  const groups = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const p of posts) {
      const key = p.scheduledAt ? dayKeyInZone(p.scheduledAt, p.timezone) : "";
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    // Unscheduled has no date to sort by, so it goes last rather than first,
    // which is where the empty string would otherwise put it.
    return [...map.entries()].sort(([a], [b]) =>
      a === "" ? 1 : b === "" ? -1 : a.localeCompare(b),
    );
  }, [posts]);

  return (
    <div className="flex flex-col gap-6">
      {groups.map(([key, dayPosts]) => (
        <section key={key || "unscheduled"}>
          <h3
            className={cn(
              "mb-2 flex items-center gap-2.5 font-semibold text-[12.5px] uppercase tracking-[0.07em]",
              key === today ? "text-primary" : "text-muted-foreground",
            )}
          >
            {key ? dayHeading(key) : "Not scheduled yet"}
            {key === today ? (
              <span className="rounded-full bg-primary px-2 py-px font-medium text-[10px] text-primary-foreground normal-case tracking-normal">
                Today
              </span>
            ) : null}
          </h3>

          <div className="flex flex-col gap-2.5">
            {dayPosts.map((p) => (
              <article
                key={p.id}
                className="cursor-pointer rounded-lg border border-border border-l-[3px] bg-card p-3.5 transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                style={{ borderLeftColor: "transparent" }}
                onClick={() => onOpen(p.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(p.id);
                  }
                }}
                tabIndex={0}
                // biome-ignore lint/a11y/useSemanticElements: card opens a dialog
                role="button"
              >
                <div className="mb-2 flex items-center gap-3">
                  <span
                    className={cn(
                      "h-4 w-[3px] shrink-0 rounded",
                      STATUS_RAIL[p.status] ?? "bg-muted-foreground/40",
                    )}
                    aria-hidden="true"
                  />
                  <span className="font-mono text-[11.5px] text-muted-foreground">
                    {p.scheduledAt
                      ? whenInZone(p.scheduledAt, p.timezone)
                      : "No time set"}
                  </span>
                  <span
                    className={cn(
                      "ms-auto rounded-full px-2.5 py-0.5 font-medium text-[11px]",
                      STATUS_TONE[p.status] ?? "bg-muted text-muted-foreground",
                    )}
                  >
                    {STATUS_LABEL[p.status] ?? p.status}
                  </span>
                </div>

                {p.title ? (
                  <div className="mb-1 font-semibold text-[14px] text-foreground">
                    {p.title}
                  </div>
                ) : null}
                <p className="m-0 line-clamp-4 whitespace-pre-wrap text-[13.5px] text-muted-foreground leading-relaxed">
                  {p.body}
                </p>

                <div className="mt-2.5 flex flex-wrap gap-2">
                  {(p.media?.length ?? 0) > 0 ? (
                    <span className="rounded-full bg-muted px-2.5 py-0.5 font-medium text-[11px] text-muted-foreground">
                      {p.media?.length} creative
                      {p.media?.length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  {p.shareToken ? (
                    <span className="rounded-full bg-primary/10 px-2.5 py-0.5 font-medium text-[11px] text-primary">
                      shared
                    </span>
                  ) : null}
                  {p.status === "published" && p.linkedinPostUrl ? (
                    <a
                      className="rounded-full bg-primary px-2.5 py-0.5 font-medium text-[11px] text-primary-foreground no-underline"
                      href={p.linkedinPostUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      view on LinkedIn
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
