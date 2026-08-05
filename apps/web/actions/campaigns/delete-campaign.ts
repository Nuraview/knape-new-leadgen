"use server";
import { orm } from "@/lib/db-compat";

export const deleteCampaign = async (id: string) => {
  return orm.crm_campaigns.update({ where: { id }, data: { status: "deleted" } });
};
