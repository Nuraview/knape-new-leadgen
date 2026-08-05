"use client";

// Missed Calls tab — inbound calls that were never answered (no-answer / busy /
// canceled / failed). Pulls from the shared call history endpoint and filters
// client-side, then offers one-tap call-back.

import { useCallback, useEffect, useMemo, useState } from "react";
import { PhoneMissed, PhoneOutgoing, Phone, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";

type Call = {
  id: string;
  phoneNumber: string;
  status: string;
  direction: string;
  duration: number | null;
  createdAt: string;
  leadName: string | null;
};

const MISSED_STATUSES = new Set(["no-answer", "busy", "canceled", "failed"]);

// Missed = any call that didn't connect, inbound (missed by us) or outbound
// (dialed but the other end never picked up).
function isMissed(call: Call): boolean {
  return MISSED_STATUSES.has(call.status);
}

function isOutbound(call: Call): boolean {
  return call.direction.startsWith("outbound");
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function MissedCallsPanel({
  onCall,
}: {
  onCall: (phone: string, name: string | null) => void;
}) {
  const [calls, setCalls] = useState<Call[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dialer/twilio-calls");
      if (!res.ok) return;
      const data = await res.json();
      setCalls(data.calls ?? []);
    } catch {
      setCalls((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const missed = useMemo(
    () => (calls ? calls.filter(isMissed) : []),
    [calls],
  );

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Missed calls</p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setCalls(null);
              load();
            }}
            title="Refresh"
          >
            <RefreshCw className="size-4" />
          </Button>
        </div>

        {calls === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Loading missed calls…
          </p>
        ) : missed.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No missed calls.
          </p>
        ) : (
          <ScrollArea className="h-[26rem]">
            <div className="flex flex-col gap-1 pr-2">
              {missed.map((call) => (
                <div
                  key={call.id}
                  className="flex items-center gap-2 rounded-md border px-3 py-2"
                >
                  {isOutbound(call) ? (
                    <PhoneOutgoing
                      className="size-4 shrink-0 text-amber-600"
                      aria-label="Unanswered outgoing call"
                    />
                  ) : (
                    <PhoneMissed
                      className="size-4 shrink-0 text-red-600"
                      aria-label="Missed incoming call"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {call.leadName || call.phoneNumber}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {call.leadName ? `${call.phoneNumber} · ` : ""}
                      {formatWhen(call.createdAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => onCall(call.phoneNumber, call.leadName)}
                    title="Call back"
                  >
                    <Phone className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
