import { orm } from "@/lib/db-compat";

export const getUserLeads = async (userId: string) => {
  const data = await orm.crm_Leads.findMany({
    where: {
      assigned_to: userId,
      deletedAt: null,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
  return data;
};
