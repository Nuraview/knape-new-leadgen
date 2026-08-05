// Type and enum shims replacing the generated `@prisma/client` module.
// Everything here is either inferred from Drizzle tables or hand-declared
// to match what the codebase actually uses.

import type { InferSelectModel } from "drizzle-orm";
import * as s from "@/drizzle/schema";

// ----- Decimal -----
// Re-exported from decimal.js, which is what `lib/invoices/totals.ts` and
// `lib/proposals/totals.ts` already use. This used to be a hand-rolled class
// with only plus/minus/times/div, which broke two ways:
//   1. `lib/currency-format.ts` calls `.mul()` and `.toDecimalPlaces()`, and
//      neither existed — every convertAmount() call threw at runtime, taking
//      out reports/sales, reports/dashboard, getExpectedRevenue and the
//      opportunities budget column.
//   2. Its arithmetic went through Number(), so money was computed in floats.
// decimal.js is a strict superset of the old surface (plus/minus/times/div/
// equals/toString/toNumber/toFixed all exist), so this swap is additive.
export { Decimal } from "decimal.js";

// ----- Enums -----
// Prisma generates these as TS enums; we mirror them as `const` objects so
// both `EnumName.VALUE` and plain string literals type-check.
export const ActiveStatus = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  PENDING: "PENDING",
} as const;
export type ActiveStatus = (typeof ActiveStatus)[keyof typeof ActiveStatus];

export const ApiKeyProvider = {
  OPENAI: "OPENAI",
  FIRECRAWL: "FIRECRAWL",
  ANTHROPIC: "ANTHROPIC",
  GROQ: "GROQ",
} as const;
export type ApiKeyProvider =
  (typeof ApiKeyProvider)[keyof typeof ApiKeyProvider];

export const ApiKeyScope = {
  SYSTEM: "SYSTEM",
  USER: "USER",
} as const;
export type ApiKeyScope = (typeof ApiKeyScope)[keyof typeof ApiKeyScope];

export const DocumentProcessingStatus = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  READY: "READY",
  FAILED: "FAILED",
} as const;
export type DocumentProcessingStatus =
  (typeof DocumentProcessingStatus)[keyof typeof DocumentProcessingStatus];

export const DocumentSystemType = {
  RECEIPT: "RECEIPT",
  CONTRACT: "CONTRACT",
  OFFER: "OFFER",
  OTHER: "OTHER",
} as const;
export type DocumentSystemType =
  (typeof DocumentSystemType)[keyof typeof DocumentSystemType];

export const EmailFolder = {
  INBOX: "INBOX",
  SENT: "SENT",
} as const;
export type EmailFolder = (typeof EmailFolder)[keyof typeof EmailFolder];

export const ExchangeRateSource = {
  MANUAL: "MANUAL",
  ECB: "ECB",
} as const;
export type ExchangeRateSource =
  (typeof ExchangeRateSource)[keyof typeof ExchangeRateSource];

export const Invoice_Status = {
  DRAFT: "DRAFT",
  ISSUED: "ISSUED",
  SENT: "SENT",
  PARTIALLY_PAID: "PARTIALLY_PAID",
  PAID: "PAID",
  OVERDUE: "OVERDUE",
  CANCELLED: "CANCELLED",
  DISPUTED: "DISPUTED",
  REFUNDED: "REFUNDED",
  WRITTEN_OFF: "WRITTEN_OFF",
} as const;
export type Invoice_Status =
  (typeof Invoice_Status)[keyof typeof Invoice_Status];

export const Invoice_Type = {
  INVOICE: "INVOICE",
  CREDIT_NOTE: "CREDIT_NOTE",
  PROFORMA: "PROFORMA",
} as const;
export type Invoice_Type = (typeof Invoice_Type)[keyof typeof Invoice_Type];

export const Language = {
  cz: "cz",
  en: "en",
  de: "de",
  uk: "uk",
} as const;
export type Language = (typeof Language)[keyof typeof Language];

export const crm_Account_Product_Status = {
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
  CANCELLED: "CANCELLED",
  PENDING: "PENDING",
} as const;
export type crm_Account_Product_Status =
  (typeof crm_Account_Product_Status)[keyof typeof crm_Account_Product_Status];

export const crm_Activity_Status = {
  scheduled: "scheduled",
  completed: "completed",
  cancelled: "cancelled",
} as const;
export type crm_Activity_Status =
  (typeof crm_Activity_Status)[keyof typeof crm_Activity_Status];

export const crm_Activity_Type = {
  call: "call",
  meeting: "meeting",
  note: "note",
  email: "email",
} as const;
export type crm_Activity_Type =
  (typeof crm_Activity_Type)[keyof typeof crm_Activity_Type];

export const crm_AuditLog_Action = {
  created: "created",
  updated: "updated",
  deleted: "deleted",
  restored: "restored",
  relation_added: "relation_added",
  relation_removed: "relation_removed",
} as const;
export type crm_AuditLog_Action =
  (typeof crm_AuditLog_Action)[keyof typeof crm_AuditLog_Action];

