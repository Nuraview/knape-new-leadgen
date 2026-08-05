"use server";
import { orm } from "@/lib/db-compat";

export const getCampaign = async (id: string) => {
  return orm.crm_campaigns.findUnique({
    where: { id },
    include: {
      template: true,
      steps: {
        orderBy: { order: "asc" },
        include: {
          template: true,
          sends: {
            select: {
              status: true,
              opened_at: true,
              clicked_at: true,
              unsubscribed_at: true,
            },
          },
        },
      },
      target_lists: { include: { target_list: { select: { id: true, name: true } } } },
      sends: {
        include: { target: { select: { first_name: true, last_name: true } } },
        orderBy: { sent_at: "desc" },
      },
    },
  });
};
