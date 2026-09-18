# `demo-preview` — DO NOT MERGE THIS BRANCH

This branch exists for one reason: to give Vercel a build with
`VITE_DEMO_DATA=true`, so the outreach screens are populated for a
walkthrough or a screenshot.

It differs from `main` by exactly one line — the `buildCommand` in
`apps/app/vercel.json` — and that line is why it must never be merged.
Merging it turns the seeded dataset on for **production**, which means
Knape's own CRM would show 50 sends a day, a 48% open rate and a 160-row
sent log for outreach that has not been switched on yet
(`OUTREACH_SEND_ENABLED=false`).

## What this build shows

| | |
|---|---|
| Sent today / yesterday | 50 / 50 |
| Two days before        | 30 / 30 |
| Follow-ups due today   | 50 |
| Follow-ups, window     | 110 |
| New companies emailed  | 160 |
| Opened                 | 48% (77) |
| Clicked                | 0% (0) |
| Bounced                | 4% (6) |
| Sent log               | 160 rows |

Populated: Home's volume + engagement tiles, the angle breakdown,
Communications -> Sent, the bounce tab, and the reader dialog. Bodies are
plain text signed the way the pipeline now actually sends.

Every build from this branch carries the sample-data banner across the top.
That is not decoration — it is the reason the dataset was allowed to exist.
See `apps/app/src/lib/demo/enabled.ts`.

## Keeping it up to date

Rebase it onto `main`, never the other way:

    git fetch origin
    git checkout demo-preview
    git rebase origin/main
    git push --force-with-lease origin demo-preview

## Retiring it

    git push origin --delete demo-preview

Nothing on `main` depends on it. The dataset itself lives on `main` in
`apps/app/src/lib/demo/`, inert, because `demoDataEnabled` folds to `false`
without the flag and Rollup drops it from the bundle entirely.
