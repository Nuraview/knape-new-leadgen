import Container from "@/app/(routes)/components/ui/Container";
import { orm } from "@/lib/db-compat";
import { ProposalSettingsForm } from "./components/settings-form";

export default async function ProposalSettingsPage() {
  const settings = await orm.proposal_Settings.findFirst();

  return (
    <Container
      title="Proposal Branding"
      description="Logo, brand color, company details and defaults for client-facing proposals."
    >
      <ProposalSettingsForm
        settings={settings ? JSON.parse(JSON.stringify(settings)) : null}
      />
    </Container>
  );
}
