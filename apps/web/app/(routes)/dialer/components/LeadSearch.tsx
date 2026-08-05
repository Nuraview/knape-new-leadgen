"use client";

// Lead picker: search leads by name/company, select to fill the dial input.

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";

type LeadHit = {
  id: string;
  firstName: string | null;
  lastName: string;
  company: string | null;
  phone: string | null;
};

export function LeadSearch({
  onSelect,
}: {
  onSelect: (lead: { id: string; name: string; phone: string }) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<LeadHit[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setHits([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/dialer/leads-search?q=${encodeURIComponent(query.trim())}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        setHits((data.leads ?? []) as LeadHit[]);
        setOpen(true);
      } catch {
        // search is best-effort
      }
    }, 300);
  }, [query]);

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search leads with a phone number…"
          className="pl-8"
        />
      </div>
      {open && hits.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-md">
          {hits.map((lead) => {
            const name =
              [lead.firstName, lead.lastName].filter(Boolean).join(" ") ||
              lead.company ||
              lead.phone;
            return (
              <button
                key={lead.id}
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={() => {
                  onSelect({
                    id: lead.id,
                    name: name ?? "",
                    phone: lead.phone ?? "",
                  });
                  setQuery("");
                  setOpen(false);
                }}
              >
                <span className="truncate">{name}</span>
                <span className="ml-2 shrink-0 text-muted-foreground">
                  {lead.phone}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
