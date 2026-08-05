import { cache } from "react";
import { orm } from "@/lib/db-compat";
import { getLeadsEngagementSummary } from "./get-lead-engagement";

export const getLeads = cache(async () => {
  const data = await orm.crm_Leads.findMany({
    where: { deletedAt: null },
    include: {
      // Include assigned user (uses "LeadAssignedTo" relation)
      assigned_to_user: {
        select: {
          name: true,
        },
      },
      // Include assigned accounts
      assigned_accounts: true,
      // Include documents through DocumentsToLeads junction table
      documents: {
        include: {
          document: {
            select: {
              id: true,
              document_name: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const engagement = await getLeadsEngagementSummary(
    data.map((l: { email: string | null }) => l.email),
  );

  return data.map((lead: { email: string | null }) => ({
    ...lead,
    engagement:
      engagement.get(lead.email?.trim().toLowerCase() ?? "") ?? null,
  }));
});
