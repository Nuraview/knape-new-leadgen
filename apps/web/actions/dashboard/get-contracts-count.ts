import { orm } from "@/lib/db-compat";

export const getContractsCount = async () => {
  const data = await orm.crm_Contracts.count({ where: { deletedAt: null } });
  return data;
};
