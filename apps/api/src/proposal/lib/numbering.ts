import db from "../../database/crm";
import { crmProposals } from "../../database/crm-schema";
import { max } from "drizzle-orm";

/**
 * Next sequential proposal number. Proposals use a simple global counter
 * (max(number) + 1) rather than the invoice series machinery — the number is
 * only used to build a readable public URL, not for accounting.
 */
export async function nextProposalNumber(): Promise<number> {
  const [row] = await db
    .select({ maxNumber: max(crmProposals.number) })
    .from(crmProposals);
  return (row?.maxNumber ?? 1000) + 1;
}
