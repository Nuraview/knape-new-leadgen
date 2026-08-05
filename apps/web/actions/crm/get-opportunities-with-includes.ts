"use server";

import { cache } from "react";
import { orm } from "@/lib/db-compat";

export const getOpportunitiesFull = cache(async () => {
  const data = await orm.crm_Opportunities.findMany({
    where: { deletedAt: null },
    include: {
      assigned_account: {
        select: {
          name: true,
        },
      },
      assigned_sales_stage: {
        select: {
          name: true,
        },
      },
      assigned_to_user: {
        select: {
          name: true,
        },
      },
    },
    orderBy: {
      created_on: "desc",
    },
  });

  return data;
});
