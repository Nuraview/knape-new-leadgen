Updated NuraView Internal CRM Requirement

1. Product goal
   Build an intuitive internal CRM for NuraView that receives leads from a Python Upwork scraper and presents them in a clean, fast, prioritization-first interface for review, follow-up, reminders, and lead handling. The CRM should replace the current n8n + Google Sheets flow and become the main workspace for lead management.
2. Data flow
   Python scraper instance → CRM backend ingestion → Next.js CRM UI → lead review / Kanban / reminders / status updates.
   The scraper already returns structured data such as job URL, title, description, budget, location, timestamps, client company, client info, activity, skills, proposal questions, and history, so the CRM should store both simplified CRM fields and the raw scraped payload.
3. Lead source and stored fields
   Each scraped Upwork record should be stored as one lead item.
   Primary fields to store and display:

Company name

Upwork job link

Extracted date and time

Source = Upwork

First name, if found

Primary email, if found

Job title, if found

Lead status

Reminder state

last contacted at

Highlighted / taken-care-of state

4. Lead display rules

If company name exists, show it prominently.

If no company name exists, show the record as a generic lead.

Sort by extracted time in ascending or descending order.

Newer leads should surface above older leads.

Default view should favor freshness and company-based leads.

5. Filtering
   Add a filter to show only company-based leads.
   Filter behavior:

Toggle: Companies only

This should be one of the first filters available.

It is a top-priority review mode.

6. Kanban board viewing
   The CRM must include a Kanban board view in addition to list view.
   Kanban requirements:

Leads can be moved between status columns.

A lead can be marked as reviewed / taken care of.

A lead can be visually highlighted once processed.

Kanban should help the user see progress at a glance.

Each card should be clickable to open the lead detail drawer or page.

The Kanban board should be simple, clean, and fast, not cluttered.

Suggested Kanban columns:

New

Reviewed

Contacted

Follow-up

Closed / Taken Care Of

7. Lead review and detail view
   Clicking a lead should open a detailed view containing:

Company name

Upwork source link

First name, if available

Primary email, if available

Date and time extracted

last contacted at

Any useful scraped metadata

8. Reminder system

The user should be able to set a reminder from a lead record.

last contacted at should start empty by default.

The user can select today’s date or another date manually.

After contact, the user can schedule a follow-up reminder.

9. Notifications
   Reminder notifications should be delivered through WhatsApp push notification.
10. Notion-style product points to add
    These are the useful Notion-like qualities the CRM should borrow:

Clean, calm interface with minimal visual noise

Fast inline editing for quick updates

Flexible views for the same data, especially list and Kanban

Easy drag-and-drop interaction where possible

Lightweight workspace feel, not a heavy enterprise CRM

Simple block-like or card-like structure for easy scanning

Quick organization with tags, statuses, and filters

A system that feels flexible and personal rather than rigid

11. Core user workflow

Python scraper collects Upwork leads.

CRM imports new leads.

Company leads appear first.

User filters to company-only when needed.

User reviews leads in list or Kanban view.

User marks leads as highlighted / handled.

User opens a lead and updates last contacted at.

User schedules a WhatsApp reminder.

12. Product intent
    The CRM should feel more like a clean, organized workspace than a traditional bloated CRM. The design should combine lead-management speed with Notion-like clarity, flexibility, and simplicity.
    If you want, I can now turn this into a proper PRD with sections like User Stories, Views, Data Model, and Acceptance Criteria.
