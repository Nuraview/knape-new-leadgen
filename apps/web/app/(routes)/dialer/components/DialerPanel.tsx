"use client";

import { useState } from "react";
import { Phone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import type { DialerState, IncomingInfo } from "../hooks/useTwilioDevice";
import { CallControls } from "./CallControls";
import { IncomingCallCard } from "./IncomingCallCard";
import { Keypad } from "./Keypad";
import { LeadSearch } from "./LeadSearch";

const STATE_BADGE: Record<DialerState, string> = {
  idle: "bg-muted text-muted-foreground",
  initializing: "bg-yellow-100 text-yellow-800",
  ready: "bg-green-100 text-green-800",
  dialing: "bg-yellow-100 text-yellow-800",
  "in-call": "bg-green-100 text-green-800",
  incoming: "bg-blue-100 text-blue-800",
  error: "bg-red-100 text-red-800",
};

export function DialerPanel({
  state,
  statusText,
  incoming,
  isMuted,
  isOnHold,
  callStartedAt,
  connectedTo,
  phoneNumber,
  setPhoneNumber,
  selectedLeadName,
  onSelectLead,
  onStart,
  onCall,
  onHangUp,
  onToggleMute,
  onToggleHold,
  onAcceptIncoming,
  onRejectIncoming,
  onDigit,
}: {
  state: DialerState;
  statusText: string;
  incoming: IncomingInfo | null;
  isMuted: boolean;
  isOnHold: boolean;
  callStartedAt: number | null;
  connectedTo: string | null;
  phoneNumber: string;
  setPhoneNumber: (v: string) => void;
  selectedLeadName: string | null;
  onSelectLead: (lead: { id: string; name: string; phone: string }) => void;
  onStart: () => void;
  onCall: () => void;
  onHangUp: () => void;
  onToggleMute: () => void;
  onToggleHold: () => void;
  onAcceptIncoming: () => void;
  onRejectIncoming: () => void;
  onDigit: (digit: string) => void;
}) {
  const [showKeypadInCall, setShowKeypadInCall] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inCall = state === "in-call";

  return (
    <div className="flex flex-col gap-4 max-w-md">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-lg">Phone</CardTitle>
          <Badge className={STATE_BADGE[state]} variant="outline">
            {state}
          </Badge>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">{statusText}</p>

          {state === "initializing" ? (
            <Button type="button" size="lg" disabled>
              <Phone className="size-4 mr-2 animate-pulse" />
              Connecting…
            </Button>
          ) : state === "error" ? (
            <Button type="button" onClick={onStart} size="lg">
              <Phone className="size-4 mr-2" />
              Restart dialer
            </Button>
          ) : null}

          {incoming && state === "incoming" && (
            <IncomingCallCard
              from={incoming.from}
              contactName={incoming.contactName}
              contactRequirement={incoming.contactRequirement}
              onAccept={onAcceptIncoming}
              onReject={onRejectIncoming}
            />
          )}

          {inCall ? (
            <>
              <CallControls
                callStartedAt={callStartedAt}
                connectedTo={connectedTo}
                isMuted={isMuted}
                isOnHold={isOnHold}
                onToggleMute={onToggleMute}
                onToggleHold={onToggleHold}
                onHangUp={onHangUp}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowKeypadInCall((v) => !v)}
              >
                {showKeypadInCall ? "Hide keypad" : "Show keypad"}
              </Button>
              {showKeypadInCall && <Keypad onKey={onDigit} />}
            </>
          ) : state === "ready" || state === "dialing" ? (
            <>
              <LeadSearch onSelect={onSelectLead} />
              {selectedLeadName && (
                <p className="text-sm text-muted-foreground">
                  Calling lead: <span className="font-medium">{selectedLeadName}</span>
                </p>
              )}
              <Input
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+1 555 000 0000"
                inputMode="tel"
                className="text-lg"
              />
              <Keypad onKey={(k) => setPhoneNumber(phoneNumber + k)} />
              {state === "dialing" ? (
                <Button type="button" variant="destructive" onClick={onHangUp}>
                  Cancel
                </Button>
              ) : (
                <Button
                  type="button"
                  size="lg"
                  disabled={!phoneNumber.trim()}
                  onClick={() => setConfirmOpen(true)}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Phone className="size-4 mr-2" />
                  Call
                </Button>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* Confirm-before-dial, same as the standalone app — prevents
          accidental calls from a stray click. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm call</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-1 py-2">
            {selectedLeadName && (
              <p className="text-lg font-semibold">{selectedLeadName}</p>
            )}
            <p className="font-mono text-xl">{phoneNumber}</p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-green-600 hover:bg-green-700"
              onClick={() => {
                setConfirmOpen(false);
                onCall();
              }}
            >
              <Phone className="size-4 mr-2" />
              Call now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
