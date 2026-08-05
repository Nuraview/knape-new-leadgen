import { cache } from "react";
import { orm } from "@/lib/db-compat";

export const getProductCategories = cache(async () => {
  const categories = await orm.crm_ProductCategories.findMany({
    where: { isActive: true },
    orderBy: { order: "asc" },
  });
  return categories;
});
