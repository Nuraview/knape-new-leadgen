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

## Suggested sequencing

- WEFTEC first, because Knape attended recently and recall is high. Collect,
  enrich, review, then send in batches of about 50.
- WorkBoat second. Collect Knape's booth scans now, but hold the send until about
  two to three weeks before the 2 December 2026 show rather than months ahead.

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
