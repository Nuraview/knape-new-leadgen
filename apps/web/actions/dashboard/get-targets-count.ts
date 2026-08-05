import { orm } from "@/lib/db-compat";

export const getTargetsCount = async () => {
  const data = await orm.crm_Targets.count();
  return data;
};
