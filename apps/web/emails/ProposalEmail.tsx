import {
  Body,
  Button,
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

interface ProposalEmailProps {
  title: string;
  clientName?: string | null;
  message?: string;
  url: string;
  /** True when the designed proposal PDF is attached to the email. */
  hasPdfAttachment?: boolean;
}

const baseUrl = process.env.NEXT_PUBLIC_APP_URL;

export const ProposalEmail = ({
  title,
  clientName,
  message,
  url,
  hasPdfAttachment,
}: ProposalEmailProps) => {
  const previewText = `Proposal: ${title}`;
  const greeting = clientName ? `Hi ${clientName},` : "Hi,";
  const body =
    message ??
    "We've prepared a proposal for you. Click below to review, and approve it online.";

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Tailwind>
        <Body className="bg-white my-auto mx-auto font-sans">
          <Container className="border border-solid border-slate-300 rounded-md my-[40px] mx-auto p-[24px] w-[465px]">
            <Heading className="text-black text-2xl font-semibold p-0 my-[20px] mx-0">
              {title}
            </Heading>
            <Text className="text-black text-sm leading-[24px]">{greeting}</Text>
            <Text className="text-black text-sm leading-[24px]">{body}</Text>
            <Section className="text-center my-[28px]">
              <Button
                href={url}
                className="bg-[#2563eb] rounded-md text-white text-sm font-medium px-6 py-3 no-underline"
              >
                View Proposal
              </Button>
            </Section>
            <Text className="text-slate-500 text-xs leading-[20px]">
              Or paste this link into your browser:
              <br />
              {url}
            </Text>
            {hasPdfAttachment && (
              <Text className="text-slate-500 text-xs leading-[20px]">
                A PDF copy of this proposal is attached for your records — to
                approve, sign or pay, please use the link above.
              </Text>
            )}
            <Hr className="border border-solid border-[#eaeaea] my-[26px] mx-0 w-full" />
            <Section>
              <Text className="text-slate-500 text-xs leading-[24px]">
                Sent from{" "}
                <strong>{process.env.NEXT_PUBLIC_APP_NAME ?? "NuraView"}</strong>
                {baseUrl ? ` (${baseUrl})` : ""}
              </Text>
            </Section>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
};

export default ProposalEmail;
