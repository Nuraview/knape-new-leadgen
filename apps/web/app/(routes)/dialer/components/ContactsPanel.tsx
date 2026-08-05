"use client";

// Contacts tab — the dialer's own phone-book (dialer_contacts table),
// deliberately separate from CRM leads. Port of the standalone app's
// Contacts tab: list + add/edit modal + per-contact Call / SMS / WhatsApp.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MessageSquare,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

type Contact = {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  requirementTag: string | null;
  smsEnabled: boolean | null;
  whatsappEnabled: boolean | null;
};

type Draft = {
  id: number | null;
  name: string;
  phone: string;
  email: string;
  requirementTag: string;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
};

const EMPTY_DRAFT: Draft = {
  id: null,
  name: "",
  phone: "",
  email: "",
  requirementTag: "",
  smsEnabled: true,
  whatsappEnabled: false,
};

export function ContactsPanel({
  onCall,
  onMessage,
}: {
  onCall: (phone: string, name: string) => void;
  onMessage: (phone: string, channel: "sms" | "whatsapp") => void;
}) {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [filter, setFilter] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dialer/contacts");
      if (!res.ok) return;
      const data = await res.json();
      setContacts(data.contacts ?? []);
    } catch {
      setContacts((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!contacts) return [];
    const f = filter.trim().toLowerCase();
    if (!f) return contacts;
    return contacts.filter((c) =>
      [c.name, c.phone, c.email, c.requirementTag]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(f)),
    );
  }, [contacts, filter]);

  const save = async () => {
    if (!draft || saving) return;
    if (!draft.name.trim() || !draft.phone.trim()) {
      setError("Name and phone are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const isEdit = draft.id !== null;
      const res = await fetch(
        isEdit ? `/api/dialer/contacts/${draft.id}` : "/api/dialer/contacts",
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.name.trim(),
            phone: draft.phone.trim(),
            email: draft.email.trim() || null,
            requirementTag: draft.requirementTag.trim() || null,
            smsEnabled: draft.smsEnabled,
            whatsappEnabled: draft.whatsappEnabled,
          }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Save failed");
        return;
      }
      setDraft(null);
      await load();
    } finally {
      setSaving(false);
    }
  };

  const remove = async (contact: Contact) => {
    if (!window.confirm(`Delete contact "${contact.name}"?`)) return;
    await fetch(`/api/dialer/contacts/${contact.id}`, { method: "DELETE" });
    await load();
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search contacts…"
              className="pl-8"
            />
          </div>
          <Button type="button" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
            <Plus className="size-4 mr-1" />
            Add
          </Button>
        </div>

        {contacts === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Loading contacts…
          </p>
        ) : filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {filter ? "No contacts match." : "No contacts yet — add one."}
          </p>
        ) : (
          <ScrollArea className="h-[26rem]">
            <div className="flex flex-col gap-1 pr-2">
              {filtered.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-center gap-2 rounded-md border px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {contact.name}
                      {contact.requirementTag && (
                        <span className="ml-1 font-normal text-muted-foreground">
                          — {contact.requirementTag}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {contact.phone}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="bg-green-600 hover:bg-green-700"
                    onClick={() => onCall(contact.phone, contact.name)}
                    title="Call"
                  >
                    <Phone className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onMessage(contact.phone, "sms")}
                    title="SMS"
                  >
                    <MessageSquare className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-green-700"
                    onClick={() => onMessage(contact.phone, "whatsapp")}
                    title="WhatsApp"
                  >
                    WA
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDraft({
                        id: contact.id,
                        name: contact.name,
                        phone: contact.phone,
                        email: contact.email ?? "",
                        requirementTag: contact.requirementTag ?? "",
                        smsEnabled: contact.smsEnabled ?? true,
                        whatsappEnabled: contact.whatsappEnabled ?? false,
                      })
                    }
                    title="Edit"
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-red-600"
                    onClick={() => remove(contact)}
                    title="Delete"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>

      <Dialog
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDraft(null);
            setError(null);
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {draft?.id ? "Edit contact" : "Add contact"}
            </DialogTitle>
          </DialogHeader>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Name *</Label>
              <Input
                value={draft?.name ?? ""}
                onChange={(e) =>
                  setDraft((d) => d && { ...d, name: e.target.value })
                }
                placeholder="John Smith"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Phone *</Label>
              <Input
                value={draft?.phone ?? ""}
                onChange={(e) =>
                  setDraft((d) => d && { ...d, phone: e.target.value })
                }
                placeholder="+1 555 000 0000"
                inputMode="tel"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Email</Label>
              <Input
                value={draft?.email ?? ""}
                onChange={(e) =>
                  setDraft((d) => d && { ...d, email: e.target.value })
                }
                type="email"
                placeholder="name@company.com"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Requirement tag</Label>
              <Input
                value={draft?.requirementTag ?? ""}
                onChange={(e) =>
                  setDraft((d) => d && { ...d, requirementTag: e.target.value })
                }
                placeholder="e.g. Web design inquiry"
              />
            </div>
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draft?.smsEnabled ?? true}
                  onCheckedChange={(v) =>
                    setDraft((d) => d && { ...d, smsEnabled: v === true })
                  }
                />
                SMS
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={draft?.whatsappEnabled ?? false}
                  onCheckedChange={(v) =>
                    setDraft((d) => d && { ...d, whatsappEnabled: v === true })
                  }
                />
                WhatsApp
              </label>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
            <Button type="button" disabled={saving} onClick={save}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
