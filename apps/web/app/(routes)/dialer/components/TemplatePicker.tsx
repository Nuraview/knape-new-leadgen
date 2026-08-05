"use client";

import { useEffect, useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type MessageTemplate = {
  id: number;
  name: string;
  messageBody: string;
  messageType: "sms" | "whatsapp";
};

export function TemplatePicker({
  channel,
  onPick,
}: {
  channel: "sms" | "whatsapp";
  onPick: (template: MessageTemplate) => void;
}) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);

  useEffect(() => {
    fetch(`/api/dialer/templates?type=${channel}`)
      .then((res) => (res.ok ? res.json() : { templates: [] }))
      .then((data) => setTemplates(data.templates ?? []))
      .catch(() => setTemplates([]));
  }, [channel]);

  if (!templates.length) return null;

  return (
    <Select
      onValueChange={(value) => {
        const template = templates.find((t) => String(t.id) === value);
        if (template) onPick(template);
      }}
    >
      <SelectTrigger className="w-48">
        <SelectValue placeholder="Use template…" />
      </SelectTrigger>
      <SelectContent>
        {templates.map((t) => (
          <SelectItem key={t.id} value={String(t.id)}>
            {t.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
