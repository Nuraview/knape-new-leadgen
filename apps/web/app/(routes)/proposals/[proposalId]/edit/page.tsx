import Container from "@/app/(routes)/components/ui/Container";
import { notFound, redirect } from "next/navigation";
import { orm } from "@/lib/db-compat";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getProposalById } from "../../data/get-proposals";
import { ProposalForm } from "../../components/proposal-form";
import { PortfolioManager } from "../components/portfolio-manager";

export default async function EditProposalPage({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}) {
  const { proposalId } = await params;
  const proposal: any = await getProposalById(proposalId);
  if (!proposal || proposal.deletedAt) notFound();
  // Editable until the client has decided — DRAFT/SENT/VIEWED can all be edited
  // (fix a typo after sending); only signed/paid/rejected/expired lock.
  if (["APPROVED", "REJECTED", "PAID", "EXPIRED"].includes(proposal.status)) {
    redirect(`/proposals/${proposalId}`);
  }

  const [products, taxRates, currencies] = await Promise.all([
    orm.crm_Products.findMany({
      select: { id: true, name: true },
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
    }),
    orm.invoice_TaxRates.findMany({
      where: { active: true },
      orderBy: { rate: "desc" },
    }),
    orm.currency.findMany({
      where: { isEnabled: true },
      orderBy: { code: "asc" },
    }),
  ]);

  const initialData = {
    id: proposal.id,
    title: proposal.title,
    accountId: proposal.accountId,
    currency: proposal.currency,
    clientName: proposal.clientName,
    clientCompany: proposal.clientCompany,
    clientEmail: proposal.clientEmail,
    clientAddress: proposal.clientAddress,
    projectName: proposal.projectName,
    expiresAt: proposal.expiresAt,
    theme: proposal.theme,
    videoUrl: proposal.videoUrl,
    scheduleCallUrl: proposal.scheduleCallUrl,
    transactionFee: proposal.transactionFee,
    publicNotes: proposal.publicNotes,
    internalNotes: proposal.internalNotes,
    sections: proposal.sections ?? [],
    lineItems: (proposal.lineItems ?? []).map((li: any) => ({
      productId: li.productId,
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      discountPercent: li.discountPercent,
      taxRateId: li.taxRateId,
      clientAdjustable: li.clientAdjustable,
      minQty: li.minQty,
      maxQty: li.maxQty,
      tiers: li.tiers,
    })),
  };

  return (
    <Container title={`Edit: ${proposal.title}`} description="Update this draft proposal.">
      <ProposalForm
        products={JSON.parse(JSON.stringify(products))}
        taxRates={JSON.parse(JSON.stringify(taxRates))}
        currencies={JSON.parse(JSON.stringify(currencies))}
        initialData={JSON.parse(JSON.stringify(initialData))}
      />

      <div className="mt-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Portfolio / Relevant Work</CardTitle>
          </CardHeader>
          <CardContent>
            <PortfolioManager
              proposalId={proposal.id}
              assets={JSON.parse(JSON.stringify(proposal.assets ?? []))}
              config={proposal.portfolioConfig ?? null}
            />
          </CardContent>
        </Card>
      </div>
    </Container>
  );
}
