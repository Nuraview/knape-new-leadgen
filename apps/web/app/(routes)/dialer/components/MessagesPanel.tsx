"use client";

// SMS/WhatsApp conversations — port of the standalone SMS tab. Messages are
// grouped client-side by phone number; a thread view shows history + composer.
// Unread counts are tracked via a per-phone last-seen timestamp in
// localStorage (the server has no read-state).

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, MessageSquare, Phone, Plus, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { TemplatePicker } from "./TemplatePicker";

type Message = {
  id: number;
  leadId: string | null;
  phoneNumber: string;
  messageBody: string;
  messageStatus: string;
  direction: "inbound" | "outbound";
  messageType: "sms" | "whatsapp";
  createdAt: string | null;
  leadName: string | null;
};

type Conversation = {
  phoneNumber: string;
  leadName: string | null;
  lastMessage: Message;
  count: number;
  unread: number;
};

const QUICK_REPLIES = [
  "Hi! Thanks for reaching out.",
  "I'll get back to you shortly.",
  "Thank you!",
  "Can you please call me?",
  "Sorry, I'm busy right now. I'll call you later.",
];

const LAST_SEEN_KEY = "dialer_msgs_last_seen";

function loadLastSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(LAST_SEEN_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function markSeen(phone: string) {
  const seen = loadLastSeen();
  seen[phone] = Date.now();
  try {
    localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(seen));
  } catch {
    // storage full/blocked — unread badges just won't persist
  }
}

export type OpenThreadRequest = {
  phone: string;
  channel: "sms" | "whatsapp";
  /** Monotonic stamp so repeat clicks on the same contact re-trigger. */
  seq: number;
};

