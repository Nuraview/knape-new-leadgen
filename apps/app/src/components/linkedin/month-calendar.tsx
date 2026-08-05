import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { dayKeyInZone, monthGridDays, timeInZone, todayKey } from "./dates";
import { type Post, STATUS_LABEL, STATUS_RAIL } from "./types";

/**
 * The month a post actually goes out in, drawn as a calendar.
 *
 * Two things this does that a list cannot: it shows the gaps — three empty
 * weeks is the thing you want to notice — and it lets a post be moved by
 * dragging it to another day.
 *
 * Buckets are keyed by the post's OWN timezone: a 9pm Los Angeles post belongs
 * on the LA day, not on whatever day that instant happens to be wherever the
 * browser is. The drop handler sends the target day back as a plain
 * "YYYY-MM-DD" and lets the server re-anchor the clock time, which is the only
 * way the hour survives a DST boundary.
 *
 * Plain HTML5 drag-and-drop rather than dnd-kit: the payload is a single id and
 * the drop targets are static grid cells, so a sensor stack and a drag overlay
 * would be machinery without a job.
 */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthCalendar({
  month,
  posts,
  onOpen,
  onReschedule,
}: {
  month: string;
  posts: Post[];
  onOpen: (id: string) => void;
  onReschedule: (id: string, dayKey: string) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);

  const days = useMemo(() => monthGridDays(month), [month]);
  const today = todayKey();

  const byDay = useMemo(() => {
    const map = new Map<string, Post[]>();
    for (const p of posts) {
      if (!p.scheduledAt) continue;
      const key = dayKeyInZone(p.scheduledAt, p.timezone);
      const list = map.get(key) ?? [];
      list.push(p);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
    }
    return map;
  }, [posts]);

  const unscheduled = useMemo(
    () => posts.filter((p) => !p.scheduledAt),
    [posts],
  );

  function handleDrop(event: React.DragEvent, dayKey: string) {
    event.preventDefault();
    setOverDay(null);
    const id = event.dataTransfer.getData("text/plain");
    setDragId(null);
    if (!id) return;
    const post = posts.find((p) => p.id === id);
    // Dropping a post where it already sits is a no-op, not a PATCH.
    if (
      post?.scheduledAt &&
      dayKeyInZone(post.scheduledAt, post.timezone) === dayKey
    ) {
      return;
    }
    onReschedule(id, dayKey);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div
        className="grid grid-cols-7 border-border border-b bg-muted/40"
        aria-hidden="true"
      >
        {WEEKDAYS.map((w) => (
          <span
            key={w}
            className="px-3 py-2 font-semibold text-[10.5px] text-muted-foreground uppercase tracking-[0.09em]"
          >
            {w}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-7" role="grid" aria-label="Scheduled posts by day">
        {days.map((d) => {
          const dayPosts = byDay.get(d.key) ?? [];
          return (
            // biome-ignore lint/a11y/useSemanticElements: a grid cell is also a drop target
            <div
              key={d.key}
              role="gridcell"
              className={cn(
                "flex min-h-[116px] flex-col gap-1 border-border border-r border-b p-1.5 transition-colors [&:nth-child(7n)]:border-r-0",
                !d.inMonth && "bg-muted/30",
                d.key === today && "bg-primary/5",
                overDay === d.key && "bg-primary/10 ring-2 ring-primary ring-inset",
              )}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOverDay(d.key);
              }}
              onDragLeave={() =>
                setOverDay((cur) => (cur === d.key ? null : cur))
              }
              onDrop={(e) => handleDrop(e, d.key)}
            >
              <div
                className={cn(
                  "flex items-center gap-1.5 font-mono font-medium text-[11.5px]",
                  d.inMonth ? "text-foreground" : "text-muted-foreground/60",
                )}
              >
                {d.key === today ? (
                  <span className="size-1.5 rounded-full bg-primary" aria-label="Today" />
                ) : null}
                {d.day}
              </div>
              <div className="flex flex-col gap-1">
                {dayPosts.map((p) => (
                  <PostChip
                    key={p.id}
                    post={p}
                    dragging={dragId === p.id}
                    onOpen={onOpen}
                    onDragStart={setDragId}
                    onDragEnd={() => {
                      setDragId(null);
                      setOverDay(null);
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-border border-t bg-muted/30 px-4 py-3.5">
        <h3 className="mb-2 flex items-center gap-2 font-semibold text-[12px] text-muted-foreground uppercase tracking-[0.07em]">
          Not scheduled
          <span className="rounded-full bg-muted px-2 font-mono text-[11px] text-foreground">
            {unscheduled.length}
          </span>
          {unscheduled.length > 0 ? (
            <span className="font-normal text-[11.5px] normal-case tracking-normal">
              drag one onto a day to schedule it for 9:00am
            </span>
          ) : null}
        </h3>
        {unscheduled.length === 0 ? (
          <p className="m-0 text-[12.5px] text-muted-foreground">
            Every post has a slot.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {unscheduled.map((p) => (
              <PostChip
                key={p.id}
                post={p}
                wide
                dragging={dragId === p.id}
                onOpen={onOpen}
                onDragStart={setDragId}
                onDragEnd={() => {
                  setDragId(null);
                  setOverDay(null);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PostChip({
  post,
  dragging,
  wide,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  post: Post;
  dragging: boolean;
  wide?: boolean;
  onOpen: (id: string) => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
}) {
  // A published post is live on LinkedIn; its date is a historical fact now.
  const locked = post.status === "published";
  const label =
    post.title?.trim() || post.body.trim().split("\n")[0] || "Untitled post";

  return (
    <article
      className={cn(
        "flex w-full cursor-grab items-center gap-1.5 overflow-hidden rounded-md border border-border bg-card py-1 pr-1.5 text-left transition-all hover:-translate-y-px hover:border-border hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        dragging && "cursor-grabbing opacity-40",
        locked && "cursor-pointer",
        wide && "w-auto min-w-[190px] max-w-[280px]",
      )}
      draggable={!locked}
      onDragStart={(e) => {
        if (locked) return;
        e.dataTransfer.setData("text/plain", post.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(post.id);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(post.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(post.id);
        }
      }}
      tabIndex={0}
      // biome-ignore lint/a11y/useSemanticElements: needs to be draggable
      role="button"
      title={
        locked
          ? `${STATUS_LABEL[post.status]} — published posts cannot be moved`
          : `${STATUS_LABEL[post.status]} — ${label}`
      }
    >
      <span
        className={cn(
          "min-h-[22px] w-[3px] shrink-0 self-stretch rounded",
          STATUS_RAIL[post.status] ?? "bg-muted-foreground/40",
        )}
        aria-hidden="true"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        {post.scheduledAt ? (
          <span className="font-mono text-[10px] text-muted-foreground">
            {timeInZone(post.scheduledAt, post.timezone)}
          </span>
        ) : null}
        <span className="line-clamp-2 font-medium text-[11.5px] text-foreground leading-tight">
          {label}
        </span>
      </span>
      {(post.media?.length ?? 0) > 0 ? (
        <span className="shrink-0 text-[9px] text-muted-foreground" aria-hidden="true">
          {post.media?.length}◼
        </span>
      ) : null}
      {post.shareToken ? (
        <span className="shrink-0 text-[9px] text-muted-foreground" aria-hidden="true">
          ↗
        </span>
      ) : null}
      <span className="sr-only">{STATUS_LABEL[post.status]}</span>
    </article>
  );
}
