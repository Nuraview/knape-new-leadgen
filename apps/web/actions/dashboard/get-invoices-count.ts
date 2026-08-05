import { orm } from "@/lib/db-compat";

export const getInvoicesCount = async () => {
  const data = await orm.invoices.count();
  return data;
};