export function MessagesPanel({
  onCall,
  openRequest,
}: {
  onCall?: (phone: string) => void;
  openRequest?: OpenThreadRequest | null;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [channel, setChannel] = useState<"sms" | "whatsapp">("sms");
  const [sending, setSending] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  // Bump to recompute unread counts after marking a thread seen.
  const [seenVersion, setSeenVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dialer/messages");
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages ?? []);
    } catch {
      // best-effort refresh
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  const conversations = useMemo<Conversation[]>(() => {
    void seenVersion;
    const lastSeen = typeof window === "undefined" ? {} : loadLastSeen();
    const byPhone = new Map<string, Conversation>();
    for (const message of messages) {
      const ts = message.createdAt ? new Date(message.createdAt).getTime() : 0;
      const isUnreadInbound =
        message.direction === "inbound" &&
        ts > (lastSeen[message.phoneNumber] ?? 0);
      const existing = byPhone.get(message.phoneNumber);
      if (!existing) {
        byPhone.set(message.phoneNumber, {
          phoneNumber: message.phoneNumber,
          leadName: message.leadName,
          lastMessage: message,
          count: 1,
          unread: isUnreadInbound ? 1 : 0,
        });
      } else {
        existing.count += 1;
        existing.leadName ||= message.leadName;
        if (isUnreadInbound) existing.unread += 1;
      }
    }
    return Array.from(byPhone.values());
  }, [messages, seenVersion]);

  const openThread = useCallback((phone: string) => {
    setActivePhone(phone);
    markSeen(phone);
    setSeenVersion((v) => v + 1);
  }, []);

  // External open (Contacts tab "SMS"/"WA" buttons).
  useEffect(() => {
    if (openRequest?.phone) {
      setChannel(openRequest.channel);
      openThread(openRequest.phone);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest?.seq]);

  const thread = useMemo(
    () =>
      activePhone
        ? messages
            .filter((m) => m.phoneNumber === activePhone)
            .slice()
            .reverse()
        : [],
    [messages, activePhone],
  );

  // New inbound while the thread is open counts as seen.
  useEffect(() => {
    if (activePhone) markSeen(activePhone);
  }, [activePhone, messages]);

  const send = async () => {
    if (!activePhone || !draft.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/dialer/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: activePhone,
          message: draft.trim(),
          channel,
        }),
      });
      if (res.ok) {
        setDraft("");
        await load();
      }
    } finally {
      setSending(false);
    }
  };

  const charCount = draft.length;
  const counterClass =
    charCount > 160
      ? "text-red-600"
      : charCount >= 140
        ? "text-orange-500"
        : "text-muted-foreground";

  if (!activePhone) {
    return (
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <p className="text-sm font-medium">Conversations</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setNewPhone("");
                setNewOpen(true);
              }}
            >
              <Plus className="size-4 mr-1" />
              New
            </Button>
          </div>
          {conversations.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No conversations yet.
            </p>
          ) : (
            <ScrollArea className="h-[28rem]">
              {conversations.map((conversation) => (
                <button
                  key={conversation.phoneNumber}
                  type="button"
                  className="flex w-full items-center gap-3 border-b px-4 py-3 text-left hover:bg-accent"
                  onClick={() => openThread(conversation.phoneNumber)}
                >
                  <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {conversation.leadName || conversation.phoneNumber}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {conversation.lastMessage.messageBody}
                    </p>
                  </div>
                  {conversation.unread > 0 && (
                    <Badge className="bg-red-600 text-white hover:bg-red-600">
                      {conversation.unread}
                    </Badge>
                  )}
                  <Badge variant="outline">{conversation.count}</Badge>
                </button>
              ))}
            </ScrollArea>
          )}
        </CardContent>

        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>New message</DialogTitle>
            </DialogHeader>
            <Input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="+1 555 000 0000"
              inputMode="tel"
              onKeyDown={(e) => {
                if (e.key === "Enter" && newPhone.trim()) {
                  setNewOpen(false);
                  openThread(newPhone.trim());
                }
              }}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!newPhone.trim()}
                onClick={() => {
                  setNewOpen(false);
                  openThread(newPhone.trim());
                }}
              >
                Start
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
    );
  }

  const threadName = thread.find((m) => m.leadName)?.leadName || activePhone;

  return (
    <Card>
      <CardContent className="flex h-[32rem] flex-col gap-3 p-4">
        <div className="flex items-center gap-2 border-b pb-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setActivePhone(null)}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex-1">
            <p className="text-sm font-medium">{threadName}</p>
            <p className="text-xs text-muted-foreground">{activePhone}</p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => onCall?.(activePhone)}
          >
            <Phone className="size-4 mr-1" />
            Call
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-2 pr-2">
            {thread.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No messages yet — say hi below.
              </p>
            )}
            {thread.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "max-w-[75%] rounded-lg px-3 py-2 text-sm",
                  message.direction === "outbound"
                    ? "self-end bg-primary text-primary-foreground"
                    : "self-start bg-muted",
                )}
              >
                <p className="whitespace-pre-wrap">{message.messageBody}</p>
                <p
                  className={cn(
                    "mt-1 text-[10px]",
                    message.direction === "outbound"
                      ? "text-primary-foreground/70"
                      : "text-muted-foreground",
                  )}
                >
                  {message.messageType === "whatsapp" ? "WhatsApp · " : ""}
                  {message.createdAt
                    ? new Date(message.createdAt).toLocaleString()
                    : ""}
                </p>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="flex flex-col gap-2 border-t pt-2">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REPLIES.map((reply) => (
              <button
                key={reply}
                type="button"
                className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => setDraft(reply)}
              >
                {reply}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={channel === "sms" ? "default" : "outline"}
              onClick={() => setChannel("sms")}
            >
              SMS
            </Button>
            <Button
              type="button"
              size="sm"
              variant={channel === "whatsapp" ? "default" : "outline"}
              onClick={() => setChannel("whatsapp")}
            >
              WhatsApp
            </Button>
            <TemplatePicker
              channel={channel}
              onPick={(template) => setDraft(template.messageBody)}
            />
            <span className={cn("ml-auto text-xs tabular-nums", counterClass)}>
              {charCount}/160
            </span>
          </div>
          <div className="flex gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={`Send ${channel === "whatsapp" ? "WhatsApp message" : "SMS"}… (Enter to send)`}
              rows={2}
              className="flex-1"
            />
            <Button
              type="button"
              disabled={!draft.trim() || sending}
              onClick={send}
            >
              <Send className="size-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
