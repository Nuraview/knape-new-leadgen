import { orm } from "@/lib/db-compat";

export const getDocumentsCount = async () => {
  const data = await orm.documents.count();
  return data;
};
