import { orm } from "@/lib/db-compat";

export const getEmployees = async () => {
  const data = await orm.employees.findMany({});
  return data;
};
