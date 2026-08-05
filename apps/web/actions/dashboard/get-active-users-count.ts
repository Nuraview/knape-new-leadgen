import { orm } from "@/lib/db-compat";

export const getActiveUsersCount = async () => {
  const data = await orm.users.count({
    where: {
      userStatus: "ACTIVE",
    },
  });
  return data;
};
