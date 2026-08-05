'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { mktContacts as contacts } from '@/lib/db';

type ActionState = { error: string | null; success?: boolean; imported?: number; skipped?: number };

export async function addContactAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = formData.get('email') as string;
  const firstName = (formData.get('firstName') as string) || null;
  const lastName = (formData.get('lastName') as string) || null;
  const company = (formData.get('company') as string) || null;

  if (!email) return { error: 'Email is required' };

  try {
    await db.insert(contacts).values({ email, firstName, lastName, company });
    revalidatePath('/marketing/contacts');
    return { success: true, error: null };
  } catch (e: any) {
    if (e.message?.includes('unique') || e.message?.includes('duplicate')) {
      return { error: 'A contact with this email already exists' };
    }
    return { error: 'Failed to add contact' };
  }
}

export async function deleteContactAction(id: number) {
  await db.delete(contacts).where(eq(contacts.id, id));
  revalidatePath('/marketing/contacts');
}

export async function importContactsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const csv = formData.get('csv') as string;
  if (!csv?.trim()) return { error: 'No CSV data provided', imported: 0 };

  const lines = csv.trim().split('\n');
  if (lines.length < 2) return { error: 'CSV must have at least a header row and one data row', imported: 0 };

  const headerLine = lines[0].toLowerCase();
  const headers = headerLine.split(',').map((h) => h.trim().replace(/^"/, '').replace(/"$/, ''));
  const emailIdx = headers.findIndex((h) => h === 'email' || h === 'e-mail' || h === 'email_address');
  if (emailIdx === -1) return { error: 'CSV must have an "email" column', imported: 0 };

  const firstNameIdx = headers.findIndex((h) => h === 'first_name' || h === 'firstname' || h === 'first name');
  const lastNameIdx = headers.findIndex((h) => h === 'last_name' || h === 'lastname' || h === 'last name');
  const companyIdx = headers.findIndex((h) => h === 'company' || h === 'organization');

  let imported = 0;
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"/, '').replace(/"$/, ''));
    const email = cols[emailIdx]?.trim();
    if (!email || !email.includes('@')) { skipped++; continue; }

    try {
      await db.insert(contacts).values({
        email,
        firstName: firstNameIdx >= 0 ? cols[firstNameIdx] || null : null,
        lastName: lastNameIdx >= 0 ? cols[lastNameIdx] || null : null,
        company: companyIdx >= 0 ? cols[companyIdx] || null : null,
      });
      imported++;
    } catch {
      skipped++; // duplicate
    }
  }

  revalidatePath('/marketing/contacts');
  return { success: true, error: null, imported, skipped };
}
