// Cross-check the introspected Drizzle schema against the actual Postgres
// columns. Prints every `<js>: <drizzleType>()` (no explicit DB alias) where
// the real DB column has a DIFFERENT name, so we can fix them in schema.ts.

import fs from "node:fs";
import path from "node:path";

const dbCols = JSON.parse(fs.readFileSync("/tmp/cols.json", "utf8"));
const schemaText = fs.readFileSync(
  path.resolve(process.cwd(), "drizzle/schema.ts"),
  "utf8",
);

const tableStart = /^export const \w+ = pgTable\("([^"]+)",\s*\{/gm;

const results = [];
let m;
while ((m = tableStart.exec(schemaText)) != null) {
  const tableName = m[1];
  const start = tableStart.lastIndex;
  // Find the matching closing paren for the columns object — look for next }, (table) => [
  const rest = schemaText.slice(start);
  const end = rest.indexOf("}, (table)");
  const slice = end === -1 ? rest.slice(0, rest.indexOf("});")) : rest.slice(0, end);

  const colsInDb = new Set(dbCols[tableName] ?? []);
  if (!colsInDb.size) continue;

  // Match `<jsName>: <type>(<args>),`. If args starts with a quoted string, that
  // IS the DB column alias — skip. Otherwise assume jsName == DB col name.
  const lineRe = /^\s*(\w+):\s*\w+\s*\(([^)]*)\)/gm;
  let lm;
  while ((lm = lineRe.exec(slice)) != null) {
    const js = lm[1];
    const args = lm[2];
    const explicitAlias = args.match(/^\s*["']([^"']+)["']/);
    const dbName = explicitAlias ? explicitAlias[1] : js;
    if (!colsInDb.has(dbName)) {
      // Try to find the "correct" column: case-insensitive or punctuation
      // equivalent.
      const lower = dbName.toLowerCase();
      const candidates = [...colsInDb].filter(
        (c) => c.toLowerCase() === lower,
      );
      if (candidates.length === 1) {
        results.push({
          table: tableName,
          js,
          wrongAs: dbName,
          actual: candidates[0],
          explicitAlias: !!explicitAlias,
        });
      } else if (candidates.length === 0) {
        // neither by-name nor case-insensitive match — unusual, report anyway
        if (!["AND", "OR", "NOT"].includes(js)) {
          results.push({ table: tableName, js, wrongAs: dbName, actual: null });
        }
      }
    }
  }
}

console.log(JSON.stringify(results, null, 2));
