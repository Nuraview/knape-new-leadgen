"use server";
import { orm } from "@/lib/db-compat";
import { getSession } from "@/lib/auth-server";

export const deleteTemplate = async (id: string) => {
  const session = await getSession();
  return orm.crm_campaign_templates.update({
    where: { id },
    data: { deletedAt: new Date(), deletedBy: session?.user.id },
  });
};
