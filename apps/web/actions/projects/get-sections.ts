import { orm } from "@/lib/db-compat";

export const getSections = async () => {
  const data = await orm.sections.findMany({});

  return data;
};
