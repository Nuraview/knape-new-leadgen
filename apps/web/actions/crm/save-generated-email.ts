"use server";

import { orm } from "@/lib/db-compat";
import { getSession } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";

/**
 * Persist (or clear) a lead's generated email draft so it survives
 * refresh/navigation. Empty strings are normalized to null.
 *
 * Bound with the leadId via `.bind(null, leadId)` so it can be passed to
 * the client `GenerateEmailButton` as `onSaveEmail({ subject, body })`.
 */
export async function saveGeneratedEmail(
  leadId: string,
  { subject, body }: { subject: string; body: string }
) {
  const session = await getSession();
  if (!session) throw new Error("Unauthenticated");

  await orm.crm_Leads.update({
    where: { id: leadId },
    data: {
      generatedEmailSubject: subject?.trim() ? subject : null,
      generatedEmailBody: body?.trim() ? body : null,
    },
  });

  revalidatePath(`/crm/leads/${leadId}`);
}
