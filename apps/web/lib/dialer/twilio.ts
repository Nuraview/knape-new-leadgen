// Twilio SDK helpers — port of the standalone app's services/twilio.js.

import twilio from "twilio";

import {
  createSmsMessage,
  getCallBySid,
  getMessageTemplates,
  type LeadMatch,
} from "./db";

export const AccessToken = twilio.jwt.AccessToken;
export const VoiceGrant = twilio.jwt.AccessToken.VoiceGrant;
export const VoiceResponse = twilio.twiml.VoiceResponse;

export const terminalCallStatuses = new Set([
  "completed",
  "busy",
  "failed",
  "no-answer",
  "canceled",
]);

export const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

let _client: twilio.Twilio | null = null;
export function twilioClient(): twilio.Twilio {
  if (_client) return _client;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    throw new Error("TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not configured");
  }
  _client = twilio(sid, token);
  return _client;
}

export function twilioPhoneNumber(): string {
  const n = process.env.TWILIO_PHONE_NUMBER;
  if (!n) throw new Error("TWILIO_PHONE_NUMBER not configured");
  return n;
}

export async function isCallStillActive(callSid: string): Promise<boolean> {
  if (!callSid) return false;
  try {
    const call = await twilioClient().calls(callSid).fetch();
    const status = String(call?.status || "").toLowerCase();
    return !terminalCallStatuses.has(status);
  } catch (error) {
    console.error("Unable to fetch Twilio call status:", error);
    return false;
  }
}

export async function sendFollowUpSMS(
  lead: LeadMatch | null,
  phoneNumber: string,
  callSid: string,
): Promise<void> {
  try {
    const templates = await getMessageTemplates("sms");
    const template =
      templates.find((t) => t.name === "Missed Call Follow-up") || templates[0];
    if (!template) return;

    const message = await twilioClient().messages.create({
      body: template.messageBody,
      from: twilioPhoneNumber(),
      to: phoneNumber,
    });

    const call = await getCallBySid(callSid);
    await createSmsMessage({
      leadId: lead?.id ?? null,
      phoneNumber,
      messageSid: message.sid,
      messageBody: template.messageBody,
      messageStatus: "sent",
      direction: "outbound",
      messageType: "sms",
      callId: call?.id ?? null,
      templateId: template.id,
    });
  } catch (error) {
    console.error("Error sending follow-up SMS:", error);
  }
}

export async function sendWhatsAppMessage(
  lead: LeadMatch | null,
  phoneNumber: string,
  messageBody: string,
  templateId: number | null = null,
) {
  const message = await twilioClient().messages.create({
    body: messageBody,
    from: `whatsapp:${twilioPhoneNumber()}`,
    to: `whatsapp:${phoneNumber}`,
  });

  await createSmsMessage({
    leadId: lead?.id ?? null,
    phoneNumber,
    messageSid: message.sid,
    messageBody,
    messageStatus: "sent",
    direction: "outbound",
    messageType: "whatsapp",
    templateId,
  });

  return message;
}
