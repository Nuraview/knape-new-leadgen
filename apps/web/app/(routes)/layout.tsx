import { getSession } from "@/lib/auth-server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";

// Skip build-time prerender for every authenticated route — we hit the DB on
// most pages and static generation either can't find a session or explodes on
// orm calls it can't satisfy without runtime env.
export const dynamic = "force-dynamic";

import Header from "./components/Header";
import Footer from "./components/Footer";
import { HealthAlertBanner } from "./components/HealthAlertBanner";
import { WhatsAppBridgeAlert } from "./components/WhatsAppBridgeAlert";

import { Metadata } from "next";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "./components/app-sidebar";
import { GlobalDialerRuntime } from "./dialer/components/GlobalDialerRuntime";
import { DialerProvider } from "./dialer/components/DialerProvider";
import { getTranslations } from "@/lib/i18n/server";
import { AvatarProvider } from "@/context/avatar-context";
import { CurrencyProvider } from "@/context/currency-context";
import { getEnabledCurrencies, getDefaultCurrency } from "@/lib/currency";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL! || "http://localhost:3000"
  ),
  title: "",
  description: "",
  openGraph: {
    images: [
      {
        url: "/images/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: [
      {
        url: "/images/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "",
      },
    ],
  },
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();

  //console.log(session, "session");

  if (!session) {
    return redirect("/sign-in");
  }

  const user = session?.user;

  if (user?.userStatus === "PENDING") {
    return redirect("/pending");
  }

  if (user?.userStatus === "INACTIVE") {
    return redirect("/inactive");
  }

  // Fetch localization dictionary
  const dict = await getTranslations("ModuleMenu");

  // Extract translations as plain object for client component
  const translations = {
    dashboard: dict("dashboard"),
    crm: {
      title: dict("crm.title"),
      accounts: dict("crm.accounts"),
      opportunities: dict("crm.opportunities"),
      contacts: dict("crm.contacts"),
      leads: dict("crm.leads"),
      contracts: dict("crm.contracts"),
      products: dict("crm.products"),
      targets: dict("crm.targets"),
      targetLists: dict("crm.targetLists"),
    },
    projects: dict("projects"),
    emails: dict("emails"),
    reports: dict("reports"),
    documents: dict("documents"),
    invoices: dict("invoices"),
    settings: dict("settings"),
  };

  const cookieStore = await cookies();
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  const enabledCurrencies = await getEnabledCurrencies();
  const defaultCurrency = await getDefaultCurrency();
  const cookieCurrency = cookieStore.get("display_currency")?.value;
  const displayCurrency = cookieCurrency && enabledCurrencies.some((c: { code: string }) => c.code === cookieCurrency)
    ? cookieCurrency
    : defaultCurrency;
  const currencyList = enabledCurrencies.map((c: { code: string; name: string; symbol: string }) => ({ code: c.code, name: c.name, symbol: c.symbol }));

  //console.log(typeof build, "build");
  return (
    <AvatarProvider initialAvatar={user?.image}>
    <CurrencyProvider initialCurrency={displayCurrency} currencies={currencyList}>
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar
        dict={translations}
        session={session}
      />
      <SidebarInset>
        {/* Persistent global pipeline-health alert — visible on every
            authenticated page, not just /leads, so critical issues can't
            be missed. Also fires toast + browser notifications on state
            transitions. */}
        <HealthAlertBanner />
        {/* Un-missable blocking alarm + live QR when the WhatsApp bridge link
            drops — reminders ride this bridge, so it can never fail silently. */}
        <WhatsAppBridgeAlert />
        <DialerProvider>
        <GlobalDialerRuntime />
        <Header
          id={session.user.id as string}
          lang={session.user.userLanguage as string}
        />
        {/*
          Task Group 3.3: Footer Relocation
          - Footer has been moved inside the scrollable content area
          - This allows the footer to scroll with the page content
          - Footer will appear at the bottom of the content, not fixed at viewport bottom
        */}
        <div className="flex flex-col flex-grow overflow-y-auto h-full w-full min-w-0">
          <div className="flex-grow py-5 w-full min-w-0">
            <div className="w-full px-4 min-w-0">
              {children}
            </div>
          </div>
          <Footer />
        </div>
        </DialerProvider>
      </SidebarInset>
    </SidebarProvider>
    </CurrencyProvider>
    </AvatarProvider>
  );
}
