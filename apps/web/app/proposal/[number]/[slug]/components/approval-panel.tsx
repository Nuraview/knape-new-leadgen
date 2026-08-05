"use client";

import { useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";

export interface PaymentInfo {
  amount: number;
  method: "stripe" | "paypal" | "bank";
  clientSecret: string | null;
  invoiceId: string | null;
  bank?: Record<string, string | null> | null;
  paypalConfigured?: boolean;
  fee?: number;
}

export function ApprovalPanel({
  token,
  brand,
  quantities,
  clientTimeline,
  method,
  redirectUrl,
  onApproved,
  onRejected,
}: {
  token: string;
  brand: string;
  quantities: Record<number, number>;
  clientTimeline: { value: number; unit: "days" | "hours" } | null;
  method: "stripe" | "paypal" | "bank";
  // After a successful sign, send the client here (e.g. leave a recommendation).
  redirectUrl?: string | null;
  onApproved: (payment: PaymentInfo | null) => void;
  onRejected: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<"DRAWN" | "TYPED">("DRAWN");
  const [typedName, setTypedName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [signed, setSigned] = useState(false);
  const sigRef = useRef<SignatureCanvas | null>(null);

  const submitApprove = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    let signatureData = "";
    if (mode === "DRAWN") {
      if (!sigRef.current || sigRef.current.isEmpty()) {
        setError("Please draw your signature.");
        return;
      }
      signatureData = sigRef.current.toDataURL("image/png");
    } else {
      if (!typedName.trim()) {
        setError("Please type your name to sign.");
        return;
      }
      signatureData = typedName.trim();
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/proposals/public/${token}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email: email || null,
          signatureType: mode,
          signatureData,
          paymentMethod: method,
          clientTimeline: clientTimeline ?? undefined,
          adjustedQuantities: Object.fromEntries(
            Object.entries(quantities).map(([k, v]) => [k, v]),
          ),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Approval failed");
      }
      const data = await res.json();
      // Success chime (this runs inside the click gesture, so autoplay is allowed).
      try {
        const audio = new Audio("/proposal-signed.wav");
        void audio.play().catch(() => {});
      } catch {
        /* ignore audio errors */
      }
      // Send the signed client onward (e.g. to leave a recommendation) — after
      // a beat so the chime is heard before navigation.
      if (redirectUrl) {
        setSigned(true);
        setTimeout(() => { window.location.href = redirectUrl; }, 1700);
        return;
      }
      onApproved(data.payment ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approval failed");
    } finally {
      setBusy(false);
    }
  };

  const submitReject = async () => {
    setBusy(true);
    try {
      await fetch(`/api/proposals/public/${token}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason || null }),
      });
      onRejected();
    } finally {
      setBusy(false);
    }
  };

  if (signed) {
    return (
      <div className="rounded-2xl border bg-white p-10 text-center ring-1 ring-stone-200/70">
        <div className="mb-3 text-4xl">🎉</div>
        <div className="text-xl font-semibold text-stone-800">Signed — thank you!</div>
        <p className="mt-1 text-sm text-stone-500">Taking you to leave a quick recommendation…</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-white p-6 ring-1 ring-stone-200/70">
      <style>{`@keyframes pv-wave{0%,100%{transform:rotate(0)}20%{transform:rotate(-18deg)}40%{transform:rotate(14deg)}60%{transform:rotate(-8deg)}80%{transform:rotate(6deg)}}`}</style>
      <h2 className="text-lg font-semibold text-stone-800 mb-4 flex items-center gap-2">
        <span style={{ display: "inline-block", animation: "pv-wave 2.2s ease-in-out infinite", transformOrigin: "70% 70%" }}>
          🤝
        </span>
        Approve &amp; Sign
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
        <input className="rounded-md border px-3 py-2 text-sm" placeholder="Your full name" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="rounded-md border px-3 py-2 text-sm" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>

      <div className="flex gap-2 mb-3 text-sm">
        <button type="button" onClick={() => setMode("DRAWN")} className={`px-3 py-1 rounded-md border ${mode === "DRAWN" ? "bg-stone-900 text-white" : "text-stone-600"}`}>Draw</button>
        <button type="button" onClick={() => setMode("TYPED")} className={`px-3 py-1 rounded-md border ${mode === "TYPED" ? "bg-stone-900 text-white" : "text-stone-600"}`}>Type</button>
      </div>

      {mode === "DRAWN" ? (
        <div className="mb-4">
          <div className="rounded-md border bg-stone-50">
            <SignatureCanvas ref={sigRef} penColor="#0f172a" canvasProps={{ className: "w-full h-40 rounded-md" }} />
          </div>
          <button type="button" className="mt-2 text-xs text-stone-500 underline" onClick={() => sigRef.current?.clear()}>Clear signature</button>
        </div>
      ) : (
        <input className="mb-4 w-full rounded-md border px-3 py-2 text-2xl font-[cursive]" placeholder="Type your name" value={typedName} onChange={(e) => setTypedName(e.target.value)} />
      )}

      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy} onClick={submitApprove} className="px-5 py-2.5 rounded-md text-white font-medium disabled:opacity-50" style={{ backgroundColor: brand }}>
          {busy ? "Submitting…" : "Approve & Sign"}
        </button>
        {!rejecting ? (
          <button type="button" disabled={busy} onClick={() => setRejecting(true)} className="px-4 py-2.5 rounded-md border text-stone-600">Decline</button>
        ) : (
          <div className="flex gap-2 items-center">
            <input className="rounded-md border px-3 py-2 text-sm" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button type="button" disabled={busy} onClick={submitReject} className="px-4 py-2.5 rounded-md border border-red-300 text-red-600">Confirm decline</button>
          </div>
        )}
      </div>
    </div>
  );
}
