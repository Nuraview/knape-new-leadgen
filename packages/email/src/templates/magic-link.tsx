import { Link, Section, Text } from "@react-email/components";
import React from "react";
import { withBrand } from "./brand";
import { resolveEmailLocale } from "./resolve-locale";
import { EmailShell, styles } from "./shell";

void React;

export type MagicLinkEmailProps = {
  magicLink: string;
  locale?: string | null;
};

const messages = {
  en: {
    preview: "Sign in to {{brand}}",
    title: "Your secure sign-in link",
    subtitle: "Use this link to continue to your {{brand}} workspace.",
    cta: "Sign in to {{brand}}",
    expiry: "This link expires in 5 minutes for your security.",
    ignore: "If you didn't request this, you can ignore this email.",
    footer: "{{brand}} security email",
  },
  de: {
    preview: "Bei {{brand}} anmelden",
    title: "Dein sicherer Anmeldelink",
    subtitle:
      "Verwende diesen Link, um mit deinem {{brand}}-Workspace fortzufahren.",
    cta: "Bei {{brand}} anmelden",
    expiry: "Dieser Link laeuft aus Sicherheitsgruenden in 5 Minuten ab.",
    ignore:
      "Wenn du das nicht angefordert hast, kannst du diese E-Mail ignorieren.",
    footer: "{{brand}} Sicherheits-E-Mail",
  },
} as const;

const MagicLinkEmail = ({ magicLink, locale }: MagicLinkEmailProps) => {
  const copy = withBrand(messages[resolveEmailLocale(locale)]);

  return (
    <EmailShell
      preview={copy.preview}
      title={copy.title}
      subtitle={copy.subtitle}
    >
      <Section>
        <Link style={styles.button} href={magicLink}>
          {copy.cta}
        </Link>
        <Text style={styles.paragraph}>{copy.expiry}</Text>
        <Text style={styles.muted}>{copy.ignore}</Text>
        <Section style={styles.divider} />
        <Text style={styles.footer}>{copy.footer}</Text>
      </Section>
    </EmailShell>
  );
};

MagicLinkEmail.PreviewProps = {
  magicLink: "https://nuraview.app",
  locale: "en-US",
} as MagicLinkEmailProps;

export default MagicLinkEmail;
