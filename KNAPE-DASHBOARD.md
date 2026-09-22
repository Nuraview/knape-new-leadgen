# Knape & Associates dashboard — build status

This folder used to be the **Win the Day Planner** instance. It is being turned
into the **Knape & Associates** instance in place, on branch `knape`.

**Nothing in `/root/knape/knape-leadgen` was touched.** Verified: no file there
has an mtime after this session started, and its 15 dirty git files all predate
it. Its `cockpit-api` service on :8787 is still running and still owns Knape's
lead discovery and enrichment.

---

## Where it runs

| Piece | Where | State |
|---|---|---|
| Cockpit API (Python/FastAPI) | systemd `knape-dash-api`, `127.0.0.1:8790` | **running, healthy** |
| Its database | `leadgen-pg` container, db `leadgen` — Knape's live pipeline data | 5,889 accounts, 2,245 contacts |
| CRM API (Hono) | `apps/api`, db `knape_pm` | migrated, not yet started |
| CRM database | `leadgen-pg`, db `knape_crm` | tables applied |
| SPA (`apps/app`) | builds clean; not yet opened in a browser | see "What is left" |

Three other client services on this box are untouched and still `active`:
`cockpit-api` (:8787, Knape's pipeline), `winday-api` (:8788),
`tec5-cockpit-api` (:8789). **8789 is tec5's** — that is why this instance is on
8790.

### Why a second cockpit process

The dashboard SPA calls ~40 endpoints that Knape's own `:8787` build does not
have (`/api/emails/*`, `/api/outreach/inboxes`, `/api/settings`,
`/api/emails/campaign/*`, `/api/agent/*`). Pointing the dashboard at :8787 would
404 the Emails, Inboxes and Campaign panes.

So `knape-dash-api` runs the newer cockpit build against **the same `leadgen`
database**. Two readers, one dataset: :8787 keeps running the pipeline exactly
as before, and :8790 only serves the dashboard.

Its schema init was verified **purely additive** first — restored the dump into
a throwaway `leadgen_probe` database, booted the new cockpit against it, and
diffed: 9 new tables, zero `DROP`, zero `ALTER` on any existing column. Only
then was it pointed at the live database.

**Backup taken before any of this:** `/root/db-backups/knape-leadgen-20260805_1534.sql` (18 MB).

---

## Credentials and config

- Instance env template: `deploy/env/knape.env.example` (committed, no secrets)
- Live values: `.env` at the repo root (gitignored)
- Cockpit env: `apps/leadgen/.env` (gitignored)
- CRM login seeded: `peter@knapesolutions.com`, owner, CRM=full.
  Password is in the scratchpad at
  `/tmp/claude-0/-root-knape/b63cdd96-7e12-4203-9941-3efe9b251e65/scratchpad/seed_pw.txt` —
  **move it somewhere real and delete that file.**

`BRAND_SITE_URL` / `APP_URL` are guesses (`crm.knapesolutions.com`). If the
dashboard gets a different hostname, change them in both `.env` and the template.

---

## Branding

Palette taken from the supplied logo, which has exactly two inks: cyan
`#0693cf` and charcoal `#231f20`. Nothing was invented.

The accent foreground is the **charcoal**, not white: white on this cyan is
3.4:1, below AA for body text, while charcoal on it is 6.1:1 — and it is the
pairing the logo itself uses.

Assets are generated, not hand-cut, by
`scripts/one-off/20260805-knape-brand-assets.py` (re-runnable, explains its own
artwork decisions):

- `knape-logo.png` / `knape-logo-dark.png` — the lockup for dark and light
  surfaces. The wordmark is recoloured for the dark theme; **the disc is not**,
  because recolouring it turns the mark into a near-white coin.
- `knape-favicon.ico` (7 frames, each composed at its own size), `-icon-192`,
  `-icon-512`, `-icon-maskable-512`, `-apple-touch-icon`, `-og`.
- The icons **invert** the mark — cyan tile, charcoal K. The disc as supplied is
  a charcoal circle, and at 16px that is the same dark blob as every other
  favicon in the tab strip.

---

## The project board (2026-09-22)

VK asked for NuraView's project-management board on this instance — "you just
duplicate that, it here on crm.knapesolutions.com... there is labels, there is
subtasks, everything" — with Peter on it and two of his team, Oswe and
Catherine, working it beside him. That reverses the 2026-08-03 decision ("we
don't need this project management, right? No, no, no").

**The board was already here.** This repo is a vendored fork of
[Kaneo](https://github.com/usekaneo/kaneo) (`docs/vendor/kaneo-manifest.json`),
the same code NuraView runs, and `column`, `label`, `comment`, `workspace`,
`invitation`, `task-relation`, `time-entry` and `workflow-rule` were already
byte-identical to theirs. Three things stood between that and a usable board.

### It was switched off, by a flag that did two jobs

`BRAND_HIDE_PROJECTS=true` hid the Business group **and** the work clock,
Employees and Today's Activity. Flipping it wholesale would have put NuraView's
staff timesheet — the half-hourly "are you still working?" prompt, the penalty
rules, the overnight auto-close — at the top of Peter's sidebar, asking him to
clock in to his own business.

Split into `BRAND_HIDE_PROJECTS` (boards, now `false`) and
`BRAND_HIDE_WORK_CLOCK` (the vendor's timesheet, `true`). Employees rides with
the clock, since its hours and still-clocked-in columns *are* the clock.
NuraView's own instance sets neither and is unchanged.

### There were three boards, and only one of them was the right one

`/projects` proxied the Python cockpit's `pm_*` tables; `/board` redirected into
NuraView's own shared project through `apps/api/src/nvprojects`. Three nav items
called some variant of "Projects", each over a different database. Both are
gone, along with the passthrough middleware, `NV_PROJECTS_*` and the
`sharedProjectId` special case in the project access panel. The board is the
Kaneo one under Business, on Knape's own data.

### The board had drifted behind NuraView's

Ported from `../nextcrm-app`, NuraView-only behaviour stripped on the way in:

- **The permission split.** `manageTasks` demanded create AND update AND delete,
  and better-auth grants a bundle only when every action is held. A `member` has
  update but not delete, so *every* editing control read false — status,
  priority, title, labels, dates, subtasks, the whole context menu. Oswe and
  Catherine would have opened a board that looked broken rather than restricted.
  Now `updateTasks` / `deleteTasks`, matching what the API already asks for.
- **Subtasks on the card.** Subtasks are real `task` rows joined by
  `task_relation`, so the board drew every checklist item as its own card — a
  twelve-row import with three subtasks each arrived as forty-eight ("its adding
  as separate tasks when bulk import", VK). They are hidden as cards now and the
  parent carries a `2/5` badge that opens into a tickable checklist, with a
  toolbar toggle to put them back.
- **An import that keeps labels and subtasks.** `import-tasks.ts` now resolves
  `labels[]`, `subtasks[]` and a work-stream name per row, creating each on
  demand. `validate-task-fields.ts` stops mapping an unknown status to
  "planned" — that is the backlog, not a column, and it is how 146 cards were
  created, reported successful, and rendered on no board at all.
- **Add a column from the board**, and paste-a-JSON bulk add, both from the
  toolbar.
- **Work streams** (`task_project`, migration `0050`): the "Project" chip on a
  card, workspace-scoped and distinct from the board it sits on.
- **`visibleProjectIds`**, so the "which boards may I see" rule lives in one
  place instead of two.

**Not ported**, because it is NuraView's business and not Knape's: the personal
board hand-off (`task/handoff.ts` — assigning a card moves it to the assignee's
own board), `externalClient` / client-sync, the Discord Messages panel,
proofing, employee pay and the scheduler. `task/placement.ts` here holds the
generic column-placement half of `handoff.ts`, which the import genuinely needs.

### Tagging somebody did not email them

The mention pipeline was complete and identical to NuraView's, and delivered
nothing, for three separate reasons:

1. `deliverNotification` returns early without a `user_notification_preference`
   row, and again without an active `user_notification_workspace_rule`. Nothing
   in the product writes either — they are created by the user's own Settings →
   Account → Notifications page.
2. `email_enabled` is `.default(false)` on both tables.
3. `SMTP_*` was undocumented for this instance, and `sendNotificationEmail`
   returns `{ success: false, reason: "SMTP_NOT_CONFIGURED" }` **silently** —
   the in-app bell still lights up, so the feature looks alive while no mail has
   ever left the building.

`seed-instance.ts` now writes both rows, email on, for a new account (and leaves
an existing one alone). The `SMTP_*` block is documented in
`deploy/env/knape.env.example`. crm.tech5SA, the reference VK gave, had no
preference table in front of it at all — an opt-in nobody is told about is
indistinguishable from a bug.

Also: a duplicated `prosemirror-model` in the install tree made every
cross-copy `Fragment` call throw, which killed @mention **insertion** in the
editor. Pinned in root `resolutions` and deduped in `vite.config.ts` /
`vitest.config.ts`, matching NuraView.

Eleven strings in `notification-preferences/delivery.ts` said "NuraView"
outright — "You were mentioned in a NuraView task", "Open in NuraView". They
read the brand now, as does the WhatsApp mirror's signature.

### Accounts

- **Peter** — owner, CRM full. `visibleProjectIds()` returns `"all"`; he needs
  no assignment rows.
- **Oswe and Catherine** — `--role member --crm none --projects yes`. `NavCrm`
  returns null for them and every `/lead`, `/pipeline`, `/dialer`, `/proposal`
  and `/invoice` route 403s server-side.

  `get-projects.ts` fails closed: a member with no `project_member` row sees an
  **empty** Projects list, deliberately, so a default can never leak one
  client's boards. So they need a row per board —
  `assign-project.ts --email <them> --all` writes them all in one command. A
  board created afterwards needs them added from its Members tab.

`seed-instance.ts --keep-password` re-applies role, access and notification
settings to an existing account without resetting its password, which is how
Peter picks up the notification rows without being locked out of his own CRM.


---

## What was removed

Deleted: the Win-the-Day landing pages (27 MB), call scripts, proposal and
screenshot litter, `push_envs.py` (which had live NuraView secrets in plaintext),
both winday `.env` files, the `wtdp-*` brand assets, the winday email assets and
Dan's signature photo, `deploy/crmx1-board-service-account.sql`, and **all five
deploy workflows** — `deploy-leadgen.yml` rsynced over `/root/winday/winday-leadgen`
and restarted their service, which would have fired on the first push.

Also removed: `apps/web` (NuraView's legacy Next CRM, unused when
`BRAND_LEGACY_BASE_URL=none`) from the workspace, and the `tunnel` script that
SSH'd to NuraView's own Postgres.

`sources/nces_schools.py` and `sources/usaspending.py` are gone. Those are the
NCES school universe and USAspending prevention-grant lookups — not a source
list but a customer definition. Run against Knape they would not return fewer
leads, they would return confidently scored leads for the wrong industry,
written into the accounts table beside the real ones with no way to tell them
apart afterwards.

`outreach/budget_memo.py` is gone: it rendered a "Budget Justification
Memorandum" PDF addressed to a school superintendent, quoting per-student cost
and the federal grant programmes covering it, and `lead_notify` **attached it
automatically** to anyone who filled in a form.

---

## What was made brand-driven rather than renamed

The rule this codebase already established: **vendor names stay, client names
go.** NuraView is the vendor building the product; "Win the Day" is a client.

- `apps/api/src/utils/get-brand.ts` already existed and did most of the work.
  Added a Python twin, `apps/leadgen/outreach/brand.py`, reading the same
  variable names, for the half of the product that renders outbound email.
- Order numbers: `WTD-0001` → prefix derived from `BRAND_SHORT_NAME`. It is read
  aloud to customers.
- Seed script workspace name: was the constant `"NuraView"`, now the brand — it
  is the first thing a client's staff see.
- Assistant system prompt: was hardcoded to Dan Rigby of Win the Day Planner, so
  every client's assistant said so out loud and cited "schools" at a firm that
  sells to manufacturers.
- LinkedIn and email AI prompts: the business description is now
  `BRAND_BUSINESS_BRIEF` / `BRAND_AUDIENCE_BRIEF`. **Empty is meaningful** — the
  prompt then says outright that it does not know the product. A model told it
  does not know writes cautious copy; a model told the *wrong* product writes
  fluent, specific fiction.
- `messaging_angles.py`: rewritten. 10 angles, 40 emails, for a
  specification-led industrial sale (get specified early, expansion timing,
  engineering capacity, lead times, total cost, application fit, compliance,
  retrofit, field proof, single point of responsibility). Keys match the
  TypeScript angle list so a LinkedIn post and an email on the same angle agree.
  Links are now `BRAND_MARKETING_URL` + optional `OUTREACH_APPROVED_LINKS`
  instead of three hardcoded paths.
- `_industry_tag` / `_fallback_spark` in the cockpit: these write the industry
  bucket and the one-line brief on **every account card**. The spark line used
  to assert the company "sits in a county with active federal
  substance-prevention grant funding" — a specific, checkable, false claim, and
  the first sentence the client reads on a lead. Now written off the signal
  category, which is what the pipeline actually establishes.
- The click-tracker's fallback redirect was `winthedayplanner.com`, so a
  malformed tracking link on any instance sent that click to them.
- `scoring/icp.py`: replaced with Knape's own industrial ICP, **copied from**
  `knape-leadgen` (read-only). Same imports, same `score_record` signature.

### A bug this surfaced

`campaign_sender._angle_for` picked randomly from two hardcoded lists of angle
**keys**, split by whether the company name looked like a school. Rewriting the
angle set would have made `get_angle()` return `None` and killed drafting with
an `AttributeError` pointing nowhere. It now calls `pick_angle`, the single
source of truth, which is also stable per account instead of re-rolling every
run. Two `render_angle_steps(..., "Dan Rigby")` calls hardcoded the signer past
every settings override; both now read the brand.

Also fixed: `scripts/crm-apply.ts` never loaded dotenv, so it failed with
"CRM_DATABASE_URL is not set" when run exactly the way its own docstring said.

---

## Verified working

- `knape-dash-api` boots, `/api/health` 200, service account login returns a token.
- `/api/summary` → 5,889 accounts, 2,245 contacts, industry mix reading
  Industrial & OEM / Marine & offshore / Oil, gas & chemical — Knape's real data.
- `/api/emails/angles` returns the 10 new industrial angles.
- All 14 touched Python modules import cleanly.
- Rendered sequences fill correctly, including the blank-signal fallback.
- `bun install`, `build:packages`, drizzle migrations, CRM SQL, and the seed all
  succeeded.
- No `wintheday|win the day|winday|rigby` match anywhere outside `apps/leadgen`.

## What is left

1. **Open the SPA in a browser.** It builds, typechecks with zero errors and its
   tests pass, but nobody has logged in and looked at it. That is still the one
   thing that has not been eyeballed, and it is the deliverable. Start `apps/api`
   with the `BRAND_*` vars exported and sign in as Peter.
   - `SMTP_*` has to be set on the instance before a mention email can be
     tested at all, and it fails silently when it is not.
   - Confirm `crm.knapesolutions.com` is the live vhost — `BRAND_SITE_URL`,
     `APP_URL` and `NURAVIEW_CLIENT_URL` are still the guess noted above, and
     every mention email's link is built from them.
   - Apply migration `0050_task_project` (`bun run pm:migrate`).
2. **Discovery/enrichment vocabulary** (~200 refs in `sources/` and `pipeline/`)
   still assumes school districts — domain heuristics, staff-directory crawling,
   `_looks_like_school_domain`. None of it is on the dashboard's read path and
   Knape's discovery runs from `:8787`, so it is inert here, but it is not clean.
3. `sample_leads` still stores `school` / `students_count` / `school_type` as
   **column names**. The UI labels are neutral (Organisation / Size / Segment);
   renaming the columns needs a migration for no user-visible gain.
4. ~~The git remote still points at `Nuraview/winplanner-leadgen`.~~ Resolved —
   `origin` is now `Nuraview/knape-new-leadgen` and work ships from `main`. The
   local checkout was renamed to `/root/knape/knape-new-leadgen` to match.
5. Disk is at 93% (7.5 GB free). `bun install` took ~2 GB.

## Rolling back

Everything is on branch `knape`; `winday` is untouched and `origin/winday` is
0 ahead / 0 behind. `git checkout winday` restores the folder. To undo the
service: `systemctl disable --now knape-dash-api`. To undo the database
additions: the 9 added tables are additive and empty; the backup above restores
the rest.
