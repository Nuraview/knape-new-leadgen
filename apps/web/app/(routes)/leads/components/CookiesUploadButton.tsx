"use client";

import { useRef, useState } from "react";
import useSWR from "swr";

import { Button } from "@/components/ui/button";

const fetcher = (url: string) =>
  fetch(url, { credentials: "include" }).then((r) => r.json());

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function CookiesUploadButton() {
  const { data, mutate } = useSWR<{
    uploaded_at: string | null;
    count: number;
  }>("/api/scraper/cookies", fetcher, { refreshInterval: 60_000 });

  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "uploading" }
    | { kind: "ok"; count: number }
    | { kind: "err"; msg: string }
  >({ kind: "idle" });

  async function handleFile(file: File) {
    setStatus({ kind: "uploading" });
    try {
      const text = await file.text();
      // Validate JSON client-side for a friendlier error.
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("File is not valid JSON");
      }
      const res = await fetch("/api/scraper/cookies", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      setStatus({ kind: "ok", count: body.count });
      mutate();
      setTimeout(() => setStatus({ kind: "idle" }), 4000);
    } catch (e: any) {
      setStatus({ kind: "err", msg: e?.message ?? "upload failed" });
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="text-xs text-muted-foreground">
        Cookies uploaded: <strong>{relTime(data?.uploaded_at ?? null)}</strong>
        {data?.count ? ` · ${data.count} entries` : ""}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
      <Button
        size="sm"
        variant="outline"
        onClick={() => fileRef.current?.click()}
        disabled={status.kind === "uploading"}
      >
        {status.kind === "uploading"
          ? "Uploading…"
          : status.kind === "ok"
            ? `✓ ${status.count} cookies saved`
            : "Update cookies"}
      </Button>
      {status.kind === "err" ? (
        <span className="text-xs text-red-600 dark:text-red-400">
          {status.msg}
        </span>
      ) : null}
    </div>
  );
}
