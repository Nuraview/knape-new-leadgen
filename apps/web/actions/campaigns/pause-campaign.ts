"use server";
import { orm } from "@/lib/db-compat";

export const pauseCampaign = async (id: string) => {
  return orm.crm_campaigns.update({
    where: { id },
    data: { status: "paused" },
  });
  // Note: in-flight Inngest jobs check campaign.status at execution start
  // and exit early when status is "paused" — no Inngest API cancellation needed.
};
