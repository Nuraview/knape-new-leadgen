import { db } from "@/lib/db";
import { crmLeadStatuses } from "@/drizzle/schema";
import { ALLOWED_STATUSES } from "@/lib/leads/status-colors";
import { LeadsTabs } from "./components/LeadsTabs";

// The reviewer's actionable status model is {Follow-up, Lost} — nothing
// else. We filter to that whitelist here so legacy DB rows for "New" /
// "Reviewed" / "Contacted" / "Closed" / "Qualified" don't surface in the
// dropdown. They stay in the DB (older leads may still reference them);
// the UI just stops offering them as choices going forward.
async function loadStatuses() {
  const rows = await db
    .select({ id: crmLeadStatuses.id, name: crmLeadStatuses.name })
    .from(crmLeadStatuses);
  const allowed = rows.filter((r) =>
    (ALLOWED_STATUSES as readonly string[]).includes(r.name),
  );
  return allowed.sort(
    (a, b) =>
      ALLOWED_STATUSES.indexOf(a.name as (typeof ALLOWED_STATUSES)[number]) -
      ALLOWED_STATUSES.indexOf(b.name as (typeof ALLOWED_STATUSES)[number]),
  );
}

export default async function LeadsPage() {
  const statuses = await loadStatuses();
  return (
    // Full-width — the sidebar already eats ~240px, so the main column
    // should use the rest. Keep a small horizontal padding so the table
    // rows don't glue to the edges on ultrawide monitors.
    <div className="px-6 py-6 w-full max-w-none">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Leads</h1>
        <a
          href="/leads/kanban"
          className="text-sm underline text-muted-foreground hover:text-foreground"
        >
          Kanban →
        </a>
      </div>
      <LeadsTabs statuses={statuses} />
    </div>
  );
}
