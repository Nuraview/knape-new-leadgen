"use server";
import { orm } from "@/lib/db-compat";

export const getTasksCount = async () => {
  const data = await orm.tasks.count();
  return data;
};

export const getUsersTasksCount = async (userId: string) => {
  const data = await orm.tasks.count({
    where: {
      user: userId,
    },
  });
  return data;
};
