import { WhatsAppPanel } from "./WhatsAppPanel";
import Container from "../../components/ui/Container";

export default function WhatsAppAdminPage() {
  return (
    <Container
      title="WhatsApp"
      description="Pair your WhatsApp account so the CRM can send and receive messages from leads."
    >
      <WhatsAppPanel />
    </Container>
  );
}
