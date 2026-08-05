import { orm } from "@/lib/db-compat";

export const getAccountsTasks = async (accountId: string) => {
  const data = await orm.crm_Accounts_Tasks.findMany({
    where: {
      account: accountId,
    },
    include: {
      assigned_user: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
  return data;
};
