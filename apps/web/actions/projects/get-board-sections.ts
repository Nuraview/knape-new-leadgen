import { orm } from "@/lib/db-compat";

export const getBoardSections = async (boadId: string) => {
  const data = await orm.sections.findMany({
    where: {
      board: boadId,
    },
  });

  return data;
};
