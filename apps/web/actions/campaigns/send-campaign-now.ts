"use server";
import { orm } from "@/lib/db-compat";
import { inngest } from "@/inngest/client";

export const sendCampaignNow = async (id: string) => {
  const now = new Date();
  await orm.crm_campaigns.update({
    where: { id },
    data: { status: "sending", scheduled_at: now },
  });

  await inngest.send({
    name: "campaigns/send-now",
    data: { campaignId: id },
  });
};
