'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { mktTemplates as templates } from '@/lib/db';

function extractVariables(text: string): string[] {
  const regex = /\{\{(\w+)\}\}/g;
  return Array.from(new Set(Array.from(text.matchAll(regex), (m) => m[1])));
}

type ActionState = { error: string | null; success?: boolean };

export async function createTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const name = formData.get('name') as string;
  const subject = (formData.get('subject') as string) || null;
  const bodyHtml = (formData.get('bodyHtml') as string) || null;
  const bodyText = (formData.get('bodyText') as string) || null;

  if (!name) return { error: 'Name is required' };

  const allText = [subject, bodyHtml, bodyText].filter(Boolean).join(' ');
  const variables = extractVariables(allText);

  try {
    await db.insert(templates).values({
      name,
      subject,
      bodyHtml,
      bodyText,
      variables,
    });
    revalidatePath('/marketing/templates');
    return { success: true, error: null };
  } catch {
    return { error: 'Failed to create template' };
  }
}

export async function updateTemplateAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = parseInt(formData.get('id') as string);
  const name = formData.get('name') as string;
  const subject = (formData.get('subject') as string) || null;
  const bodyHtml = (formData.get('bodyHtml') as string) || null;
  const bodyText = (formData.get('bodyText') as string) || null;

  if (!name) return { error: 'Name is required' };

  const allText = [subject, bodyHtml, bodyText].filter(Boolean).join(' ');
  const variables = extractVariables(allText);

  try {
    await db.update(templates).set({
      name,
      subject,
      bodyHtml,
      bodyText,
      variables,
      updatedAt: new Date(),
    }).where(eq(templates.id, id));
    revalidatePath('/marketing/templates');
    return { success: true, error: null };
  } catch {
    return { error: 'Failed to update template' };
  }
}

export async function deleteTemplateAction(id: number) {
  await db.delete(templates).where(eq(templates.id, id));
  revalidatePath('/marketing/templates');
}
