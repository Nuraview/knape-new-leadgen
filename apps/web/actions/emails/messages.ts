"use server";
import { getSession } from "@/lib/auth-server";

import { orm } from "@/lib/db-compat";
import { decrypt } from "@/lib/email-crypto";
import nodemailer from "nodemailer";
import { EmailFolder } from "@/lib/db-types";

const PAGE_SIZE = 50;
const MAX_COUNT = 10_000;

async function requireSession() {
  const session = await getSession();
  if (!session?.user?.id) throw new Error("Unauthorized");
  return session.user.id as string;
}

export async function getEmails(
  accountId: string,
  folder: EmailFolder,
  page: number,
  search?: string
) {
  const userId = await requireSession();

  const baseWhere = {
    userId,
    emailAccountId: accountId,
    folder,
    isDeleted: false,
  } as const;

  // Build where clause with optional text search fallback
  const where =
    search && search.length >= 3
      ? {
          ...baseWhere,
          OR: [
            { subject: { contains: search, mode: "insensitive" as const } },
            { fromEmail: { contains: search, mode: "insensitive" as const } },
            { fromName: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : baseWhere;

  const [emails, rawCount] = await Promise.all([
    orm.email.findMany({
      where,
      orderBy: { sentAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        subject: true,
        fromName: true,
        fromEmail: true,
        sentAt: true,
        isRead: true,
        folder: true,
      },
    }),
    orm.email.count({ where }),
  ]);

  const total = Math.min(rawCount, MAX_COUNT);
  return { emails, total, page, totalPages: Math.ceil(total / PAGE_SIZE) };
}

export async function getEmail(id: string) {
  const userId = await requireSession();
  const email = await orm.email.findFirst({
    where: { id, userId, isDeleted: false },
    include: {
      contacts: { include: { contact: { select: { id: true, first_name: true, last_name: true } } } },
      accounts: { include: { account: { select: { id: true, name: true } } } },
    },
  });
  if (!email) throw new Error("Not found");

  // Lazy body fetch for emails not yet CRM-linked at sync time
  if (!email.bodyText && !email.bodyHtml && email.imapUid) {
    try {
      const account = await orm.emailAccount.findUnique({
        where: { id: email.emailAccountId },
        select: {
          username: true,
          passwordEncrypted: true,
          imapHost: true,
          imapPort: true,
          imapSsl: true,
          sentFolderName: true,
        },
      });

      if (account) {
        const { fetchBodyByUid } = await import("@/inngest/lib/imap-utils");
        const folderName = email.folder === "SENT" ? (account.sentFolderName || "Sent") : "INBOX";
        const body = await fetchBodyByUid(
          {
            username: account.username,
            password: decrypt(account.passwordEncrypted),
            imapHost: account.imapHost,
            imapPort: account.imapPort,
            imapSsl: account.imapSsl,
          },
          folderName,
          email.imapUid
        );

        if (body.bodyText || body.bodyHtml) {
          await orm.email.update({
            where: { id },
            data: { bodyText: body.bodyText ?? null, bodyHtml: body.bodyHtml ?? null },
          });
          // Patch in-memory so caller gets the body immediately (before any send that may throw)
          email.bodyText = body.bodyText ?? null;
          email.bodyHtml = body.bodyHtml ?? null;
          // Trigger embed only if already CRM-linked (avoids embedding unrelated emails)
          const isLinked = email.contacts.length > 0 || email.accounts.length > 0;
          if (isLinked) {
            const { inngest } = await import("@/inngest/client");
            inngest.send({ name: "email/embed-email", data: { emailId: id } });
          }
        }
      }
    } catch {
      // Body fetch failed — return email without body; display will show a fallback
    }
  }

  // Mark as read (fire-and-forget)
  if (!email.isRead) {
    orm.email.update({ where: { id }, data: { isRead: true } }).catch(() => {});
  }

  return email;
}

export async function deleteEmail(id: string) {
  const userId = await requireSession();
  const email = await orm.email.findFirst({ where: { id, userId, isDeleted: false } });
  if (!email) throw new Error("Not found");
  await orm.email.update({ where: { id }, data: { isDeleted: true } });
}

type SendInput = {
  accountId: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  videoLink?: string;   // Cap share URL → embedded as GIF thumbnail card
  inReplyTo?: string;   // parent's Message-ID
  references?: string;  // parent's References + parent's Message-ID (space-separated)
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function sendEmail(input: SendInput) {
  const userId = await requireSession();

  const account = await orm.emailAccount.findFirst({
    where: { id: input.accountId, userId },
  });
  if (!account) throw new Error("Account not found");

  const password = decrypt(account.passwordEncrypted);

  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpSsl,
    auth: { user: account.username, pass: password },
  });

  // Video attached → upgrade to multipart (text + html) with a clickable GIF
  // thumbnail card. Plain sends stay text/plain-only exactly as before.
  let messageBody = input.body;
  let videoLink = input.videoLink?.trim();
  const {
    resolveCapEmbed,
    renderVideoCardHtml,
    renderVideoCardText,
    renderVideoLinkFallbackHtml,
    rescueCapEmbedFromBody,
  } = await import("@/lib/videos/cap-embed");
  // Users paste Cap's iframe embed code straight into the message — it can
  // never render in email, so strip it and treat it as the attached video.
  const rescued = rescueCapEmbedFromBody(messageBody);
  if (rescued) {
    messageBody = rescued.cleaned;
    videoLink = videoLink || rescued.shareUrl;
  }
  let textBody = messageBody;
  let htmlBody: string | undefined;
  if (videoLink) {
    let cardHtml: string;
    let cardText: string;
    try {
      const embed = await resolveCapEmbed(videoLink);
      cardHtml = renderVideoCardHtml(embed);
      cardText = renderVideoCardText(embed);
    } catch {
      // Resolution failing (Cap down, non-Cap URL) must never block the send.
      cardHtml = renderVideoLinkFallbackHtml(videoLink);
      cardText = `▶ Watch my video: ${videoLink}`;
    }
    textBody = `${messageBody}\n\n${cardText}`;
    htmlBody = `<div style="font-family:sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(messageBody)}</div>${cardHtml}`;
  }

  const info = await transporter.sendMail({
    from: account.username,
    to: input.to.join(", "),
    cc: input.cc?.join(", "),
    bcc: input.bcc?.join(", "),
    subject: input.subject,
    text: textBody,
    ...(htmlBody ? { html: htmlBody } : {}),
    inReplyTo: input.inReplyTo,
    references: input.references,
  });

  // Write sent message to DB immediately so it appears in Sent view
  await orm.email.create({
    data: {
      emailAccountId: input.accountId,
      userId,
      rfcMessageId: info.messageId ?? `local-${crypto.randomUUID()}@nextcrm`,
      folder: EmailFolder.SENT,
      subject: input.subject,
      fromEmail: account.username,
      toRecipients: input.to.map((e) => ({ email: e })),
      ccRecipients: input.cc?.map((e) => ({ email: e })) ?? [],
      bccRecipients: input.bcc?.map((e) => ({ email: e })) ?? [],
      bodyText: textBody,
      ...(htmlBody ? { bodyHtml: htmlBody } : {}),
      sentAt: new Date(),
      isRead: true,
    },
  });
}
