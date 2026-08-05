import { and, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { crmLeads, crmLeadStatuses, users } from "@/drizzle/schema";
import { formatDateTimeShort, formatDateOnly } from "@/lib/dates/short";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [lead] = await db
    .select({ firstName: crmLeads.firstName, lastName: crmLeads.lastName, company: crmLeads.company, jobTitle: crmLeads.jobTitle })
    .from(crmLeads)
    .where(and(eq(crmLeads.id, id), isNull(crmLeads.deletedAt)))
    .limit(1);
  if (!lead) return { title: "Lead not found — NuraviewCRM" };
  const name = lead.company || [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Lead";
  return { title: `${name} — NuraviewCRM` };
}

export default async function LeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) {
    const { id } = await params;
    redirect(`/sign-in?callbackUrl=/leads/${id}`);
  }

  const { id } = await params;

  const [lead] = await db
    .select({
      id: crmLeads.id,
      firstName: crmLeads.firstName,
      lastName: crmLeads.lastName,
      company: crmLeads.company,
      jobTitle: crmLeads.jobTitle,
      phone: crmLeads.phone,
      email: crmLeads.email,
      description: crmLeads.description,
      upworkJobUrl: crmLeads.upworkJobUrl,
      reminderAt: crmLeads.reminderAt,
      reminderNote: crmLeads.reminderNote,
      lastContactedAt: crmLeads.lastContactedAt,
      createdAt: crmLeads.createdAt,
      statusName: crmLeadStatuses.name,
      assigneeName: users.name,
    })
    .from(crmLeads)
    .leftJoin(crmLeadStatuses, eq(crmLeads.leadStatusId, crmLeadStatuses.id))
    .leftJoin(users, eq(crmLeads.assignedTo, users.id))
    .where(and(eq(crmLeads.id, id), isNull(crmLeads.deletedAt)))
    .limit(1);

  if (!lead) notFound();

  const displayName =
    lead.company ||
    [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
    "Unnamed Lead";

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <div className="border-b px-6 py-3 flex items-center justify-between bg-card/50">
        <Link
          href="/leads"
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          ← All Leads
        </Link>
        <Link
          href={`/leads?leadId=${lead.id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Open in CRM →
        </Link>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-semibold">{displayName}</h1>
          {lead.jobTitle && (
            <p className="text-muted-foreground mt-1">{lead.jobTitle}</p>
          )}
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            {lead.statusName && (
              <span className="text-xs bg-muted px-2 py-1 rounded-full font-medium">
                {lead.statusName}
              </span>
            )}
            {lead.assigneeName && (
              <span className="text-xs text-muted-foreground">
                Assigned to {lead.assigneeName}
              </span>
            )}
            {lead.createdAt && (
              <span className="text-xs text-muted-foreground">
                Added {formatDateOnly(lead.createdAt)}
              </span>
            )}
          </div>
        </div>

        {/* Contact */}
        {(lead.phone || lead.email) && (
          <div className="rounded-lg border p-4 space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
              Contact
            </div>
            {lead.phone && (
              <a
                href={`tel:${lead.phone}`}
                className="flex items-center gap-2 text-sm hover:underline"
              >
                <span>📞</span> {lead.phone}
              </a>
            )}
            {lead.email && (
              <a
                href={`mailto:${lead.email}`}
                className="flex items-center gap-2 text-sm hover:underline"
              >
                <span>✉️</span> {lead.email}
              </a>
            )}
          </div>
        )}

        {/* Activity */}
        {(lead.lastContactedAt || lead.reminderAt) && (
          <div className="rounded-lg border p-4 space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
              Activity
            </div>
            {lead.lastContactedAt && (
              <div className="text-sm">
                <span className="text-muted-foreground">Last contacted: </span>
                {formatDateOnly(lead.lastContactedAt)}
              </div>
            )}
            {lead.reminderAt && (
              <div className="text-sm">
                <span className="text-muted-foreground">Reminder: </span>
                {formatDateTimeShort(lead.reminderAt)}
                {lead.reminderNote && (
                  <span className="text-muted-foreground ml-2">
                    — {lead.reminderNote}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Description */}
        {lead.description && (
          <div className="rounded-lg border p-4">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
              Description
            </div>
            <p className="text-sm whitespace-pre-wrap">{lead.description}</p>
          </div>
        )}

        {/* Upwork link */}
        {lead.upworkJobUrl && (
          <a
            href={lead.upworkJobUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground underline"
          >
            Open Upwork job ↗
          </a>
        )}

        {/* CTA */}
        <div className="pt-2">
          <Link
            href={`/leads?leadId=${lead.id}`}
            className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            Open full details in CRM →
          </Link>
        </div>
      </div>
    </div>
  );
}
