import { Suspense } from "react";
import Container from "@/app/(routes)/components/ui/Container";
import { orm } from "@/lib/db-compat";
import { ProposalForm, type PresetSeed } from "../components/proposal-form";
import { DesignGallery } from "../components/design-gallery";
import { getPreset } from "@/lib/proposals/design-presets";

export default async function NewProposalPage({
  searchParams,
}: {
  searchParams: Promise<{
    preset?: string;
    clientName?: string;
    clientCompany?: string;
    clientEmail?: string;
  }>;
}) {
  const {
    preset: presetId,
    clientName,
    clientCompany,
    clientEmail,
  } = await searchParams;

  // Pre-fill from a contact (Contacts tab → "Generate proposal"). Only the
  // fields a proposal actually has — name / company / email (no phone field).
  const clientSeed =
    clientName || clientCompany || clientEmail
      ? { clientName, clientCompany, clientEmail }
      : undefined;

  // No preset chosen yet → show the design gallery picker.
  if (!presetId) {
    return (
      <Container title="New Proposal" description="Pick a design to start from.">
        <Suspense fallback={null}>
          <DesignGallery />
        </Suspense>
      </Container>
    );
  }

  const [products, taxRates, currencies, settings] = await Promise.all([
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
    orm.proposal_Settings.findFirst(),
  ]);

  // Build a serializable seed from the chosen preset (functions stripped).
  const preset = getPreset(presetId);
  const seed: PresetSeed | undefined = preset
    ? {
        id: preset.id,
        theme: preset.theme,
        brandColor: preset.brandColor,
        designTokens: preset.designTokens,
        sections: preset.buildSections(),
        lineItems: preset.sampleLineItems ?? [],
      }
    : undefined;

  return (
    <Container title="New Proposal" description="Draft a new client proposal.">
      <ProposalForm
        products={JSON.parse(JSON.stringify(products))}
        taxRates={JSON.parse(JSON.stringify(taxRates))}
        currencies={JSON.parse(JSON.stringify(currencies))}
        defaultCurrency={settings?.baseCurrency ?? "USD"}
        preset={seed}
        clientSeed={clientSeed}
      />
    </Container>
  );
}
