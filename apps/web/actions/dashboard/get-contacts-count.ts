import { orm } from "@/lib/db-compat";

export const getContactCount = async () => {
  const data = await orm.crm_Contacts.count({ where: { deletedAt: null } });
  return data;
};
