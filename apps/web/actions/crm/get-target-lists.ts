"use server";
import { orm } from "@/lib/db-compat";

export const getTargetLists = async () => {
  const targetLists = await orm.crm_TargetLists.findMany({
    where: { deletedAt: null },
    orderBy: { created_on: "desc" },
    include: {
      crate_by_user: { select: { name: true } },
      _count: { select: { targets: true } },
    },
  });
  return targetLists;
};
