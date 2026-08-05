/**
 * Normalise the result of `db.execute(sql\`...\`)` into a plain array.
 *
 * WHY THIS EXISTS: the node-postgres driver returns a pg `QueryResult` — an
 * OBJECT with a `.rows` property — while other Drizzle drivers return the array
 * directly. Six call sites in this codebase had cast the result straight to
 * `Array<...>`, which type-checks perfectly and then throws
 * "object is not iterable" the moment anything destructures it.
 *
 * It stayed hidden because most of those paths are rare (an exclusion lookup
 * that only runs for non-stale rows, a settings read with a fallback). The one
 * that was NOT rare took down the client-facing proposal page.
 *
 * A cast is a promise to the compiler. This is the function that keeps it.
 */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

export default rowsOf;
