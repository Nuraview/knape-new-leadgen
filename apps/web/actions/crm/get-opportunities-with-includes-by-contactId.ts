import { orm } from "@/lib/db-compat";

export const getOpportunitiesFullByContactId = async (contactId: string) => {
  const data = await orm.crm_Opportunities.findMany({
    where: {
      deletedAt: null,
      // Filter through ContactsToOpportunities junction table
      contacts: {
        some: {
          contact_id: contactId,
        },
      },
    },
    include: {
      assigned_account: {
        select: {
          name: true,
        },
      },
      assigned_sales_stage: {
        select: {
          name: true,
        },
      },
      assigned_to_user: {
        select: {
          name: true,
        },
      },
    },
    orderBy: {
      created_on: "desc",
    },
  });

  return data;
};
