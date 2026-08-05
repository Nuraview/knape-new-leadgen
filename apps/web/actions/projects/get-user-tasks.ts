import { orm } from "@/lib/db-compat";

export const getUserTasks = async (userId: string) => {
  const data = await orm.tasks.findMany({
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
