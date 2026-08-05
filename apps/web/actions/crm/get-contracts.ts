"use server";

import { cache } from "react";
import { orm } from "@/lib/db-compat";

export const getContractsWithIncludes = cache(async () => {
  const data = await orm.crm_Contracts.findMany({
    where: { deletedAt: null },
    include: {
      assigned_to_user: {
        select: {
          name: true,
        },
      },
      assigned_account: {
        select: {
          name: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
  return data;
});

export const getContractsByAccountId = async (accountId: string) => {
  const data = await orm.crm_Contracts.findMany({
    where: {
      account: accountId,
      deletedAt: null,
    },
    include: {
      assigned_to_user: {
        select: {
          name: true,
        },
      },
      assigned_account: {
        select: {
          name: true,
        },
      },
    },
  });
  return data;
};
