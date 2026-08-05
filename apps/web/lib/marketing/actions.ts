'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { db } from '@/lib/db';
import {
  mktEmails as emails,
  mktFolders as folders,
  mktThreadFolders as threadFolders,
  mktThreads as threads,
  mktUsers as users,
} from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import { sendMarketingEmail } from '@/lib/marketing/email-provider';
import { resolveSendingAccountId } from '@/lib/marketing/sending-accounts';
import { verifyEmail as reacherVerify } from '@/lib/marketing/reacher';
import { injectTracking } from '@/lib/marketing/tracking';

const sendEmailSchema = z.object({
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
  recipientEmail: z.string().email('Invalid email address'),
});

// Resolve (or lazily create) the mkt_users row representing the signed-in CRM
// user, so each sent email is attributed to a real sender instead of a
// hardcoded id. Falls back to a system row when there's no session.
async function resolveSenderId(): Promise<number> {
  const session = await getSession();
  const email = session?.user?.email ?? 'crm@nuraview.com';
  const name = session?.user?.name ?? null;

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, email));
  if (existing) return existing.id;

  const parts = name ? name.trim().split(/\s+/) : [];
  const firstName = parts[0] ?? null;
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;

  const [created] = await db
    .insert(users)
    .values({ email, firstName, lastName })
    .returning();
  return created.id;
}

export async function sendEmailAction(_: any, formData: FormData) {
  let newThread;
  let rawFormData = {
    subject: formData.get('subject'),
    body: formData.get('body'),
    recipientEmail: formData.get('recipientEmail'),
  };

  try {
    let validatedFields = sendEmailSchema.parse({
      subject: formData.get('subject'),
      body: formData.get('body'),
      recipientEmail: formData.get('recipientEmail'),
    });

    let { subject, body, recipientEmail } = validatedFields;

    const senderId = await resolveSenderId();

    // Find or create recipient
    let [recipient] = await db
      .select()
      .from(users)
      .where(eq(users.email, recipientEmail));

    if (!recipient) {
      [recipient] = await db
        .insert(users)
        .values({ email: recipientEmail })
        .returning();
    }

    // Create thread in DB
    let result = await db
      .insert(threads)
      .values({
        subject,
        lastActivityDate: new Date(),
      })
      .returning();
    newThread = result[0];

    // Create email record FIRST (so we have the ID for tracking)
    const [emailRecord] = await db
      .insert(emails)
      .values({
        threadId: newThread.id,
        senderId,
        recipientId: recipient.id,
        subject,
        body,
        sentDate: new Date(),
        resendId: null,
        fromAccountId: resolveSendingAccountId(null),
        status: 'queued',
      })
      .returning();

    // Add to Sent folder
    let [sentFolder] = await db
      .select()
      .from(folders)
      .where(eq(folders.name, 'Sent'));

    await db.insert(threadFolders).values({
      threadId: newThread.id,
      folderId: sentFolder.id,
    });

    // Build HTML with tracking pixel injected.
    const htmlBody = body.replace(/\n/g, '<br>');
    const trackedHtml = injectTracking(htmlBody, emailRecord.id);

    // Hard gate: skip confirmed-dead mailboxes (would bounce).
    const verdict = await reacherVerify(recipientEmail);
    if (verdict.reachable === 'invalid') {
      await db.update(emails).set({ status: 'failed' }).where(eq(emails.id, emailRecord.id));
      return {
        error: 'Recipient mailbox does not exist (SMTP verification) — not sent.',
        previous: rawFormData,
      };
    }

    // Send via Mailu SMTP (creative-hive), tracked HTML.
    const sendResult = await sendMarketingEmail({
      to: recipientEmail,
      subject,
      html: trackedHtml,
      text: body,
    });
    if (sendResult.error)
      console.error(`[${sendResult.provider}] send error:`, sendResult.error);
    const emailStatus: 'sent' | 'failed' = sendResult.error ? 'failed' : 'sent';

    // Record provider + delivery. "delivered" = accepted by our mail server
    // (strongest signal SMTP gives); bounces (IMAP poller) subtract later.
    await db
      .update(emails)
      .set({
        resendId: sendResult.provider === 'resend' ? sendResult.messageId : null,
        provider: sendResult.provider,
        providerMessageId: sendResult.messageId,
        status: emailStatus,
        deliveredAt: sendResult.accepted ? new Date() : null,
      })
      .where(eq(emails.id, emailRecord.id));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0].message, previous: rawFormData };
    }
    return {
      error: 'Failed to send email. Please try again.',
      previous: rawFormData,
    };
  }

  revalidatePath('/', 'layout');
  redirect(`/marketing/f/sent/${newThread.id}`);
}

export async function moveThreadToDone(_: any, formData: FormData) {
  let threadId = formData.get('threadId');

  if (!threadId || typeof threadId !== 'string') {
    return { error: 'Invalid thread ID', success: false };
  }

  try {
    let doneFolder = await db.query.mktFolders.findFirst({
      where: eq(folders.name, 'Archive'),
    });

    if (!doneFolder) {
      return { error: 'Done folder not found', success: false };
    }

    let parsedThreadId = parseInt(threadId, 10);

    await db
      .delete(threadFolders)
      .where(eq(threadFolders.threadId, parsedThreadId));

    await db.insert(threadFolders).values({
      threadId: parsedThreadId,
      folderId: doneFolder.id,
    });

    revalidatePath('/marketing/f/[name]');
    revalidatePath('/marketing/f/[name]/[id]');
    return { success: true, error: null };
  } catch (error) {
    console.error('Failed to move thread to Done:', error);
    return { success: false, error: 'Failed to move thread to Done' };
  }
}

export async function moveThreadToTrash(_: any, formData: FormData) {
  let threadId = formData.get('threadId');

  if (!threadId || typeof threadId !== 'string') {
    return { error: 'Invalid thread ID', success: false };
  }

  try {
    let trashFolder = await db.query.mktFolders.findFirst({
      where: eq(folders.name, 'Trash'),
    });

    if (!trashFolder) {
      return { error: 'Trash folder not found', success: false };
    }

    let parsedThreadId = parseInt(threadId, 10);

    await db
      .delete(threadFolders)
      .where(eq(threadFolders.threadId, parsedThreadId));

    await db.insert(threadFolders).values({
      threadId: parsedThreadId,
      folderId: trashFolder.id,
    });

    revalidatePath('/marketing/f/[name]');
    revalidatePath('/marketing/f/[name]/[id]');
    return { success: true, error: null };
  } catch (error) {
    console.error('Failed to move thread to Trash:', error);
    return { success: false, error: 'Failed to move thread to Trash' };
  }
}
