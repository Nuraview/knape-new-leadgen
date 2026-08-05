import { orm } from "@/lib/db-compat";

export const getOpportunitiesFullByAccountId = async (accountId: string) => {
  const data = await orm.crm_Opportunities.findMany({
    where: {
      account: accountId,
      deletedAt: null,
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
