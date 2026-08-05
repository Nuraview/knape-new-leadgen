import { cache } from "react";
import { orm } from "@/lib/db-compat";

export const getContractLineItems = cache(async (contractId: string) => {
  return orm.crm_ContractLineItems.findMany({
    where: { contractId },
    include: {
      product: {
        select: { id: true, name: true, status: true },
      },
    },
    orderBy: { sort_order: "asc" },
  });
});
