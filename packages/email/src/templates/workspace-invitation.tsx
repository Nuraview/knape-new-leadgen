import { Link, Section, Text } from "@react-email/components";
import React from "react";
import { getBrandName } from "./brand";
import { EmailShell, styles } from "./shell";

void React;

export type WorkspaceInvitationEmailProps = {
  workspaceName: string;
  inviterName: string;
  inviterEmail: string;
  invitationLink: string;
  to: string;
  copy: WorkspaceInvitationEmailCopy;
};

export type WorkspaceInvitationEmailCopy = {
  subject: string;
  preview: string;
  title: string;
  subtitle: string;
  cta: string;
  sameEmail: string;
  ignore: string;
  footer: string;
};

function interpolate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return values[key] ?? "";
  });
}

const WorkspaceInvitationEmail = ({
  workspaceName,
  inviterName,
  inviterEmail,
  invitationLink,
  to,
  copy,
}: WorkspaceInvitationEmailProps) => {
  // `brand` joins the interpolation values so localised copy can say
  // "invited you to join {{workspaceName}} on {{brand}}" without every locale
  // file hardcoding the vendor's name into a client's invitation.
  const values = {
    workspaceName,
    inviterName,
    inviterEmail,
    brand: getBrandName(),
  };

  return (
    <EmailShell
      preview={interpolate(copy.preview, values)}
      title={interpolate(copy.title, values)}
      subtitle={interpolate(copy.subtitle, values)}
    >
      <Section>
        <Link style={styles.button} href={`${invitationLink}?email=${to}`}>
          {interpolate(copy.cta, values)}
        </Link>
        <Text style={styles.paragraph}>{interpolate(copy.sameEmail, values)}</Text>
        <Text style={styles.muted}>{interpolate(copy.ignore, values)}</Text>
        <Section style={styles.divider} />
        {/*
          Interpolated too. These four were passed through raw, which was fine
          while the only placeholders were inviter/workspace — none of them
          appeared here. `{{brand}}` does appear in `footer`, and an
          un-interpolated one would ship the literal braces to the recipient.
        */}
        <Text style={styles.footer}>{interpolate(copy.footer, values)}</Text>
      </Section>
    </EmailShell>
  );
};

WorkspaceInvitationEmail.PreviewProps = {
  workspaceName: "Acme Inc",
  inviterName: "John Doe",
  inviterEmail: "john@acme.com",
  invitationLink: "https://nuraview.app/invite/abc123",
  to: "invitee@example.com",
  copy: {
    subject: "{{inviterName}} invited you to join {{workspaceName}} on {{brand}}",
    preview: "You're invited to {{workspaceName}} on {{brand}}",
    title: "Join {{workspaceName}}",
    subtitle:
      "{{inviterName}} ({{inviterEmail}}) invited you to collaborate in {{brand}}.",
    cta: "Accept invitation",
    sameEmail: "You can accept with the same email that received this message.",
    ignore: "If this wasn't expected, you can safely ignore this email.",
    footer: "{{brand}} workspace invitation",
  },
} as WorkspaceInvitationEmailProps;

export default WorkspaceInvitationEmail;
