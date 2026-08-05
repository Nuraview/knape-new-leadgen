import { orm } from "@/lib/db-compat";

export const getOpportunitiesCount = async () => {
  const data = await orm.crm_Opportunities.count({ where: { deletedAt: null } });
  return data;
};
