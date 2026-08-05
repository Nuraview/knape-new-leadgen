"use client";

// Floating call widget shown on every page except /dialer (which renders its
// own full UI). Pure consumer of the shared DialerProvider — it does NOT own a
// device; the provider does.

import { usePathname } from "next/navigation";

import { Card, CardContent } from "@/components/ui/card";

import { useDialer } from "./DialerProvider";
import { CallControls } from "./CallControls";
import { IncomingCallCard } from "./IncomingCallCard";

export function GlobalDialerRuntime() {
  const pathname = usePathname();
  const {
    state,
    statusText,
    incoming,
    isMuted,
    isOnHold,
    callStartedAt,
    connectedTo,
    hangUp,
    toggleMute,
    toggleHold,
    sendDigit,
    accept,
    reject,
  } = useDialer();

  // The /dialer page shows the full dialer UI itself.
  if (pathname === "/dialer") return null;
  if (state !== "incoming" && state !== "in-call" && state !== "dialing") {
    return null;
  }

  // Incoming renders its own full-screen overlay.
  if (state === "incoming" && incoming) {
    return (
      <IncomingCallCard
        from={incoming.from}
        contactName={incoming.contactName}
        contactRequirement={incoming.contactRequirement}
        onAccept={accept}
        onReject={reject}
      />
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(24rem,calc(100vw-2rem))]">
      <Card
        className={
          state === "dialing"
            ? "border-2 border-yellow-500 shadow-2xl shadow-yellow-500/20 animate-pulse"
            : "border-2 border-green-600 shadow-2xl shadow-green-600/20"
        }
      >
        <CardContent className="space-y-3 py-4">
          <p className="text-sm font-bold uppercase tracking-wide">
            {state === "dialing" ? "📞 Calling…" : "📞 On call"}
          </p>
          <p className="text-xs text-muted-foreground">{statusText}</p>
          <CallControls
            callStartedAt={callStartedAt}
            connectedTo={connectedTo}
            isMuted={isMuted}
            isOnHold={isOnHold}
            onToggleMute={toggleMute}
            onToggleHold={toggleHold}
            onHangUp={hangUp}
            onDigit={sendDigit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
