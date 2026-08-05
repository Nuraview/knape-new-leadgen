import { z } from "zod";
import { orm } from "@/lib/db-compat";
import { paginationSchema, paginationArgs, listResponse } from "../helpers";

export const crmEmailAccountTools = [
  {
    name: "crm_list_email_accounts",
    description: "List the authenticated user's connected email accounts",
    schema: z.object({ ...paginationSchema }),
    async handler(args: { limit: number; offset: number }, userId: string) {
      const where = { userId, isActive: true };
      const [data, total] = await Promise.all([
        orm.emailAccount.findMany({
          where,
          ...paginationArgs(args),
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            label: true,
            imapHost: true,
            imapPort: true,
            imapSsl: true,
            smtpHost: true,
            smtpPort: true,
            smtpSsl: true,
            username: true,
            isActive: true,
            sentFolderName: true,
            lastSyncedAt: true,
            createdAt: true,
            updatedAt: true,
            // passwordEncrypted intentionally excluded for security
          },
        }),
        orm.emailAccount.count({ where }),
      ]);
      return listResponse(data, total, args.offset);
    },
  },
];
