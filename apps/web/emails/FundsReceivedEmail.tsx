import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Tailwind,
  Text,
} from "@react-email/components";

interface FundsReceivedEmailProps {
  title: string;
  clientName?: string | null;
  amount: string;
}

export const FundsReceivedEmail = ({ title, clientName, amount }: FundsReceivedEmailProps) => (
  <Html>
    <Head />
    <Preview>Funds received — {title}</Preview>
    <Tailwind>
      <Body className="bg-white my-auto mx-auto font-sans">
        <Container className="border border-solid border-slate-300 rounded-md my-[40px] mx-auto p-[24px] w-[465px]">
          <Heading className="text-black text-2xl font-semibold my-[16px]">
            Funds received — thank you! 🎉
          </Heading>
          <Text className="text-black text-sm leading-[24px]">
            {clientName ? `Hi ${clientName},` : "Hi,"}
          </Text>
          <Text className="text-black text-sm leading-[24px]">
            We&apos;ve received your payment of <strong>{amount}</strong> for{" "}
            <strong>{title}</strong>. We&apos;re excited to get started — we&apos;ll be in touch
            shortly with next steps.
          </Text>
          <Hr className="border border-solid border-[#eaeaea] my-[26px] mx-0 w-full" />
          <Section>
            <Text className="text-slate-500 text-xs leading-[24px]">
              Sent from <strong>{process.env.NEXT_PUBLIC_APP_NAME ?? "NuraView"}</strong>
            </Text>
          </Section>
        </Container>
      </Body>
    </Tailwind>
  </Html>
);

export default FundsReceivedEmail;
