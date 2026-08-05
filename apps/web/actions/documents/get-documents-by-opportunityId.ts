import { orm } from "@/lib/db-compat";

export const getDocumentsByOpportunityId = async (opportunityId: string) => {
  // Query through DocumentsToOpportunities junction table
  const data = await orm.documents.findMany({
    where: {
      opportunities: {
        some: {
          opportunity_id: opportunityId,
        },
      },
    },
    include: {
      created_by: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      assigned_to_user: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: {
      date_created: "desc",
    },
  });
  return data;
};
