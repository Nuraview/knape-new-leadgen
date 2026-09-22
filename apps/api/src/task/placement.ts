/**
 * Where a card sits on a board: which column a status resolves to.
 *
 * Lifted out of NuraView's task/handoff.ts, which is otherwise about moving a
 * card onto its assignee's PERSONAL board — a rule that belongs to how that
 * team is organised and has no meaning on this instance, where boards are the
 * client's own and nobody has a board named after them.
 *
 * What is shared is the part underneath it, and the import path is the reason
 * it is needed here: a pasted batch names its columns in prose, and a card
 * whose status matches none of them has to land SOMEWHERE VISIBLE. See
 * placeIn, and the warning in validate-task-fields.ts about the 146 cards that
 * were created, reported as successful, and rendered on no board at all.
 */
import { asc, eq } from "drizzle-orm";
import db from "../database";
import { columnTable } from "../database/schema";
import { VIRTUAL_STATUSES } from "./validate-task-fields";

export type BoardColumn = { id: string; slug: string };
export type BoardColumns = {
  bySlug: Map<string, BoardColumn>;
  first: BoardColumn | null;
};

/** A board's columns, in position order. Fetched once per board and reused across a batch. */
export async function boardColumns(projectId: string): Promise<BoardColumns> {
  const columns = await db
    .select({ id: columnTable.id, slug: columnTable.slug })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position));

  return {
    bySlug: new Map(columns.map((c) => [c.slug, c])),
    first: columns[0] ?? null,
  };
}

/**
 * Which column a status lands in on a given board, and what the status becomes.
 *
 * The status slug travels with the task where the board has that column, so a card in Review
 * lands in Review rather than back at the start. Where it does not, BOTH the column and the
 * status change to the board's first column — the board groups cards by status slug, so writing a
 * column id while leaving a status the board does not define files the card into a column that is
 * never rendered. That is a card that has, as far as anyone can see, vanished.
 *
 * "planned" and "archived" are not columns at all — they are the backlog and the archive — so
 * they pass through untouched.
 */
export function placeIn(
  columns: BoardColumns,
  status: string,
): { status: string; columnId: string | null } {
  if ((VIRTUAL_STATUSES as readonly string[]).includes(status)) {
    return { status, columnId: null };
  }
  const column = columns.bySlug.get(status) ?? columns.first;
  return column
    ? { status: column.slug, columnId: column.id }
    : { status, columnId: null };
}
