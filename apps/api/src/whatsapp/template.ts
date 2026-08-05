// Templated message bodies for WhatsApp messages enqueued into
// whatsapp_outbox.
//
// The first line of every WhatsApp message is what shows up as the push
// notification preview on the recipient's phone — so we craft it as a
// directly actionable instruction.
//
// VK  → "Call <firstname> for <title>"  (call-to-action focus)
// Abdul Mateen → "🚨 Email - <firstname> for <title>" (email-action focus,
//                 shows email address + lead card URL, no Upwork link)

export type ReminderLead = {
  id: string;
  firstName: string | null;
  jobTitle: string | null;
  company: string | null;
  phone: string | null;
  email: string | null;
  lastContactedAt: string | null;
  reminderNote: string | null;
  upworkJobUrl: string | null;
};

// Returns true if the recipient name refers to Abdul Mateen (handles
// any reasonable spelling/casing stored in the DB).
function isAbdulMateen(recipient: string | null | undefined): boolean {
  if (!recipient) return false;
  const norm = recipient.toLowerCase().replace(/\s+/g, "");
  return norm.includes("mateen") || norm.includes("mazin");
}

export function buildReminderMessage(
  lead: ReminderLead,
  baseUrl: string,
  recipient?: string | null,
): string {
  const name =
    lead.firstName?.trim() || lead.company?.trim() || "this lead";
  const title = lead.jobTitle?.trim() || "untitled job";

  const baseNoSlash = baseUrl.replace(/\/+$/, "");
  const leadUrl = baseNoSlash ? `${baseNoSlash}/leads/${lead.id}` : null;
  const stopUrl = baseNoSlash
    ? `${baseNoSlash}/api/reminders/stop?leadId=${lead.id}`
    : null;

  const lines: string[] = [];

  if (isAbdulMateen(recipient)) {
    // ── Abdul Mateen format ──────────────────────────────────────────────
    // 🚨 Email - (First name for Job Title)
    //
    // (Email Address)
    //
    // 🔗 Lead card URL
    // 🔕 Stop link
    lines.push(`🚨 Email - ${name} for ${title}`);
    lines.push("");

    const emailAddr = lead.email?.trim();
    if (emailAddr) {
      lines.push(emailAddr);
      lines.push("");
    }

    if (leadUrl) lines.push(`🔗 ${leadUrl}`);
    if (stopUrl) lines.push(`🔕 Stop: ${stopUrl}`);
  } else {
    // ── VK (default) format ──────────────────────────────────────────────
    // Call <firstname> for <title>
    //
    // 📞 phone
    // https://upwork.com/...
    //
    // https://nv-crm.vercel.app/leads/<id>
    // 🔕 Stop: URL
    lines.push(`Call ${name} for ${title}`);
    lines.push("");

    if (lead.phone?.trim()) lines.push(`📞 ${lead.phone.trim()}`);
    if (lead.upworkJobUrl) lines.push(lead.upworkJobUrl);
    lines.push("");
    if (leadUrl) lines.push(leadUrl);
    if (stopUrl) lines.push(`🔕 Stop: ${stopUrl}`);
  }

  return lines.join("\n");
}
