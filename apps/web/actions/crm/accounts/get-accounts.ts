"use server";
import { orm } from "@/lib/db-compat";

export const getAccounts = async () => {
  try {
    const accounts = await orm.crm_Accounts.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return { data: accounts };
  } catch (error) {
    return { error: "Failed to fetch accounts" };
  }
};
