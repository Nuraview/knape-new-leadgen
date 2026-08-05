import { orm } from "@/lib/db-compat";

export const getCampaignsCount = async () => {
  const data = await orm.crm_campaigns.count();
  return data;
};
