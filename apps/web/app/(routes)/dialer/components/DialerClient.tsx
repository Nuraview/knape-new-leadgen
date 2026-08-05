"use client";

// Client boundary: the Twilio Voice SDK is browser-only, so DialerShell is
// loaded with ssr:false (next/dynamic with ssr:false must live in a client
// component in Next 16).

import dynamic from "next/dynamic";
import { Suspense } from "react";

const DialerShell = dynamic(
  () => import("./DialerShell").then((m) => m.DialerShell),
  {
    ssr: false,
    loading: () => (
      <p className="text-sm text-muted-foreground">Loading dialer…</p>
    ),
  },
);

export function DialerClient() {
  return (
    <Suspense
      fallback={<p className="text-sm text-muted-foreground">Loading dialer…</p>}
    >
      <DialerShell />
    </Suspense>
  );
}
