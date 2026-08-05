import { Toaster } from "sonner";

// The NuraView Marketer section. Auth + the CRM sidebar come from the parent
// (routes) layout; here we just give the email-client views full height and
// mount the sonner Toaster the Marketer UI uses for notifications.
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {children}
      <Toaster
        closeButton
        position="bottom-right"
        theme="light"
        style={{
          background: "var(--background)",
          border: "1px solid var(--border)",
          color: "var(--foreground)",
        }}
      />
    </div>
  );
}
