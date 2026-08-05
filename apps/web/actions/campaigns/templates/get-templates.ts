"use server";
import { orm } from "@/lib/db-compat";

export const getTemplates = async () => {
  return orm.crm_campaign_templates.findMany({
    where: { deletedAt: null },
    orderBy: { created_on: "desc" },
    include: { created_by_user: { select: { name: true } } },
  });
};
