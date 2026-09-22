/**
 * Which column means "done", and which one means "not done any more".
 *
 * A board's done column is the one flagged isFinal — the same flag the subtask
 * badge, the Gantt view and the column header icon already read. Nothing else
 * defines completion here: there is no `completed` column on the task, so
 * finishing a card IS moving it to that column. Dragging was the only way to
 * do that, which is a lot of mouse for a checkbox ("dragging cards is
 * tedious", VK, 2026-09-04).
 *
 * The first final column, not the last: a board that ends "… Done, Cancelled"
 * has two, and cancelled is not what anybody means by the tick.
 */

export type ColumnLike = {
  slug?: string | null;
  id?: string | null;
  isFinal?: boolean | null;
};

function slugOf(column: ColumnLike): string | null {
  return column.slug ?? column.id ?? null;
}

/** The slug a card takes when it is ticked, or null on a board with no final column. */
export function doneSlugOf(columns: ColumnLike[] | undefined | null) {
  return columns?.find((c) => c.isFinal)?.slug ?? null;
}

/**
 * Where an un-ticked card goes back to: the first column that is not final.
 *
 * Its ORIGINAL column would be better and is not recorded anywhere — status is
 * a single value with no history — so the start of the board is the honest
 * answer. Un-ticking is rare and the card is one drag from wherever it belongs.
 */
export function openSlugOf(columns: ColumnLike[] | undefined | null) {
  const column = columns?.find((c) => !c.isFinal);
  return column ? slugOf(column) : null;
}

export function isDoneStatus(
  status: string | null | undefined,
  columns: ColumnLike[] | undefined | null,
) {
  if (!status) return false;
  return Boolean(columns?.some((c) => slugOf(c) === status && c.isFinal));
}
