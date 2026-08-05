import { Link, Section, Text } from "@react-email/components";
import React from "react";
import { withBrand } from "./brand";
import { resolveEmailLocale } from "./resolve-locale";
import { EmailShell, styles } from "./shell";

void React;

export type NotificationEmailProps = {
  title: string;
  message: string;
  actionUrl?: string | null;
  actionLabel?: string;
  locale?: string | null;
};

const messages = {
  en: {
    preview: "You have a new {{brand}} notification",
    subtitle: "A notification matched your delivery preferences.",
    footer: "{{brand}} notification",
    actionLabel: "Open in {{brand}}",
  },
  de: {
    preview: "Du hast eine neue {{brand}}-Benachrichtigung",
    subtitle:
      "Eine Benachrichtigung entspricht deinen Zustellungs-Einstellungen.",
    footer: "{{brand}}-Benachrichtigung",
    actionLabel: "In {{brand}} oeffnen",
  },
} as const;

const NotificationEmail = ({
  title,
  message,
  actionUrl,
  actionLabel,
  locale,
}: NotificationEmailProps) => {
  const copy = withBrand(messages[resolveEmailLocale(locale)]);

  return (
    <EmailShell preview={copy.preview} title={title} subtitle={copy.subtitle}>
      <Section>
        <Text style={styles.paragraph}>{message}</Text>
        {actionUrl ? (
          <Link style={styles.button} href={actionUrl}>
            {actionLabel ?? copy.actionLabel}
          </Link>
        ) : null}
        <Section style={styles.divider} />
        <Text style={styles.footer}>{copy.footer}</Text>
      </Section>
    </EmailShell>
  );
};

NotificationEmail.PreviewProps = {
  title: "Task assigned to you",
  message: "You were assigned to Design account notifications.",
  actionUrl: "https://nuraview.app",
} as NotificationEmailProps;

export default NotificationEmail;
