import { orm } from "@/lib/db-compat";

export const getCampaigns = async () => {
  const data = await orm.crm_campaigns.findMany({});
  return data;
};
