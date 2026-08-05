import { orm } from "@/lib/db-compat";

export async function getProposals() {
  return orm.crm_Proposals.findMany({
    where: { isTemplate: false, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      account: { select: { id: true, name: true } },
      contact: { select: { id: true, firstName: true, lastName: true } },
    },
  });
}

export async function getTemplates() {
  return orm.crm_Proposals.findMany({
    where: { isTemplate: true, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function getProposalById(id: string) {
  const proposal: any = await orm.crm_Proposals.findUnique({ where: { id } });
  if (!proposal) return null;

  // Fetch relations explicitly — the Drizzle/Prisma facade doesn't reliably
  // hydrate `include` for these tables, so we load children directly.
  const [lineItems, assets, activity] = await Promise.all([
    orm.crm_Proposal_LineItems.findMany({
      where: { proposalId: id },
      orderBy: { position: "asc" },
    }),
    orm.crm_Proposal_Assets.findMany({
      where: { proposalId: id },
      orderBy: { position: "asc" },
    }),
    orm.crm_Proposal_Activity.findMany({
      where: { proposalId: id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const [account, contact, linkedInvoice] = await Promise.all([
    proposal.accountId
      ? orm.crm_Accounts.findUnique({ where: { id: proposal.accountId } })
      : null,
    proposal.contactId
      ? orm.crm_Contacts.findUnique({ where: { id: proposal.contactId } })
      : null,
    proposal.linkedInvoiceId
      ? orm.invoices.findUnique({ where: { id: proposal.linkedInvoiceId } })
      : null,
  ]);

  return { ...proposal, lineItems, assets, activity, account, contact, linkedInvoice };
}
