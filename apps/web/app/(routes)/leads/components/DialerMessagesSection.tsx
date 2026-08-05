"use client";

// Read-only SMS/WhatsApp history for one lead, shown inside the LeadDrawer.
// Sending happens in the dialer's Messages tab.

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type Message = {
  id: number;
  messageBody: string;
  direction: "inbound" | "outbound";
  messageType: "sms" | "whatsapp";
  createdAt: string | null;
};

export function DialerMessagesSection({ leadId }: { leadId: string }) {
  const [messages, setMessages] = useState<Message[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dialer/messages?leadId=${encodeURIComponent(leadId)}`)
      .then((res) => (res.ok ? res.json() : { messages: [] }))
      .then((data) => {
        if (!cancelled) setMessages(data.messages ?? []);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [leadId]);

  if (!messages?.length) return null;

  return (
    <div className="border-t pt-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          SMS / WhatsApp
        </span>
        <a
          href="/dialer"
          className="text-xs underline text-muted-foreground hover:text-foreground"
        >
          Open in dialer →
        </a>
      </div>
      <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
        {messages
          .slice()
          .reverse()
          .map((message) => (
            <div
              key={message.id}
              className={cn(
                "max-w-[80%] rounded-md px-2 py-1 text-xs",
                message.direction === "outbound"
                  ? "self-end bg-primary/10"
                  : "self-start bg-muted",
              )}
            >
              <p className="whitespace-pre-wrap">{message.messageBody}</p>
              <p className="text-[10px] text-muted-foreground">
                {message.messageType === "whatsapp" ? "WhatsApp · " : ""}
                {message.createdAt
                  ? new Date(message.createdAt).toLocaleString()
                  : ""}
              </p>
            </div>
          ))}
      </div>
    </div>
  );
}
