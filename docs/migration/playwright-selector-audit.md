# Playwright selector audit (P0.6)

Measured 2026-07-27 against `apps/web/tests/e2e/` — 24 spec files.

Why this matters: the Playwright suite is the migration's primary oracle. The same
spec should run against both the legacy Next app and the new SPA (`NV_TARGET=legacy|spa`),
and a module is "done" when its spec is green against both. That only works if the
selectors survive a UI rewrite. Role-, label- and testid-based queries do. Selectors
anchored to CSS utility classes do not — and P2 (design-system consolidation) will
change precisely those wrappers.

Fixing them **after** the port starts means debugging the port and the tests at the
same time. Fix them while the Next app is still the only reference.

## Current state

| Selector style | Count | Verdict |
|---|---:|---|
| `getByRole(` | 129 | robust |
| `getByLabel(` | 94 | robust |
| `getByText(` | 57 | robust |
| `getByTestId(` | 36 | robust |
| `getByPlaceholder(` | 5 | robust |
| `locator(".<class>")` | 28 | **mostly fragile — see below** |
| `locator("#<id>")` | 3 | fine, IDs are stable |

259 robust vs 31 questionable. Better shape than expected; the work is contained.

## Must fix — Tailwind utility class as a structural anchor

`.space-y-2` is a *spacing utility*, used to locate form field containers:

```ts
dialog.locator(".space-y-2").filter({ hasText: "Unit Price" }).locator("input")
```

Roughly 20 occurrences across:
- `tests/e2e/product-create.spec.ts` (~13)
- `tests/e2e/product-update.spec.ts` (3)
- `tests/e2e/product-delete.spec.ts` (3)

Replace with `dialog.getByLabel("Unit Price")`.

**Verify before bulk-replacing**: this only works where the shadcn `FormLabel` carries a
matching `htmlFor`, and where the label text is unique inside the dialog ("Name" may
collide). Where it isn't, add an explicit `data-testid` to the field in the component
rather than reaching for another class. Each change needs the spec actually executed —
which needs the seeded test DB from P0.1b. **Do not bulk-rewrite these blind.**

## Also fix — parent traversal

```ts
page.locator("label").filter({ hasText: labelText }).locator("..").locator("button")
```
- `tests/e2e/sales-flow.spec.ts:39`
- `tests/e2e/account-tasks.spec.ts:46`

`locator("..")` depends on exact DOM nesting. Two occurrences; replace with a testid on
the combobox trigger.

## Leave alone

- `.tiptap, .ProseMirror, [contenteditable='true']` — 4 occurrences in
  `campaign-create`, `campaign-detail`, `campaign-list`. `.ProseMirror` and
  `contenteditable` are semantic and stable, and TipTap is the editor we are keeping
  (CKEditor is the one being dropped). No change needed.
- `#is_recurring`, `#unit` — element IDs, stable across a restyle.

## Order of work

1. P0.1b first — Playwright cannot run in CI without a seeded Postgres, and these
   changes are unverifiable until it can.
2. Then convert the `.space-y-2` block, one spec at a time, running each.
3. Then the two `locator("..")` cases.
4. Only then start P2's design-system consolidation.
