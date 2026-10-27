# Event lead generation (WEFTEC, WorkBoat)

This document explains how Knape builds a prospect list around a trade show,
enriches it, and campaigns to it, reusing the existing lead pipeline. It covers
where the data comes from, how to run each step, and how the event pool stays
separate from the main Knape discovery pipeline.

## What this builds, and where the data comes from

For each show we build a pool of leads from two sources that Knape is entitled to
use:

1. The show's public exhibitor directory. This is a list of the companies that
   are exhibiting. It is published for anyone to read and needs no login.
2. Knape's own booth-scan export. When Knape's booth scans a visitor's badge, the
   show's lead-retrieval app lets Knape export those scans. Those people are
   Knape's own contacts. This is the only way an actual attendee enters the pool.

We do not pull a show's full attendee roster from the event platform. That list
is restricted by the organiser, and we leave it alone.

### WEFTEC 2026

WEFTEC's exhibitor directory runs on Map Your Show. The site publishes the full
exhibitor list as an Excel download at
`https://weftec26.mapyourshow.com/8_0/exhibitor/exhibitor-list.cfm?export=excel`,
which the site's own `robots.txt` allows. The file gives the company name and
booth number for about 1,150 exhibitors. We read that file, then the enrichment
step resolves each company's website and finds the right people.

### WorkBoat (2 December 2026)

WorkBoat's exhibitor directory sits behind a login (it redirects to a Personify
sign-in page), so it is not a public source and we do not scrape it. WorkBoat
prospects come from Knape's own booth-scan export instead. Load that file with
the booth-scan importer below.

## How the event pool stays separate

Event leads live in the same `accounts` and `contacts` tables as the main
pipeline, so the whole outreach and tracking stack works on them unchanged. They
are kept apart by two tags on each account:

- `data_batch`, set to the event slug, for example `weftec-2026`.
- `lead_source_bucket`, set to `event:<slug>`, for example `event:weftec-2026`.

A full re-sync of the main pipeline (`sync_records`) now preserves any account
whose `lead_source_bucket` begins with `event:`, so an event pool is never wiped
by a main-pipeline rebuild. The additive merge path (`merge_records`) takes
`data_batch_override` and `source_bucket_override` so the collectors write these
tags.

## Running it

Run these from `apps/leadgen` on the host, where `DATABASE_URL` points at the
cockpit database. Every command has a `--dry-run` that parses and prints without
writing anything. Start there.

### Preview the WEFTEC exhibitor list (writes nothing)

    python -m sources.weftec_exhibitors --dry-run

### Run the whole WEFTEC pass: collect, resolve websites, find contacts

    python -m outreach.event_pipeline --event weftec-2026 --show "WEFTEC 2026" \
        --website-limit 300 --contact-limit 300

The `--website-limit` and `--contact-limit` caps keep each run bounded, so it
only enriches event accounts and does not spend search budget on the main
pipeline. Run it again to continue where it left off. Each enrichment step only
fills what is empty, so repeat runs are safe.

To collect and merge without enriching yet:

    python -m outreach.event_pipeline --event weftec-2026 --show "WEFTEC 2026" \
        --collect-only

### Import Knape's own booth scans (WEFTEC or WorkBoat)

Export the scans from the show's lead-retrieval app as a CSV or XLSX, then:

    python -m outreach.event_pipeline --event workboat-2025 --show "WorkBoat 2025" \
        --booth-file /path/to/workboat_booth_scans.csv

The importer matches common column names (name, title, company, email, phone,
LinkedIn, notes, booth) on its own and removes duplicate email addresses. You can
also run the importer directly to preview:

    python -m sources.booth_scan_import --file /path/to/scans.csv \
        --event workboat-2025 --show "WorkBoat 2025" --dry-run

If the export has a "captured by" (or "scanned by") column, that person is kept
and shown in the Events table's "Captured by" column. A "segment" (or "category")
column is kept too and shown under the company name. Both are optional: a file
without them still imports.

### How the Events table classifies a lead (tiers)

The Events section groups leads into tiers (T0 Hot, T1 Warm, T2 ICP, T3 Partner).
A lead's tier comes from the `accounts.tier` column when it is set, and otherwise
falls back to a bucket derived from the ICP score, so every lead shows a tier
even before anyone classifies it. The collectors leave `tier` blank on purpose:
it is the authoritative, human-or-classifier-set value, so it is never guessed
from the public directory. To set it deliberately, include a `tier` column in a
booth-scan file (values like `T0-HOT`, `T3-PARTNER`), or set it in the database.

### Research and tier a pool with AI (`outreach/event_research.py`)

`python -m outreach.event_research --event weftec-2026 [--limit N] [--dry-run]
[--concurrency 6]` sets `tier` for every company in a pool that has none. For
each company name, the AI model (via `outreach/llm.py`: OpenAI gpt-5.4-mini or Claude Haiku, per the `AI_PROVIDER` setting) runs up to three
web searches with a show-specific brief and records the domain, a description,
an industry bucket, the relationship to Knape and a fit rating with a one-line
reason. The tier follows by fixed rules (`tier_for`): partner -> T3, competitor
-> X-COMPETITOR, school -> X-ACADEMIC, Excellent -> T0 with a strong show
presence else T1, Good (or Weak end customer/OEM) -> T2, the rest -> X-OTHER.
Strong presence is exhibiting, or 3 or more contacts on a non-exhibitor account
(WEFTEC and SEMICON have no registrant roster, so a contact count there means
reachability, not presence). The reason goes to `accounts.tier_reason` and is
shown on Hot, Warm and ICP leads; `tier_source`, `tier_model` and `tier_at`
record the pass. A tier set by hand is never overwritten, the pool is copied to
`_bak_accounts_tier_<slug>_<date>` before the first write, and every result is
logged to `event_research_<slug>.jsonl` so a re-run resumes. `--dry-run`
researches and logs without writing; `--apply-only` writes logged results.
WorkBoat was tiered the same way on 24 Oct 2026 by a one-off pass whose reasons
were backfilled into `tier_reason`.

