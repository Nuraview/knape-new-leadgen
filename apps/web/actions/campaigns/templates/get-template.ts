"use server";
import { orm } from "@/lib/db-compat";

export const getTemplate = async (id: string) => {
  return orm.crm_campaign_templates.findFirst({
    where: { id, deletedAt: null },
    include: { created_by_user: { select: { name: true } } },
  });
};
