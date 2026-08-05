import { z } from "zod";

// We're keeping a simple non-relational schema here.
// IRL, you will have a schema for your data models.
// Drizzle returns timestamps as ISO strings (`mode: 'string'`), and the
// users table column is `created_on` in SQL but exposed as `createdOn` in
// the Drizzle type. `z.coerce.date()` accepts both string and Date inputs
// so the schema doesn't break if orm-compat ever switches modes.
export const adminUserSchema = z.object({
  id: z.string(),
  createdOn: z.coerce.date(),
  lastLoginAt: z.coerce.date().nullable().optional(),
  role: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  email: z.string(),
  userStatus: z.string(),
  userLanguage: z.string(),
});

export type AdminUser = z.infer<typeof adminUserSchema>;
