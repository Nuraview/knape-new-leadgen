"use server";

import { orm } from "@/lib/db-compat";

export const getIndustries = async () => {
  const data = await orm.crm_Industry_Type.findMany({});
  return data;
};
