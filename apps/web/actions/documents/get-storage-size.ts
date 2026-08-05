import { orm } from "@/lib/db-compat";

export const getStorageSize = async () => {
  const data = await orm.documents.findMany({});

  //TODO: fix this any
  const storageSize = data.reduce((acc: number, doc: any) => {
    return acc + doc?.size;
  }, 0);

  const storageSizeMB = storageSize / 1000000;

  return Math.round(storageSizeMB * 100) / 100;
};
