import { db } from "@/lib/db";
import { crmLeadStatuses } from "@/drizzle/schema";
import { ALLOWED_STATUSES } from "@/lib/leads/status-colors";
import { KanbanBoard } from "../components/KanbanBoard";

// See app/(routes)/leads/page.tsx — same whitelist of actionable statuses.
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

export default async function KanbanPage() {
  const statuses = await loadStatuses();
  return (
    <div className="p-6 w-full h-full">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Leads — Kanban</h1>
      </div>
      <KanbanBoard statuses={statuses} />
    </div>
  );
}
