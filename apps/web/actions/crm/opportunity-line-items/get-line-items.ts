import { cache } from "react";
import { orm } from "@/lib/db-compat";

export const getOpportunityLineItems = cache(async (opportunityId: string) => {
  return orm.crm_OpportunityLineItems.findMany({
    where: { opportunityId },
    include: {
      product: {
        select: { id: true, name: true, status: true },
      },
    },
    orderBy: { sort_order: "asc" },
  });
});
