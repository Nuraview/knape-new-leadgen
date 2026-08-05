import type { Metadata } from "next";

import { DialerClient } from "./components/DialerClient";

export const metadata: Metadata = {
  title: "Dialer | NuraviewCRM",
};

export default function DialerPage() {
  return (
    <div className="px-6 py-6 w-full max-w-none">
      <h1 className="text-2xl font-semibold mb-4">Dialer</h1>
      <DialerClient />
    </div>
  );
}
