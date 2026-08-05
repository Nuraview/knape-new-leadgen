import { Link, Section, Text } from "@react-email/components";
import React from "react";
import { getBrandName } from "./brand";
import { EmailShell, styles } from "./shell";

void React;

export type PasswordResetEmailProps = {
  resetLink: string;
  userName?: string;
};

// This template has no per-locale copy table, so it reads the brand directly
// rather than going through withBrand().
const PasswordResetEmail = ({
  resetLink,
  userName,
}: PasswordResetEmailProps) => (
  <EmailShell
    preview={`Reset your ${getBrandName()} password`}
    title="Reset your password"
    subtitle={
      userName
        ? `Hi ${userName}, use the button below to set a new password.`
        : "Use the button below to set a new password."
    }
  >
    <Section>
      <Link style={styles.button} href={resetLink}>
        Reset password
      </Link>
      <Text style={styles.paragraph}>This reset link expires in 1 hour.</Text>
      <Text style={styles.muted}>
        If you didn't request this, no changes will be made.
      </Text>
      <Section style={styles.divider} />
      <Text style={styles.footer}>{getBrandName()} security email</Text>
    </Section>
  </EmailShell>
);

PasswordResetEmail.PreviewProps = {
  resetLink: "https://nuraview.app/auth/reset-password?token=example",
  userName: "Jane",
} as PasswordResetEmailProps;

export default PasswordResetEmail;
