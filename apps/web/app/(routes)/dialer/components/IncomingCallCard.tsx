"use client";

// Full-screen incoming-call overlay — impossible to miss. Dark blurred
// backdrop over the whole app, pulsing ring around the phone icon, big
// caller name, oversized accept/decline buttons.

import { Phone, PhoneOff } from "lucide-react";

export function IncomingCallCard({
  from,
  contactName,
  contactRequirement,
  onAccept,
  onReject,
}: {
  from: string;
  contactName: string;
  contactRequirement: string;
  onAccept: () => void;
  onReject: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm">
      <div className="mx-4 flex w-full max-w-md flex-col items-center gap-6 rounded-2xl border border-white/10 bg-zinc-900 px-8 py-10 shadow-2xl">
        {/* Pulsing phone icon */}
        <div className="relative flex size-24 items-center justify-center">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-green-500 opacity-30" />
          <span className="absolute inline-flex size-20 animate-pulse rounded-full bg-green-500/30" />
          <span className="relative flex size-16 items-center justify-center rounded-full bg-green-600">
            <Phone className="size-8 text-white" />
          </span>
        </div>

        <div className="text-center">
          <p className="text-sm font-medium uppercase tracking-widest text-green-400 animate-pulse">
            Incoming call
          </p>
          <p className="mt-2 text-3xl font-bold text-white">
            {contactName || from}
          </p>
          {contactRequirement && (
            <p className="mt-1 text-base text-zinc-300">{contactRequirement}</p>
          )}
          {contactName && (
            <p className="mt-1 font-mono text-lg text-zinc-400">{from}</p>
          )}
        </div>

        <div className="flex items-center gap-10">
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={onReject}
              className="flex size-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg transition-transform hover:scale-110 hover:bg-red-700"
              aria-label="Decline"
            >
              <PhoneOff className="size-7" />
            </button>
            <span className="text-xs text-zinc-400">Decline</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={onAccept}
              className="flex size-16 animate-bounce items-center justify-center rounded-full bg-green-600 text-white shadow-lg transition-transform hover:scale-110 hover:bg-green-700"
              aria-label="Accept"
            >
              <Phone className="size-7" />
            </button>
            <span className="text-xs text-zinc-400">Accept</span>
          </div>
        </div>

        <p className="text-xs text-zinc-500">
          Press{" "}
          <kbd className="rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-300">
            R
          </kbd>{" "}
          to answer ·{" "}
          <kbd className="rounded border border-zinc-600 bg-zinc-800 px-1.5 py-0.5 font-mono text-zinc-300">
            Esc
          </kbd>{" "}
          to decline
        </p>
      </div>
    </div>
  );
}
