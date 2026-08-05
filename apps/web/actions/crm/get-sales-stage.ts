import { orm } from "@/lib/db-compat";

export const getSaleStages = async () => {
  const data = await orm.crm_Opportunities_Sales_Stages.findMany({
    orderBy: {
      probability: "asc",
    },
  });
  return data;
};
