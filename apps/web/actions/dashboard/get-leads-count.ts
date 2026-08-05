import { orm } from "@/lib/db-compat";

export const getLeadsCount = async () => {
  const data = await orm.crm_Leads.count({ where: { deletedAt: null } });
  return data;
};
