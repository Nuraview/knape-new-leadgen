"use server";
import { orm } from "@/lib/db-compat";

export const getTargetList = async (id: string) => {
  const targetList = await orm.crm_TargetLists.findUnique({
    where: { id },
    include: {
      crate_by_user: { select: { name: true } },
      targets: { include: { target: true } },
    },
  });
  return targetList;
};
