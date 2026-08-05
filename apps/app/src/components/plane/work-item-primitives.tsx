/**
 * Plane-style work-item primitives.
 *
 * These reimplement the information architecture Plane uses for its work-item
 * views — dense grouped rows, right-aligned property pills, a layout switcher
 * and a Display popover — as our own components.
 *
 * IMPORTANT: no Plane source, asset or stylesheet is used here. Plane is
 * AGPL-3.0, and copying its code would oblige us to publish the whole CRM's
 * source to anyone who opens a shared link. Layout conventions and interaction
 * patterns are not protected that way, so the behaviour is modelled and the
 * implementation is ours. See THIRD_PARTY_NOTICES.md.
 *
 * What is deliberately Plane-like:
 *   - ~36px rows, 13px text, neutral palette, hairline separators
 *   - collapsible group headers carrying a count
 *   - properties as compact bordered pills, right-aligned and truncating first
 *   - state glyphs as concentric circles rather than coloured dots
 */
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleDot,
  LayoutGrid,
  List as ListIcon,
  Settings2,
  Table2,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/cn";

/* ------------------------------------------------------------------ state */

export type WorkItemState =
  | "backlog"
  | "todo"
  | "started"
  | "done"
  | "cancelled";

const STATE_META: Record<
  WorkItemState,
  { icon: typeof Circle; className: string; label: string }
> = {
  backlog: { icon: CircleDashed, className: "text-muted-foreground", label: "Backlog" },
  todo: { icon: Circle, className: "text-muted-foreground", label: "Todo" },
  started: { icon: CircleDot, className: "text-amber-500", label: "In progress" },
  done: { icon: CheckCircle2, className: "text-emerald-500", label: "Done" },
  cancelled: { icon: XCircle, className: "text-muted-foreground/60", label: "Cancelled" },
};

export function StateIcon({
  state,
  className,
}: {
  state: WorkItemState;
  className?: string;
}) {
  const meta = STATE_META[state];
  const Icon = meta.icon;
  return <Icon className={cn("size-4 shrink-0", meta.className, className)} />;
}

export function stateLabel(state: WorkItemState) {
  return STATE_META[state].label;
}

/* ------------------------------------------------------------------ pills */

/**
 * Compact bordered property chip. Plane right-aligns a row of these and lets
 * them drop off before the title ever truncates, which is what keeps long
 * lists scannable.
 */
export function PropertyPill({
  icon,
  children,
  title,
  className,
}: {
  icon?: ReactNode;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded border border-border",
        "bg-background px-2 text-xs leading-none text-muted-foreground",
        className,
      )}
    >
      {icon}
      <span className="max-w-[10rem] truncate">{children}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ header */

export type WorkItemLayout = "list" | "board" | "table";

const LAYOUTS: { key: WorkItemLayout; icon: typeof ListIcon; label: string }[] = [
  { key: "list", icon: ListIcon, label: "List" },
  { key: "board", icon: LayoutGrid, label: "Board" },
  { key: "table", icon: Table2, label: "Table" },
];

export function LayoutSwitcher({
  value,
  onChange,
}: {
  value: WorkItemLayout;
  onChange: (next: WorkItemLayout) => void;
}) {
  return (
    <div className="flex items-center gap-0.5 rounded border border-border p-0.5">
      {LAYOUTS.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={cn(
            "grid size-6 place-items-center rounded transition-colors",
            value === key
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/50",
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}

export type DisplayOption = { key: string; label: string };

/**
 * Plane's "Display" popover: choose what the rows are grouped by and which
 * properties are shown. Kept intentionally small — group-by plus property
 * toggles covers most of the value.
 */
export function DisplayOptions({
  groupBy,
  groupOptions,
  onGroupByChange,
  properties,
  visibleProperties,
  onToggleProperty,
}: {
  groupBy: string;
  groupOptions: DisplayOption[];
  onGroupByChange: (key: string) => void;
  properties: DisplayOption[];
  visibleProperties: string[];
  onToggleProperty: (key: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={<Button variant="outline" size="sm" className="h-7 gap-1 text-xs" />}
      >
        <Settings2 className="size-4" />
        Display
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3">
        <div className="mb-3">
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Group by
          </div>
          <div className="flex flex-wrap gap-1">
            {groupOptions.map((o) => (
              <button
                key={o.key}
                type="button"
                onClick={() => onGroupByChange(o.key)}
                className={cn(
                  "rounded border px-2 py-0.5 text-xs transition-colors",
                  groupBy === o.key
                    ? "border-transparent bg-accent text-accent-foreground"
                    : "border-border text-muted-foreground hover:bg-accent/50",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Properties
          </div>
          <div className="flex flex-wrap gap-1">
            {properties.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onToggleProperty(p.key)}
                className={cn(
                  "rounded border px-2 py-0.5 text-xs transition-colors",
                  visibleProperties.includes(p.key)
                    ? "border-transparent bg-accent text-accent-foreground"
                    : "border-border text-muted-foreground hover:bg-accent/50",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ------------------------------------------------------------------ groups */

export function GroupHeader({
  icon,
  title,
  count,
  collapsed,
  onToggle,
}: {
  icon?: ReactNode;
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="sticky top-0 z-10 flex w-full items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5 text-left backdrop-blur"
    >
      {collapsed ? (
        <ChevronRight className="size-4 text-muted-foreground" />
      ) : (
        <ChevronDown className="size-4 text-muted-foreground" />
      )}
      {icon}
      <span className="text-xs font-medium">{title}</span>
      <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground">
        {count}
      </span>
    </button>
  );
}

/**
 * Dense single-line row. Title takes the space; properties sit right and are
 * allowed to be clipped before the title is.
 */
export function WorkItemRow({
  leading,
  title,
  subtitle,
  properties,
  selected,
  onClick,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  properties?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left transition-colors",
        "hover:bg-accent/40",
        selected && "bg-accent/60",
      )}
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm leading-tight">{title}</span>
        {subtitle ? (
          <span className="mt-0.5 block truncate text-xs leading-tight text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </span>
      {properties ? (
        <span className="flex shrink items-center gap-1 overflow-hidden">
          {properties}
        </span>
      ) : null}
    </button>
  );
}
