import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import { GeistSans } from "geist/font/sans";

// Editorial display serif (headings) + clean grotesk (body). Distinct from the
// CRM's UI font — the client-facing proposal should read like a designed
// document, not an app screen.
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "900"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Proposal",
  robots: { index: false, follow: false },
};

export default function ProposalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className={`${fraunces.variable} ${GeistSans.variable}`}
      style={{ fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui" }}
    >
      {children}
    </div>
  );
}
