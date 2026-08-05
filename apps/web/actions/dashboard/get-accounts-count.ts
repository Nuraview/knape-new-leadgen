import { orm } from "@/lib/db-compat";

export const getAccountsCount = async () => {
  const data = await orm.crm_Accounts.count({ where: { deletedAt: null } });
  return data;
};
