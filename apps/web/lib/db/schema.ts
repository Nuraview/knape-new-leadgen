// Introspected from Neon via `pnpm db:pull` (drizzle-kit).
// Re-exports live in `drizzle/schema.ts` + `drizzle/relations.ts`.
// App code should import from `@/lib/db` — do not import from `drizzle/` directly.
export * from "../../drizzle/schema";
export * from "../../drizzle/relations";
// NuraView Marketer tables (migrated from the standalone nv-marketter app).
// All symbols are `mkt`-prefixed so they don't collide with the above.
export * from "../../drizzle/marketing-schema";
// NuraView Dialer tables (migrated from the standalone alifsense/dialer app).
// All symbols are `dialer`-prefixed so they don't collide with the above.
export * from "../../drizzle/dialer-schema";
