import { orm } from "@/lib/db-compat";

export const getLeadsByAccountId = async (accountId: string) => {
  const data = await orm.crm_Leads.findMany({
    where: {
      accountsIDs: accountId,
      deletedAt: null,
    },
    include: {
      assigned_to_user: {
        select: {
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
  return data;
};
