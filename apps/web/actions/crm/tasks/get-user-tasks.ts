import { orm } from "@/lib/db-compat";

export const getUserCRMTasks = async (userId: string) => {
  const data = await orm.crm_Accounts_Tasks.findMany({
    where: {
      user: userId,
    },
    include: {
      assigned_user: {
        select: {
          id: true,
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