### Find missing emails by name permutation (`sources/email_permute.py`)

`python -m sources.email_permute --event semicon-2026 [--dry-run]
[--interval 8] [--max-probes N] [--limit DOMAINS] [--log path.jsonl]` fills
`contacts.email` for people in a pool who have a name but no address. The mail
domain is the one real addresses at the same account use, else the website's;
a domain shared by three or more different companies (a registration agency)
is refused. If real addresses on that domain already show its format(s), only
those are tried; otherwise the formats the name allows are tried (initial-only
names get jsmith, j.smith, smithj, j_smith, smith; full first names add
john.smith, johnsmith, john and similar), on at most two people per domain.
Names that are departments ("Support Team") are skipped. Every address is
checked by the self-hosted Reacher (`reacher_verify`, shared 30-day cache, one
new check per `--interval` seconds). The run stops if Reacher itself stops
answering, if mail servers of two different domains reply with blocklist
wording, or if six domains give no answer within twelve checks. Kept: a
confirmed mailbox (confidence 0.9, `email_status` deliverable), or, only where
the format is evidenced by real addresses, a catch-all or unknown answer that
`send_gate` would send (confidence 0.7, `format_evidenced`). Never kept: a
catch-all or unknown answer on a guessed format, a "risky" answer from a
domain that is not catch-all, an invalid mailbox, a timeout. Writes only empty
emails, with `source_kind = 'permutation-verified'`, copying each row to
`_bak_permute_contacts_<date>` first; partners, competitors, schools and
X-OTHER are skipped. Every check and outcome goes to the JSONL log, and a
re-run skips people already settled on the same domain.

## Enrichment and sending

Enrichment reuses the existing engine. `resolve_account` finds each company's
website from its name, and `enrich_one_account` finds decision-maker contacts by
crawling the company site and searching, then stores verified or pattern emails.
Email addresses are verified at send time by `reacher_verify.send_gate`, as they
are for every other campaign.

Sending uses the existing outreach stack. In the cockpit, filter the accounts to
the event's `data_batch` (for example `weftec-2026`), review the list, and enrol
them into a campaign. Send in small batches, for example 50 at a time, and let
the open, bounce, reply, and unsubscribe tracking run as usual.

## Per-show messaging angles (Possible messaging angles tab)

Show pools get copy written for that show instead of the ten general angles.
`outreach/messaging_angles.py` holds `EVENT_ANGLE_SETS[slug]` (show, dates,
sample lead, angles); `pick_angle` routes any lead tagged
`lead_source_bucket = 'event:<slug>'` to its show's set, and each step carries a
`day` offset that `angle_schedule` turns into send dates (weekends and
Thanksgiving skipped; for a pre-show set the tail is clamped to the last send
day before the show, at least two days apart, and anything that no longer fits
is skipped).

- `workboat-2026` (`wb_*`): four angles, opener plus six follow-ups, 1-2 emails a
  week ending Tue 1 Dec. Peter is not exhibiting; the copy is a Houston rep for
  Texas and Louisiana writing before the show. Every email links to the public
  landing page `https://crm.knapesolutions.com/workboat-2026`
  (`apps/app/src/routes/workboat-2026.tsx`), whose form feeds the normal inbound
  capture (`/api/leadgen-public/inquiry` on the CRM API, forwarded to the
  cockpit's `POST /api/public/sample-request`; it shows on the Inbound page with
  source `workboat-2026-landing`).
- `semicon-2026` (`semi_*`): six post-show angles, four steps each.

The landing URL must be in `OUTREACH_APPROVED_LINKS`, or `enforce_approved_links`
rewrites it and the WorkBoat angles fall back to the site root (the tab warns).

The client reviews each angle under SHOWS > show > Possible messaging angles
(`/events/<slug>?view=angles`), backed by `GET /api/emails/angles?event=<slug>`
and `POST /api/emails/angles/<key>/review`, stored in `event_angle_reviews`.
Approval is a record only: it sends nothing, and show pools stay out of
automatic sending.

## Suggested sequencing

- WEFTEC first, because Knape attended recently and recall is high. Collect,
  enrich, review, then send in batches of about 50.
- WorkBoat second. Peter is not exhibiting (his territory is Texas and a bit of
  Louisiana), so the approved WorkBoat angles run 1-2 emails a week from approval
  until the day before the 2 December 2026 show.

## Files added for this work

- `sources/mapyourshow_directory.py`: generic reader for a Map Your Show public
  exhibitor export, parameterised by show subdomain.
- `sources/weftec_exhibitors.py`: the WEFTEC 2026 preset.
- `sources/booth_scan_import.py`: importer for a client's own booth-scan file.
- `outreach/event_pipeline.py`: the scoped runner that collects and enriches one
  event pool without touching the main pipeline.
- `outreach/cockpit_api.py`: `merge_records` gained the event-tag overrides, and
  `sync_records` now preserves `event:` accounts. It also persists the Events
  table's fields: `accounts.tier` and `accounts.segment`, and each contact's
  `phone`, `captured_by` and `repeat_attendee`.
