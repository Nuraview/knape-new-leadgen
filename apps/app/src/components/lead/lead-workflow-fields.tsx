/**
 * The workflow half of the lead drawer: Status, Assigned To, Last contacted,
 * Reminder and Irrelevant.
 *
 * Ported from the legacy drawer (LeadDrawer.tsx, "Status + Assignee",
 * "Last contacted", "Reminder" and "Irrelevant" sections). The new panel only
 * had the four one-click actions — Star / Mark contacted / Remind tomorrow 9am
 * / Irrelevant — which cover the common case and nothing else:
 *
 *   - no way to set a status or an owner at all,
 *   - contacted was a toggle, so "I emailed them last Tuesday" could not be
 *     recorded,
 *   - reminders could only be tomorrow at 09:00, with no note and no way to
 *     choose WHO gets the WhatsApp,
 *   - marking a lead irrelevant threw away the reason, which is the training
 *     signal for auto-archiving future matches.
 *
 * Same fields, same semantics and the same save behaviour as crmx1.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getApiUrl } from "@/fetchers/get-api-url";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/cn";

type Meta = {
  statuses: { id: string; name: string | null }[];
  assignees: { id: string; name: string | null; email: string | null }[];
};

type Recipient = { name: string; phone: string };

export type WorkflowLead = {
  id: string;
  leadStatusId: string | null;
  assignedTo: string | null;
  lastContactedAt: string | null;
  reminderAt: string | null;
  reminderNote: string | null;
  reminderAccount: string | null;
  irrelevantAt: string | null;
  irrelevantReason: string | null;
};

/** ISO -> the value a datetime-local input wants, in LOCAL time. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

/** datetime-local value -> ISO, or null when the field is empty. */
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function formatDateTimeShort(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function formatDateOnly(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

export function LeadWorkflowFields({
  lead,
  onSaved,
}: {
  lead: WorkflowLead;
  onSaved?: () => void;
}) {
  const queryClient = useQueryClient();
  const leadId = lead.id;

  const [lastContactedAt, setLastContactedAt] = useState("");
  const [reminderAt, setReminderAt] = useState("");
  const [reminderNote, setReminderNote] = useState("");
  const [reminderAccount, setReminderAccount] = useState("");
  const [irrelevantReason, setIrrelevantReason] = useState("");

  // Re-seed whenever a different lead is opened or the row is refetched.
  useEffect(() => {
    setLastContactedAt(toLocalInput(lead.lastContactedAt));
    setReminderAt(toLocalInput(lead.reminderAt));
    setReminderNote(lead.reminderNote ?? "");
    setReminderAccount(lead.reminderAccount ?? "");
    setIrrelevantReason(lead.irrelevantReason ?? "");
  }, [
    lead.lastContactedAt,
    lead.reminderAt,
    lead.reminderNote,
    lead.reminderAccount,
    lead.irrelevantReason,
  ]);

  const { data: meta } = useQuery({
    queryKey: ["lead", "meta"],
    queryFn: async (): Promise<Meta> => {
      const r = await fetch(getApiUrl("lead/meta"), { credentials: "include" });
      if (!r.ok) throw new Error("Could not load statuses");
      return r.json();
    },
    staleTime: 5 * 60_000,
  });

  // Global, not per-lead: who the WhatsApp reminder can be sent to.
  const { data: recipients } = useQuery({
    queryKey: ["whatsapp", "recipients"],
    queryFn: async (): Promise<Recipient[]> => {
      const r = await fetch(getApiUrl("whatsapp/recipients"), {
        credentials: "include",
      });
      if (!r.ok) return [];
      const json = await r.json();
      return Array.isArray(json?.recipients) ? json.recipients : [];
    },
    staleTime: 5 * 60_000,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
    onSaved?.();
  };

  const patch = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const r = await fetch(getApiUrl(`lead/${leadId}`), {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: refresh,
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  const post = useMutation({
    mutationFn: async ({
      path,
      body,
    }: {
      path: string;
      body: Record<string, unknown>;
    }) => {
      const r = await fetch(getApiUrl(`lead/${leadId}/${path}`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: refresh,
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Could not save"),
  });

  const busy = patch.isPending || post.isPending;
  const isIrrelevant = Boolean(lead.irrelevantAt);

  return (
    <>
      {/* --- Status + Assignee --- */}
      <div className="mt-6 grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">Status</div>
          <select
            className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm"
            value={lead.leadStatusId ?? ""}
            disabled={busy}
            onChange={(e) =>
              patch.mutate(
                { leadStatusId: e.target.value || null },
                { onSuccess: () => toast.success("Status updated") },
              )
            }
          >
            <option value="">—</option>
            {meta?.statuses.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground">
            Assigned To
          </div>
          <select
            className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm"
            value={lead.assignedTo ?? ""}
            disabled={busy}
            onChange={(e) =>
              patch.mutate(
                { assignedTo: e.target.value || null },
                { onSuccess: () => toast.success("Assignee updated") },
              )
            }
          >
            <option value="">Unassigned</option>
            {meta?.assignees.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.email}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* --- Last contacted: date-only display, datetime input for entry --- */}
      <div className="mt-6 space-y-2 border-t border-border pt-4">
        <div className="text-xs font-medium text-muted-foreground">
          Last contacted
          {lead.lastContactedAt ? (
            <span className="ml-2 text-foreground">
              — {formatDateOnly(lead.lastContactedAt)}
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            type="datetime-local"
            className="w-auto flex-1"
            value={lastContactedAt}
            onChange={(e) => setLastContactedAt(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            disabled={busy}
            onClick={() => {
              const iso = new Date().toISOString();
              setLastContactedAt(toLocalInput(iso));
              patch.mutate(
                { lastContactedAt: iso },
                { onSuccess: () => toast.success("Marked contacted today") },
              );
            }}
          >
            Today
          </Button>
          <Button
            size="sm"
            className="h-9"
            disabled={busy}
            onClick={() =>
              patch.mutate(
                { lastContactedAt: fromLocalInput(lastContactedAt) },
                { onSuccess: () => toast.success("Last contacted saved") },
              )
            }
          >
            Save
          </Button>
        </div>
      </div>

      {/* --- Reminder: current reminder, plus note and recipient --- */}
      <div className="mt-6 space-y-2 border-t border-border pt-4">
        <div className="text-xs font-medium text-muted-foreground">
          Reminder
          {lead.reminderAt ? (
            <span className="ml-2 text-foreground">
              — {formatDateTimeShort(lead.reminderAt)}
            </span>
          ) : null}
        </div>
        <Input
          type="datetime-local"
          value={reminderAt}
          onChange={(e) => setReminderAt(e.target.value)}
        />

        {/* Only rendered when WHATSAPP_RECIPIENTS is configured. */}
        {recipients && recipients.length > 0 ? (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">
              Send reminder to
            </div>
            <select
              className="h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm"
              value={reminderAccount}
              disabled={busy}
              onChange={(e) => setReminderAccount(e.target.value)}
            >
              <option value="">— select recipient —</option>
              {recipients.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name} ({r.phone})
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <textarea
          placeholder="Reminder note (optional)"
          value={reminderNote}
          onChange={(e) => setReminderNote(e.target.value)}
          rows={3}
          className="w-full resize-y rounded-md border border-border bg-transparent p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={busy || !reminderAt}
            onClick={() =>
              post.mutate(
                {
                  path: "reminder",
                  body: {
                    at: fromLocalInput(reminderAt),
                    note: reminderNote || null,
                    account: reminderAccount || null,
                  },
                },
                { onSuccess: () => toast.success("Reminder saved") },
              )
            }
          >
            Save reminder
          </Button>
          {lead.reminderAt ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                post.mutate(
                  { path: "reminder", body: { at: null } },
                  {
                    onSuccess: () => {
                      setReminderAt("");
                      setReminderNote("");
                      toast.success("Reminder cleared");
                    },
                  },
                )
              }
            >
              Cancel reminder
            </Button>
          ) : null}
        </div>
      </div>

      {/* --- Irrelevant: archive control + reason capture ---
          The reason is the signal for auto-archiving future matches, so it is
          captured at the moment of judgement rather than reconstructed later.
          Restoring clears it and the row returns to the active pool. */}
      <div
        className={cn(
          "mt-6 space-y-2 rounded-md border p-3",
          isIrrelevant ? "border-rose-500/40 bg-rose-500/5" : "border-border",
        )}
      >
        <div className="text-xs font-medium text-muted-foreground">
          {isIrrelevant ? "Marked irrelevant" : "Irrelevant"}
          {lead.irrelevantAt ? (
            <span className="ml-2 text-foreground">
              — {formatDateOnly(lead.irrelevantAt)}
            </span>
          ) : null}
        </div>

        {isIrrelevant ? (
          <>
            {lead.irrelevantReason ? (
              <p className="text-sm">{lead.irrelevantReason}</p>
            ) : (
              <p className="text-sm italic text-muted-foreground">
                No reason recorded.
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                post.mutate(
                  { path: "irrelevant", body: { value: false } },
                  { onSuccess: () => toast.success("Lead restored") },
                )
              }
            >
              Restore lead
            </Button>
          </>
        ) : (
          <>
            <textarea
              placeholder="Why is this lead irrelevant? (fed back into filtering)"
              value={irrelevantReason}
              onChange={(e) => setIrrelevantReason(e.target.value)}
              rows={2}
              className="w-full resize-y rounded-md border border-border bg-transparent p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              size="sm"
              variant="outline"
              className="text-destructive-foreground"
              disabled={busy}
              onClick={() =>
                post.mutate(
                  {
                    path: "irrelevant",
                    body: { value: true, reason: irrelevantReason || null },
                  },
                  { onSuccess: () => toast.success("Marked irrelevant") },
                )
              }
            >
              Mark irrelevant
            </Button>
          </>
        )}
      </div>
    </>
  );
}

export default LeadWorkflowFields;
