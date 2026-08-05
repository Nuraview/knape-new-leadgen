"use client";

import { useEffect, useState } from "react";
import { Grid3x3, Mic, MicOff, Pause, PhoneOff, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Keypad } from "./Keypad";

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function CallControls({
  callStartedAt,
  connectedTo,
  isMuted,
  isOnHold,
  onToggleMute,
  onToggleHold,
  onHangUp,
  onDigit,
}: {
  callStartedAt: number | null;
  connectedTo: string | null;
  isMuted: boolean;
  isOnHold: boolean;
  onToggleMute: () => void;
  onToggleHold: () => void;
  onHangUp: () => void;
  /** When provided, shows a DTMF keypad toggle for IVR menus ("press 1 for…"). */
  onDigit?: (digit: string) => void;
}) {
  const [now, setNow] = useState(Date.now());
  const [showKeypad, setShowKeypad] = useState(false);

  useEffect(() => {
    if (!callStartedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [callStartedAt]);

  return (
    <div className="flex flex-col items-center gap-3">
      {connectedTo && (
        <div className="flex items-center gap-2">
          <span className="relative flex size-3">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-500 opacity-60" />
            <span className="relative inline-flex size-3 rounded-full bg-green-600" />
          </span>
          <p className="text-lg font-semibold">{connectedTo}</p>
        </div>
      )}
      {callStartedAt && (
        <p className="font-mono text-4xl font-bold tabular-nums text-green-600">
          {formatDuration(now - callStartedAt)}
        </p>
      )}
      {isOnHold && (
        <p className="text-sm font-medium text-yellow-600">Call on hold</p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant={isMuted ? "default" : "outline"}
          onClick={onToggleMute}
          disabled={isOnHold}
        >
          {isMuted ? (
            <MicOff className="size-4 mr-1" />
          ) : (
            <Mic className="size-4 mr-1" />
          )}
          {isMuted ? "Unmute" : "Mute"}
        </Button>
        <Button
          type="button"
          variant={isOnHold ? "default" : "outline"}
          onClick={onToggleHold}
        >
          {isOnHold ? (
            <Play className="size-4 mr-1" />
          ) : (
            <Pause className="size-4 mr-1" />
          )}
          {isOnHold ? "Resume" : "Hold"}
        </Button>
        <Button type="button" variant="destructive" onClick={onHangUp}>
          <PhoneOff className="size-4 mr-1" />
          Hang up
        </Button>
      </div>
      {onDigit && (
        <div className="flex w-full flex-col items-center gap-2">
          <Button
            type="button"
            variant={showKeypad ? "default" : "outline"}
            size="sm"
            onClick={() => setShowKeypad((v) => !v)}
          >
            <Grid3x3 className="size-4 mr-1" />
            {showKeypad ? "Hide keypad" : "Keypad"}
          </Button>
          {showKeypad && (
            <div className="w-full max-w-[15rem]">
              <Keypad onKey={onDigit} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
