import { orm } from "@/lib/db-compat";

export const getAccountsByOpportunityId = async (opportunityId: string) => {
  const data = await orm.crm_Accounts.findMany({
    where: {
      deletedAt: null,
      opportunities: {
        some: {
          id: opportunityId,
        },
      },
    },
    include: {
      assigned_to_user: {
        select: {
          name: true,
        },
      },
      contacts: {
        select: {
          first_name: true,
          last_name: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
  return data;
};
