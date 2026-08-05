import { orm } from "@/lib/db-compat";

export const getSalesType = async () => {
  const data = await orm.crm_Opportunities_Type.findMany({});
  return data;
};