export const crm_Billing_Period = {
  MONTHLY: "MONTHLY",
  QUARTERLY: "QUARTERLY",
  ANNUALLY: "ANNUALLY",
  ONE_TIME: "ONE_TIME",
} as const;
export type crm_Billing_Period =
  (typeof crm_Billing_Period)[keyof typeof crm_Billing_Period];

export const crm_Contracts_Status = {
  NOTSTARTED: "NOTSTARTED",
  INPROGRESS: "INPROGRESS",
  SIGNED: "SIGNED",
} as const;
export type crm_Contracts_Status =
  (typeof crm_Contracts_Status)[keyof typeof crm_Contracts_Status];

export const crm_Discount_Type = {
  PERCENTAGE: "PERCENTAGE",
  FIXED: "FIXED",
} as const;
export type crm_Discount_Type =
  (typeof crm_Discount_Type)[keyof typeof crm_Discount_Type];

export const crm_Enrichment_Status = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED",
} as const;
export type crm_Enrichment_Status =
  (typeof crm_Enrichment_Status)[keyof typeof crm_Enrichment_Status];

export const crm_Opportunity_Status = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  PENDING: "PENDING",
  CLOSED: "CLOSED",
} as const;
export type crm_Opportunity_Status =
  (typeof crm_Opportunity_Status)[keyof typeof crm_Opportunity_Status];

export const crm_Product_Status = {
  DRAFT: "DRAFT",
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED",
} as const;
export type crm_Product_Status =
  (typeof crm_Product_Status)[keyof typeof crm_Product_Status];

export const crm_Product_Type = {
  PRODUCT: "PRODUCT",
  SERVICE: "SERVICE",
} as const;
export type crm_Product_Type =
  (typeof crm_Product_Type)[keyof typeof crm_Product_Type];

export const taskStatus = {
  ACTIVE: "ACTIVE",
  PENDING: "PENDING",
  COMPLETE: "COMPLETE",
} as const;
export type taskStatus = (typeof taskStatus)[keyof typeof taskStatus];

// ----- Model types (inferred from Drizzle) -----
export type Users = InferSelectModel<typeof s.users>;
export type Sections = InferSelectModel<typeof s.sections>;
export type Tasks = InferSelectModel<typeof s.tasks>;
export type Boards = InferSelectModel<typeof s.boards>;
export type Documents = InferSelectModel<typeof s.documents>;
export type Invoices = InferSelectModel<typeof s.invoices>;
export type crm_Accounts = InferSelectModel<typeof s.crmAccounts>;
export type crm_Contacts = InferSelectModel<typeof s.crmContacts>;
export type crm_Leads = InferSelectModel<typeof s.crmLeads>;
export type crm_Opportunities = InferSelectModel<typeof s.crmOpportunities>;
export type crm_Products = InferSelectModel<typeof s.crmProducts>;
export type crm_ProductCategories = InferSelectModel<
  typeof s.crmProductCategories
>;
export type crm_Contracts = InferSelectModel<typeof s.crmContracts>;
export type crm_Targets = InferSelectModel<typeof s.crmTargets>;
export type crm_TargetLists = InferSelectModel<typeof s.crmTargetLists>;
export type crm_campaigns = InferSelectModel<typeof s.crmCampaigns>;
export type crm_Activities = InferSelectModel<typeof s.crmActivities>;

// ----- Query-shape types used by the Drizzle compat layer -----
// These were previously a `Prisma` namespace stub. Nothing Prisma remains;
// the names describe the shapes `lib/db-compat.ts` accepts.
export namespace Db {
  /**
   * `where` shape accepted by `orm.Invoices.*`. Left permissive because
   * `lib/db-compat.ts` interprets it at runtime (eq/in/contains/gte/lte/AND/OR).
   * Previously referenced as `Prisma.InvoicesWhereInput`, which was never
   * defined — the resulting type error was masked by
   * `typescript.ignoreBuildErrors` in next.config.js.
   */
  export type InvoicesWhereInput = Record<string, unknown>;
  export type JsonValue =
    | string
    | number
    | boolean
    | null
    | { [key: string]: JsonValue }
    | JsonValue[];
  export type InputJsonValue = JsonValue;
  export type JsonObject = { [key: string]: JsonValue };
  export type JsonArray = JsonValue[];
  export type DecimalJsLike = { d: number[]; e: number; s: number };
  export type TransactionClient = any;
  export type PrismaPromise<T> = Promise<T>;
}

// ----- Client stub -----
// Nothing should instantiate this — `orm` is the compat proxy in
// `lib/db-compat.ts`. Kept only as a type for `TxClient` unions.
export class DbClient {
  constructor(..._args: any[]) {
    throw new Error(
      '[db-compat] DbClient is not constructible — use `import { orm } from "@/lib/db-compat"`.',
    );
  }
}

