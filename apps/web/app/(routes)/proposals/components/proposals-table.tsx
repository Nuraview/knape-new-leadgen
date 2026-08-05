"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "./status-badge";

interface ProposalRow {
  id: string;
  number: number | null;
  title: string;
  status: string;
  currency: string;
  grandTotal: string | number;
  clientCompany: string | null;
  clientName: string | null;
  createdAt: string;
  account?: { name: string | null } | null;
}

function formatMoney(amount: string | number, currency: string) {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(Number.isFinite(n) ? n : 0);
  } catch {
    return `${currency} ${n}`;
  }
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft", SENT: "Sent", VIEWED: "Viewed", APPROVED: "Approved",
  PAID: "Paid", REJECTED: "Rejected", EXPIRED: "Expired",
};

export function ProposalsTable({ proposals }: { proposals: ProposalRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<string>("ALL");

  if (!proposals.length) {
    return (
      <div className="rounded-md border p-10 text-center text-sm text-muted-foreground">
        No proposals yet.{" "}
        <Link href="/proposals/new" className="underline">
          Create your first one
        </Link>
        .
      </div>
    );
  }

  const counts = proposals.reduce<Record<string, number>>((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});
  // Always show the core pipeline (Draft → Sent → Viewed → Approved) even at 0,
  // so "Sent" and "Viewed" are always visible as distinct stages; show the
  // terminal statuses only when present.
  const CORE = ["DRAFT", "SENT", "VIEWED", "APPROVED"];
  const chips = [...CORE, ...["PAID", "REJECTED", "EXPIRED"].filter((s) => counts[s])];
  const shown = filter === "ALL" ? proposals : proposals.filter((p) => p.status === filter);

  const Chip = ({ value, label, count }: { value: string; label: string; count: number }) => (
    <button
      type="button"
      onClick={() => setFilter(value)}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
        filter === value
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:bg-muted"
      }`}
    >
      {label} ({count})
    </button>
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Chip value="ALL" label="All" count={proposals.length} />
        {chips.map((s) => (
          <Chip key={s} value={s} label={STATUS_LABEL[s]} count={counts[s] ?? 0} />
        ))}
      </div>
      <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Client</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.map((p) => (
            <TableRow
              key={p.id}
              className="cursor-pointer"
              onClick={() => router.push(`/proposals/${p.id}`)}
            >
              <TableCell className="font-mono text-xs">{p.number ?? "—"}</TableCell>
              <TableCell className="font-medium">{p.title}</TableCell>
              <TableCell>
                {p.clientCompany || p.account?.name || p.clientName || "—"}
              </TableCell>
              <TableCell className="text-right">
                {formatMoney(p.grandTotal, p.currency)}
              </TableCell>
              <TableCell>
                <StatusBadge status={p.status} />
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {new Date(p.createdAt).toLocaleDateString()}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}
