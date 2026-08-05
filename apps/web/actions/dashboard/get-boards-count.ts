import { orm } from "@/lib/db-compat";

export const getBoardsCount = async () => {
  const data = await orm.boards.count();
  return data;
};
