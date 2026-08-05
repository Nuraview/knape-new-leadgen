"use client";

// Call Log tab — the complete call history: every inbound/outbound call,
// answered or not, with status + duration. Pulls from /api/dialer/calls.

import { useCallback, useEffect, useState } from "react";
import {
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Phone,
  RefreshCw,
} from "lucide-react";

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

const UNANSWERED = new Set(["no-answer", "busy", "canceled", "failed"]);

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

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "no-answer":
      return "No answer";
    case "in-progress":
      return "In progress";
    default:
      return status.charAt(0).toUpperCase() + status.slice(1);
  }
}

export function CallLogPanel({
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

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Call log</p>
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
            Loading call log…
          </p>
        ) : calls.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No calls yet.
          </p>
        ) : (
          <ScrollArea className="h-[26rem]">
            <div className="flex flex-col gap-1 pr-2">
              {calls.map((call) => {
                const outbound = isOutbound(call);
                const unanswered = UNANSWERED.has(call.status);
                const Icon = unanswered
                  ? outbound
                    ? PhoneOutgoing
                    : PhoneMissed
                  : outbound
                    ? PhoneOutgoing
                    : PhoneIncoming;
                const iconColor = unanswered
                  ? outbound
                    ? "text-amber-600"
                    : "text-red-600"
                  : "text-muted-foreground";
                const duration = formatDuration(call.duration);
                return (
                  <div
                    key={call.id}
                    className="flex items-center gap-2 rounded-md border px-3 py-2"
                  >
                    <Icon className={`size-4 shrink-0 ${iconColor}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {call.leadName || call.phoneNumber}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {call.leadName ? `${call.phoneNumber} · ` : ""}
                        {outbound ? "Outgoing" : "Incoming"} ·{" "}
                        {statusLabel(call.status)}
                        {duration ? ` · ${duration}` : ""} ·{" "}
                        {formatWhen(call.createdAt)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="bg-green-600 hover:bg-green-700"
                      onClick={() => onCall(call.phoneNumber, call.leadName)}
                      title="Call"
                    >
                      <Phone className="size-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
