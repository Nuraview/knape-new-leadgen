import { asc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { columnTable } from "../database/schema";

export const VALID_PRIORITIES = [
  "no-priority",
  "low",
  "medium",
  "high",
  "urgent",
] as const;

export const VIRTUAL_STATUSES = ["planned", "archived"] as const;

export function assertValidPriority(priority: string): void {
  if (!(VALID_PRIORITIES as readonly string[]).includes(priority)) {
    throw new HTTPException(400, {
      message: `Invalid priority "${priority}". Valid values: ${VALID_PRIORITIES.join(", ")}`,
    });
  }
}

export async function getValidTaskStatuses(
  projectId: string,
): Promise<string[]> {
  const columns = await db
    .select({ slug: columnTable.slug })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position));

  return [...columns.map((c) => c.slug), ...VIRTUAL_STATUSES];
}

export async function assertValidTaskStatus(
  status: string,
  projectId: string,
): Promise<void> {
  const validStatuses = await getValidTaskStatuses(projectId);

  if (!validStatuses.includes(status)) {
    throw new HTTPException(400, {
      message: `Invalid status "${status}". Valid statuses for this project: ${validStatuses.join(", ")}`,
    });
  }
}

/**
 * Everything that is not a letter or a digit, removed.
 *
 * A board's column slug is derived from its name, so "To Do" is stored as
 * "to-do" — and a person pasting a batch writes "todo", "To Do", "TO_DO" or
 * "to do" and means the same column every time. Comparing on letters and
 * digits alone makes all of those equal without an alias table to maintain,
 * and it matches the column's NAME as well as its slug for free.
 */
const statusKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

export function coerceStatus(
  status: string,
  validStatuses: string[],
): { status: string; warning?: string } {
  if (validStatuses.includes(status)) {
    return { status };
  }

  const key = statusKey(status ?? "");
  const match = validStatuses.find((valid) => statusKey(valid) === key);
  if (match) {
    return { status: match };
  }

  /*
   * Return the status UNCHANGED, so the caller's placement rule can put the
   * card in the board's first column.
   *
   * This used to answer "planned". That reads like a sensible default and is
   * the single worst answer available: "planned" is the backlog, it is not a
   * column, so the card was written with no column at all and appeared on no
   * board. Two imports — 146 cards across two boards — were created, reported
   * as successful, and were invisible to the people they were assigned to.
   * An unknown status should land somewhere visible and say so, never in a
   * place nobody is looking.
   */
  return {
    status,
    warning:
      `Unknown status "${status}" — put in the first column. ` +
      `This board accepts: ${validStatuses.join(", ")}`,
  };
}

export function coercePriority(priority: string): {
  priority: string;
  warning?: string;
} {
  if ((VALID_PRIORITIES as readonly string[]).includes(priority)) {
    return { priority };
  }
  return {
    priority: "no-priority",
    warning: `Unknown priority "${priority}" mapped to "no-priority"`,
  };
}
