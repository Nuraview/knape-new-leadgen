"use server";
import { orm } from "@/lib/db-compat";

export const updateCampaign = async (
  id: string,
  data: Partial<{
    name: string;
    description: string;
    from_name: string;
    reply_to: string;
    template_id: string;
    scheduled_at: Date;
  }>
) => {
  return orm.crm_campaigns.update({ where: { id }, data });
};
