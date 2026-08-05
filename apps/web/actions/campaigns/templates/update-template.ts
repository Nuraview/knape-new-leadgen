"use server";
import { orm } from "@/lib/db-compat";

export const updateTemplate = async (
  id: string,
  data: Partial<{
    name: string;
    description: string;
    subject_default: string;
    content_html: string;
    content_json: object;
  }>
) => {
  // Only update non-deleted templates
  const existing = await orm.crm_campaign_templates.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return null;
  return orm.crm_campaign_templates.update({ where: { id }, data });
};
