/**
 * SMS / WhatsApp template picker — ported from the legacy dialer.
 *
 * Renders NOTHING when there are no templates for the channel, which is
 * legacy behaviour and the right call: an empty dropdown is worse than no
 * dropdown. Note the API field differs (`items`, not `templates`), so both are
 * accepted rather than assuming.
 */
import { useEffect, useState } from "react";
import { getApiUrl } from "@/fetchers/get-api-url";

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
    // getApiUrl, not a hard-coded /api — this bundle is served from more than
    // one host, and the new API answers { items }, not { templates }.
    fetch(getApiUrl(`dialer/templates?type=${channel}`), {
      credentials: "include",
    })
      .then((res) => (res.ok ? res.json() : { items: [] }))
      .then((data) => setTemplates(data.items ?? data.templates ?? []))
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
