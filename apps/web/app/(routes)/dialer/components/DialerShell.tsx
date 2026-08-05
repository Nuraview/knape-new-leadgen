"use client";

// The /dialer page UI (tabs: Dialer | Messages | Contacts). Pure consumer of
// the shared DialerProvider — device/presence/push/ringtone all live there.

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useDialer } from "./DialerProvider";
import { ContactsPanel } from "./ContactsPanel";
import { DialerPanel } from "./DialerPanel";
import { InstallBanner } from "./InstallBanner";
import { MessagesPanel, type OpenThreadRequest } from "./MessagesPanel";
import { MissedCallsPanel } from "./MissedCallsPanel";
import { CallLogPanel } from "./CallLogPanel";

export function DialerShell() {
  const searchParams = useSearchParams();
  const {
    state,
    statusText,
    incoming,
    isMuted,
    isOnHold,
    callStartedAt,
    connectedTo,
    start,
    connect,
    hangUp,
    toggleMute,
    toggleHold,
    sendDigit,
    accept,
    reject,
  } = useDialer();

  const [phoneNumber, setPhoneNumber] = useState("");
  const [activeTab, setActiveTab] = useState("dialer");
  const [selectedLead, setSelectedLead] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [openThreadRequest, setOpenThreadRequest] =
    useState<OpenThreadRequest | null>(null);

  // ?call=+1555…&leadId=… from lead click-to-call → prefill the number.
  const handledQueryRef = useRef(false);
  useEffect(() => {
    if (handledQueryRef.current) return;
    handledQueryRef.current = true;
    const call = searchParams.get("call");
    if (call) setPhoneNumber(call);
  }, [searchParams]);

  const handleCall = useCallback(() => {
    connect(phoneNumber, selectedLead?.name);
  }, [connect, phoneNumber, selectedLead]);

  return (
    <Tabs
      value={activeTab}
      onValueChange={setActiveTab}
      className="w-full max-w-2xl"
    >
      <TabsList>
        <TabsTrigger value="dialer">Dialer</TabsTrigger>
        <TabsTrigger value="messages">Messages</TabsTrigger>
        <TabsTrigger value="missed">Missed Calls</TabsTrigger>
        <TabsTrigger value="log">Call Log</TabsTrigger>
        <TabsTrigger value="contacts">Contacts</TabsTrigger>
      </TabsList>
      <InstallBanner />
      <TabsContent value="dialer">
        <DialerPanel
          state={state}
          statusText={statusText}
          incoming={incoming}
          isMuted={isMuted}
          isOnHold={isOnHold}
          callStartedAt={callStartedAt}
          connectedTo={connectedTo}
          phoneNumber={phoneNumber}
          setPhoneNumber={setPhoneNumber}
          selectedLeadName={selectedLead?.name ?? null}
          onSelectLead={(lead) => {
            setSelectedLead({ id: lead.id, name: lead.name });
            setPhoneNumber(lead.phone);
          }}
          onStart={start}
          onCall={handleCall}
          onHangUp={hangUp}
          onToggleMute={toggleMute}
          onToggleHold={toggleHold}
          onAcceptIncoming={accept}
          onRejectIncoming={reject}
          onDigit={sendDigit}
        />
      </TabsContent>
      <TabsContent value="messages">
        <MessagesPanel
          openRequest={openThreadRequest}
          onCall={(phone) => {
            setPhoneNumber(phone);
            setSelectedLead(null);
            setActiveTab("dialer");
          }}
        />
      </TabsContent>
      <TabsContent value="missed">
        <MissedCallsPanel
          onCall={(phone, name) => {
            setPhoneNumber(phone);
            setSelectedLead(name ? { id: "", name } : null);
            setActiveTab("dialer");
          }}
        />
      </TabsContent>
      <TabsContent value="log">
        <CallLogPanel
          onCall={(phone, name) => {
            setPhoneNumber(phone);
            setSelectedLead(name ? { id: "", name } : null);
            setActiveTab("dialer");
          }}
        />
      </TabsContent>
      <TabsContent value="contacts">
        <ContactsPanel
          onCall={(phone, name) => {
            setPhoneNumber(phone);
            setSelectedLead({ id: "", name });
            setActiveTab("dialer");
          }}
          onMessage={(phone, channel) => {
            setOpenThreadRequest((prev) => ({
              phone,
              channel,
              seq: (prev?.seq ?? 0) + 1,
            }));
            setActiveTab("messages");
          }}
        />
      </TabsContent>
    </Tabs>
  );
}
