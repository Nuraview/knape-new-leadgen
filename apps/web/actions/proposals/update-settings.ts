"use server";

import { orm } from "@/lib/db-compat";
import { getUser } from "@/actions/get-user";
import { revalidatePath } from "next/cache";

export interface ProposalSettingsInput {
  baseCurrency: string;
  defaultExpiryDays: number;
  brandColor?: string | null;
  fontFamily?: string | null;
  companyName?: string | null;
  companyEmail?: string | null;
  companyWebsite?: string | null;
  footerText?: string | null;
  defaultTermsHtml?: string | null;
  logoStorageKey?: string | null;
  clientAvatars?: string[] | null;
  scheduleCallUrl?: string | null;
  postSignRedirectUrl?: string | null;
  stripeFeePercent?: number | null;
  bankName?: string | null;
  bankAccountName?: string | null;
  bankAccountNumber?: string | null;
  bankIban?: string | null;
  bankSwift?: string | null;
  bankRouting?: string | null;
  bankInstructions?: string | null;
}

export async function updateProposalSettings(input: ProposalSettingsInput) {
  await getUser();
  const now = new Date().toISOString();

  const existing = await orm.proposal_Settings.findFirst();
  const data = {
    baseCurrency: input.baseCurrency,
    defaultExpiryDays: input.defaultExpiryDays,
    brandColor: input.brandColor ?? null,
    fontFamily: input.fontFamily ?? null,
    companyName: input.companyName ?? null,
    companyEmail: input.companyEmail ?? null,
    companyWebsite: input.companyWebsite ?? null,
    footerText: input.footerText ?? null,
    defaultTermsHtml: input.defaultTermsHtml ?? null,
    logoStorageKey: input.logoStorageKey ?? null,
    clientAvatars: input.clientAvatars ?? null,
    scheduleCallUrl: input.scheduleCallUrl ?? null,
    postSignRedirectUrl: input.postSignRedirectUrl ?? null,
    stripeFeePercent: input.stripeFeePercent != null ? String(input.stripeFeePercent) : "3.5",
    bankName: input.bankName ?? null,
    bankAccountName: input.bankAccountName ?? null,
    bankAccountNumber: input.bankAccountNumber ?? null,
    bankIban: input.bankIban ?? null,
    bankSwift: input.bankSwift ?? null,
    bankRouting: input.bankRouting ?? null,
    bankInstructions: input.bankInstructions ?? null,
    updatedAt: now,
  };

  if (existing) {
    await orm.proposal_Settings.update({
      where: { id: existing.id },
      data,
    });
  } else {
    await orm.proposal_Settings.create({
      data: { id: crypto.randomUUID(), ...data },
    });
  }

  revalidatePath("/admin/proposal-settings");
  return { success: true };
}
