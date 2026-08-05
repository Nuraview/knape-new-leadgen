"use server";

import { orm } from "@/lib/db-compat";

export async function getAccountById(accountId: string) {
  const account = await orm.crm_Accounts.findFirst({
    where: { id: accountId, deletedAt: null },
    select: { id: true, name: true },
  });

  return account ?? null;
}
