# Usage audit and kill list (P0.3)

Measured 2026-07-27 against **production** (`nuraview-crm-pg` on the VPS,
`pg_stat_user_tables`, Postgres uptime 3d 20h) and cross-checked against the
Neon copy in `apps/web/.env`.

**Headline: 72 of 116 tables are empty in production. 44 hold data.**

The "empty" result is not a migration artifact. Production moved to the VPS on
2026-07-24, so the obvious worry was that data simply hadn't come across. The Neon
database reports the same zeros for the same tables (`crm_Accounts` 0,
`crm_Contacts` 0, `crm_Opportunities` 0, `Invoices` 0, `Documents` 0, `Boards` 0,
`Tasks` 0, `crm_campaigns` 0, `Users` 1, `crm_Leads` ~49.8k). Two independent
databases agreeing means these modules were never used.

This matters because the approved plan budgets **~20–24 weeks (P7–P13)** on porting
CRM modules, and its single largest phase — P9, "CRM core", 5–6 weeks, 162 files —
covers accounts, contacts, opportunities, contracts and products. **Every one of
those tables is empty.**

## What is actually alive

| Table | Rows | Reads (3d20h) | Module |
|---|---:|---:|---|
| `scrape_runs` | 64,779 | 19,142 | scraper ingest |
| `crm_Leads` | 50,295 | 9,362 | **leads — the product** |
| `crm_Lead_Enrichment` | 40,522 | 958 | enrichment |
| `mkt_email_events` | 4,176 | 11 | marketing |
| `crm_Lead_Views` | 3,241 | 3,108 | leads |
| `mkt_sequence_items` | 3,043 | 30 | marketing sequences |
| `mkt_emails` | 2,685 | 46 | marketing mailbox |
| `whatsapp_message` | 2,646 | 15 | whatsapp bridge |
| `whatsapp_outbox` | 1,784 | 20 | whatsapp bridge |
| `crm_Activity_Events` | 1,568 | 434 | activity |
| `mkt_threads` / `mkt_thread_folders` | ~1,100 each | 3–5 | marketing mailbox |
| `mkt_users` / `mkt_contacts` / `mkt_sequences` | ~900–980 | 15–50 | marketing |
| `crm_Proposal_Activity` | 890 | 8 | proposals |
| `dialer_sms_messages` | 347 | 166 | dialer |
| `dialer_contacts` | 91 | 59 | dialer |
| `crm_Proposals` + line items + assets | 22 / 22 / 19 | 118 | proposals |
| `whatsapp_session`, `scraper_heartbeat`, `dialer_client_sessions`, `scraper_cookies` | 1–3 | 761–13,885 | hot polling singletons |
| `Users` | **1** | 151 | auth |

The live product is: **lead scraping → enrichment → outreach (marketing email, WhatsApp,
dialer) → proposals.** Everything else is scaffolding inherited from the NextCRM fork.

## Empty in production — recommend archive, not port

Zero rows in both databases:

- **CRM core** — `crm_Accounts`, `crm_Contacts`, `crm_Opportunities`, `crm_Contracts`,
  `crm_Products`, `crm_ProductCategories`, `crm_AccountProducts`,
  `crm_OpportunityLineItems`, `crm_ContractLineItems`, `crm_Targets`, `crm_TargetLists`
- **Invoicing** — `Invoices`, `Invoice_LineItems`, `Invoice_Payments`,
  `Invoice_Attachments`, `Invoice_Activity`, `Invoice_Series`, `Invoice_TaxRates`
- **Projects / PM** — `Boards`, `Sections`, `Tasks`, `tasksComments`, `BoardWatchers`,
  `TodoList`
- **Documents** — `Documents`, `Documents_Types`, and all six `DocumentsTo*` junctions
- **Campaigns (CRM-side)** — `crm_campaigns`, `crm_campaign_steps`, `crm_campaign_sends`,
  `crm_campaign_templates`, `CampaignToTargetLists`
- **Embeddings / semantic search** — all five `crm_Embeddings_*`, `crm_Document_Chunks`,
  `EmailEmbedding`
- **IMAP mailbox** — `EmailAccount`, `Email`, `EmailsToContacts`, `EmailsToAccounts`
- **Misc** — `Employees`, `crm_AuditLog`, `crm_Report_Config`, `ApiKeys`, `ApiToken`,
  `ImageUpload`, `crm_Contact_Enrichment`, `crm_Target_Enrichment`

Note `crm_Report_Schedule` and `EmailAccount` have 0 rows but 463 and 461 reads — that
is a cron or poller querying an empty table on a schedule. Pure waste; worth killing
regardless of the migration.

## Consequences for the plan

1. **The PM data migration is a no-op.** `Boards`/`Sections`/`Tasks`/`tasksComments`/
   `BoardWatchers` are all empty. Adopt Kaneo's schema outright — no migration script,
   no `pm_legacy_id_map`, no `legacy_id` columns, no `document_task_links` bridge, and
   **no `tasksComments_task_fkey` drop**, which was the only destructive DDL in the
   entire plan. P4 gets materially simpler and safer.
2. **P9 should not run as specified.** 5–6 weeks porting accounts/contacts/
   opportunities/contracts/products moves zero rows and zero users. Either drop it or
   rebuild those as new features against the Kaneo/Plane model *if the business wants
   them*, rather than porting NextCRM's versions.
3. **P8 invoices** — no invoice has ever been issued. Same question.
4. **Auth cutover is trivial.** `Users` has 1 row, so the "one forced re-login"
   decision affects exactly one account.
5. **Reorder the phases to follow the data**: leads + scraper ingest → enrichment →
   dialer → whatsapp → marketing mailbox → proposals. That is the whole live product,
   and it is a much smaller surface than 18 modules.

## What this does not tell us

Row counts measure *use*, not *intent*. Some of these may be deliberately staged for
work that hasn't started — the CRM-side campaigns module, for instance, overlaps
heavily with the `mkt_*` marketing module that *is* in use, which suggests one
superseded the other. **This list needs sign-off before anything is archived**; the
recommendation is to archive (leave the tables, stop porting the code), never to drop
tables.

Route-level nginx access-log counts would sharpen this further and are still worth
collecting.
