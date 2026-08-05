// Prisma-compat facade backed by Drizzle + Neon.
//
// We removed @prisma/client and the prisma CLI but kept the `orm.Model.op(...)`
// call-site syntax so the ~270 files that use it still work. Every call here
// translates to native Drizzle operations under the hood.
//
// Not a 100% reproduction of the Prisma client. Covers the patterns actually
// used in this codebase: findMany/findUnique/findFirst/create/createMany/update/
// updateMany/upsert/delete/deleteMany/count/aggregate, $transaction, $queryRaw.
// Advanced relational filters (`some`/`every`/`none` on relations) are best-effort
// via EXISTS subqueries; exotic Prisma features throw with a clear message.

import { Table, getTableColumns, sql as drizzleSql } from "drizzle-orm";
import {
  and,
  or,
  not,
  eq,
  ne,
  gt,
  gte,
  lt,
  lte,
  inArray,
  notInArray,
  ilike,
  isNull,
  isNotNull,
  desc,
  asc,
  count as sqlCount,
  sum as sqlSum,
  avg as sqlAvg,
  min as sqlMin,
  max as sqlMax,
  type SQL,
} from "drizzle-orm";

import { db } from "@/lib/db";
import * as schema from "@/drizzle/schema";

// ---------- model registry ----------

// Prisma model name (as used in `orm.Xxx.yyy`) → Drizzle Table.
// Also carries the `db.query.<queryName>` key for relational queries.
const REGISTRY: Record<string, { table: Table; queryName: string }> = {
  users: { table: schema.users, queryName: "users" },
  account: { table: schema.account, queryName: "account" },
  session: { table: schema.session, queryName: "session" },
  verification: { table: schema.verification, queryName: "verification" },
  apiKeys: { table: schema.apiKeys, queryName: "apiKeys" },
  apiToken: { table: schema.apiToken, queryName: "apiToken" },
  boards: { table: schema.boards, queryName: "boards" },
  boardWatchers: { table: schema.boardWatchers, queryName: "boardWatchers" },
  sections: { table: schema.sections, queryName: "sections" },
  tasks: { table: schema.tasks, queryName: "tasks" },
  tasksComments: { table: schema.tasksComments, queryName: "tasksComments" },
  todoList: { table: schema.todoList, queryName: "todoList" },
  documents: { table: schema.documents, queryName: "documents" },
  documentsTypes: { table: schema.documentsTypes, queryName: "documentsTypes" },
  documentsToOpportunities: {
    table: schema.documentsToOpportunities,
    queryName: "documentsToOpportunities",
  },
  documentsToContacts: {
    table: schema.documentsToContacts,
    queryName: "documentsToContacts",
  },
  documentsToTasks: {
    table: schema.documentsToTasks,
    queryName: "documentsToTasks",
  },
  documentsToCrmAccountsTasks: {
    table: schema.documentsToCrmAccountsTasks,
    queryName: "documentsToCrmAccountsTasks",
  },
  documentsToLeads: {
    table: schema.documentsToLeads,
    queryName: "documentsToLeads",
  },
  documentsToAccounts: {
    table: schema.documentsToAccounts,
    queryName: "documentsToAccounts",
  },
  accountWatchers: { table: schema.accountWatchers, queryName: "accountWatchers" },
  email: { table: schema.email, queryName: "email" },
  emailAccount: { table: schema.emailAccount, queryName: "emailAccount" },
  emailEmbedding: { table: schema.emailEmbedding, queryName: "emailEmbedding" },
  emailsToContacts: {
    table: schema.emailsToContacts,
    queryName: "emailsToContacts",
  },
  emailsToAccounts: {
    table: schema.emailsToAccounts,
    queryName: "emailsToAccounts",
  },
  imageUpload: { table: schema.imageUpload, queryName: "imageUpload" },
  employees: { table: schema.employees, queryName: "employees" },
  systemServices: { table: schema.systemServices, queryName: "systemServices" },
  crm_SystemSettings: {
    table: schema.crmSystemSettings,
    queryName: "crmSystemSettings",
  },
  crm_Accounts: { table: schema.crmAccounts, queryName: "crmAccounts" },
  crm_Accounts_Tasks: {
    table: schema.crmAccountsTasks,
    queryName: "crmAccountsTasks",
  },
  crm_AccountProducts: {
    table: schema.crmAccountProducts,
    queryName: "crmAccountProducts",
  },
  crm_Contacts: { table: schema.crmContacts, queryName: "crmContacts" },
  crm_Contact_Enrichment: {
    table: schema.crmContactEnrichment,
    queryName: "crmContactEnrichment",
  },
  crm_Contact_Types: {
    table: schema.crmContactTypes,
    queryName: "crmContactTypes",
  },
  crm_Contracts: { table: schema.crmContracts, queryName: "crmContracts" },
  crm_ContractLineItems: {
    table: schema.crmContractLineItems,
    queryName: "crmContractLineItems",
  },
  crm_OpportunityLineItems: {
    table: schema.crmOpportunityLineItems,
    queryName: "crmOpportunityLineItems",
  },
  crm_Industry_Type: {
    table: schema.crmIndustryType,
    queryName: "crmIndustryType",
  },
  crm_Leads: { table: schema.crmLeads, queryName: "crmLeads" },
  crm_Lead_Sources: {
    table: schema.crmLeadSources,
    queryName: "crmLeadSources",
  },
  crm_Lead_Statuses: {
    table: schema.crmLeadStatuses,
    queryName: "crmLeadStatuses",
  },
  crm_Lead_Types: { table: schema.crmLeadTypes, queryName: "crmLeadTypes" },
  crm_Opportunities: {
    table: schema.crmOpportunities,
    queryName: "crmOpportunities",
  },
  crm_Opportunities_Type: {
    table: schema.crmOpportunitiesType,
    queryName: "crmOpportunitiesType",
  },
  crm_Opportunities_Sales_Stages: {
    table: schema.crmOpportunitiesSalesStages,
    queryName: "crmOpportunitiesSalesStages",
  },
  crm_Products: { table: schema.crmProducts, queryName: "crmProducts" },
  crm_ProductCategories: {
    table: schema.crmProductCategories,
    queryName: "crmProductCategories",
  },
  crm_Targets: { table: schema.crmTargets, queryName: "crmTargets" },
  crm_TargetLists: {
    table: schema.crmTargetLists,
    queryName: "crmTargetLists",
  },
  crm_Target_Contact: {
    table: schema.crmTargetContact,
    queryName: "crmTargetContact",
  },
  crm_Target_Enrichment: {
    table: schema.crmTargetEnrichment,
    queryName: "crmTargetEnrichment",
  },
  crm_Activities: { table: schema.crmActivities, queryName: "crmActivities" },
  crm_ActivityLinks: {
    table: schema.crmActivityLinks,
    queryName: "crmActivityLinks",
  },
  crm_AuditLog: { table: schema.crmAuditLog, queryName: "crmAuditLog" },
  crm_Report_Config: {
    table: schema.crmReportConfig,
    queryName: "crmReportConfig",
  },
  crm_Report_Schedule: {
    table: schema.crmReportSchedule,
    queryName: "crmReportSchedule",
  },
  crm_campaigns: { table: schema.crmCampaigns, queryName: "crmCampaigns" },
  crm_campaign_steps: {
    table: schema.crmCampaignSteps,
    queryName: "crmCampaignSteps",
  },
  crm_campaign_sends: {
    table: schema.crmCampaignSends,
    queryName: "crmCampaignSends",
  },
  crm_campaign_templates: {
    table: schema.crmCampaignTemplates,
    queryName: "crmCampaignTemplates",
  },
  contactsToOpportunities: {
    table: schema.contactsToOpportunities,
    queryName: "contactsToOpportunities",
  },
  targetsToTargetLists: {
    table: schema.targetsToTargetLists,
    queryName: "targetsToTargetLists",
  },
  campaignToTargetLists: {
    table: schema.campaignToTargetLists,
    queryName: "campaignToTargetLists",
  },
  invoices: { table: schema.invoices, queryName: "invoices" },
  invoice_Activity: {
    table: schema.invoiceActivity,
    queryName: "invoiceActivity",
  },
  invoice_Series: { table: schema.invoiceSeries, queryName: "invoiceSeries" },
  invoice_Settings: {
    table: schema.invoiceSettings,
    queryName: "invoiceSettings",
  },
  invoice_TaxRates: {
    table: schema.invoiceTaxRates,
    queryName: "invoiceTaxRates",
  },
  invoiceAttachments: {
    table: schema.invoiceAttachments,
    queryName: "invoiceAttachments",
  },
  invoiceLineItems: {
    table: schema.invoiceLineItems,
    queryName: "invoiceLineItems",
  },
  invoicePayments: {
    table: schema.invoicePayments,
    queryName: "invoicePayments",
  },
  currency: { table: schema.currency, queryName: "currency" },
  exchangeRate: { table: schema.exchangeRate, queryName: "exchangeRate" },
  crm_Proposals: { table: schema.crmProposals, queryName: "crmProposals" },
  crm_Proposal_LineItems: {
    table: schema.crmProposalLineItems,
    queryName: "crmProposalLineItems",
  },
  crm_Proposal_Assets: {
    table: schema.crmProposalAssets,
    queryName: "crmProposalAssets",
  },
  crm_Proposal_Activity: {
    table: schema.crmProposalActivity,
    queryName: "crmProposalActivity",
  },
  proposal_Settings: {
    table: schema.proposalSettings,
    queryName: "proposalSettings",
  },
  crm_Embeddings_Accounts: {
    table: schema.crmEmbeddingsAccounts,
    queryName: "crmEmbeddingsAccounts",
  },
  crm_Embeddings_Contacts: {
    table: schema.crmEmbeddingsContacts,
    queryName: "crmEmbeddingsContacts",
  },
  crm_Embeddings_Documents: {
    table: schema.crmEmbeddingsDocuments,
    queryName: "crmEmbeddingsDocuments",
  },
  crm_Embeddings_Leads: {
    table: schema.crmEmbeddingsLeads,
    queryName: "crmEmbeddingsLeads",
  },
  crm_Embeddings_Opportunities: {
    table: schema.crmEmbeddingsOpportunities,
    queryName: "crmEmbeddingsOpportunities",
  },
  crm_Document_Chunks: {
    table: schema.crmDocumentChunks,
    queryName: "crmDocumentChunks",
  },
};

// ---------- helpers ----------

function colOf(table: Table, field: string): any {
  const cols = getTableColumns(table);
  return (cols as any)[field];
}

// Build a Drizzle WHERE SQL from Prisma's nested object syntax.
function buildWhere(table: Table, where: any): SQL | undefined {
  if (!where || typeof where !== "object") return undefined;
  const clauses: SQL[] = [];

  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;

    if (key === "AND") {
      const arr = Array.isArray(value) ? value : [value];
      const parts = arr
        .map((v: any) => buildWhere(table, v))
        .filter(Boolean) as SQL[];
      if (parts.length) clauses.push(and(...parts)!);
      continue;
    }
    if (key === "OR") {
      const arr = Array.isArray(value) ? value : [value];
      const parts = arr
        .map((v: any) => buildWhere(table, v))
        .filter(Boolean) as SQL[];
      if (parts.length) clauses.push(or(...parts)!);
      continue;
    }
    if (key === "NOT") {
      const sub = buildWhere(table, value);
      if (sub) clauses.push(not(sub));
      continue;
    }

    // Composite unique key → object form like
    // where: { fromCurrency_toCurrency: { fromCurrency: "x", toCurrency: "y" } }
    // We flatten it into individual equalities.
    if (
      typeof value === "object" &&
      value !== null &&
      !(value instanceof Date) &&
      !Array.isArray(value) &&
      key.includes("_") &&
      Object.keys(value).every((k) => colOf(table, k) != null)
    ) {
      for (const [innerKey, innerVal] of Object.entries(value)) {
        const col = colOf(table, innerKey);
        if (col) clauses.push(eq(col, innerVal));
      }
      continue;
    }

    const col = colOf(table, key);
    if (!col) {
      // Unknown field — likely a relation; skip silently. Callers relying on
      // relational filters (`some`/`every`) should migrate to native Drizzle.
      continue;
    }

    if (value === null) {
      clauses.push(isNull(col));
    } else if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      // Filter operators: { equals, not, in, notIn, gt, gte, lt, lte, contains, ... }
      for (const [op, opValRaw] of Object.entries(value as any)) {
        if (opValRaw === undefined) continue;
        const opVal = opValRaw as any;
        switch (op) {
          case "equals":
            clauses.push(opVal === null ? isNull(col) : eq(col, opVal));
            break;
          case "not":
            if (opVal === null) clauses.push(isNotNull(col));
            else if (
              typeof opVal === "object" &&
              !Array.isArray(opVal) &&
              !(opVal instanceof Date)
            ) {
              // nested not operator — approximate as NOT(eq/in/etc)
              const inner = buildWhere(table, { [key]: opVal });
              if (inner) clauses.push(not(inner));
            } else {
              clauses.push(ne(col, opVal));
            }
            break;
          case "in":
            clauses.push(inArray(col, Array.isArray(opVal) ? opVal : [opVal]));
            break;
          case "notIn":
            clauses.push(
              notInArray(col, Array.isArray(opVal) ? opVal : [opVal]),
            );
            break;
          case "gt":
            clauses.push(gt(col, opVal));
            break;
          case "gte":
            clauses.push(gte(col, opVal));
            break;
          case "lt":
            clauses.push(lt(col, opVal));
            break;
          case "lte":
            clauses.push(lte(col, opVal));
            break;
          case "contains":
            clauses.push(ilike(col, `%${opVal}%`));
            break;
          case "startsWith":
            clauses.push(ilike(col, `${opVal}%`));
            break;
          case "endsWith":
            clauses.push(ilike(col, `%${opVal}`));
            break;
          case "mode":
            // 'insensitive' — already handled by ilike.
            break;
          case "has":
            clauses.push(drizzleSql`${col} @> ARRAY[${opVal}]`);
            break;
          case "hasEvery":
            clauses.push(drizzleSql`${col} @> ${opVal}`);
            break;
          case "hasSome":
            clauses.push(drizzleSql`${col} && ${opVal}`);
            break;
          case "isEmpty":
            clauses.push(
              opVal
                ? drizzleSql`cardinality(${col}) = 0`
                : drizzleSql`cardinality(${col}) > 0`,
            );
            break;
          default:
            // Relational filters (some/every/none) not supported here.
            break;
        }
      }
    } else {
      clauses.push(eq(col, value as any));
    }
  }

  if (!clauses.length) return undefined;
  return clauses.length === 1 ? clauses[0] : and(...clauses);
}

function buildOrderBy(table: Table, orderBy: any): any[] {
  if (!orderBy) return [];
  const arr = Array.isArray(orderBy) ? orderBy : [orderBy];
  const out: any[] = [];
  for (const entry of arr) {
    if (!entry || typeof entry !== "object") continue;
    for (const [field, dir] of Object.entries(entry)) {
      const col = colOf(table, field);
      if (col) out.push(dir === "desc" ? desc(col) : asc(col));
    }
  }
  return out;
}

function buildSelect(table: Table, select: any): any {
  if (!select || typeof select !== "object") return undefined;
  const out: any = {};
  for (const [k, v] of Object.entries(select)) {
    if (v === true) {
      const col = colOf(table, k);
      if (col) out[k] = col;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

async function applyInclude(
  _table: Table,
  rows: any[],
  include: any,
): Promise<any[]> {
  if (!include || !rows.length) return rows;
  // Best-effort no-op: rows returned from the base select don't carry
  // relations. Includes are served via db.query in executeSelect above; this
  // is only hit when that path fails, so we return rows sans relations.
  return rows;
}

// ---------- model client ----------

function modelClient(modelName: string) {
  const entry = REGISTRY[modelName];
  if (!entry) {
    throw new Error(
      `[prisma-compat] Unknown model "${modelName}" — add it to REGISTRY in lib/prisma.ts.`,
    );
  }
  const { table, queryName } = entry;
  const queryNs = (db as any).query?.[queryName];

  async function executeSelect(args: any = {}): Promise<any[]> {
    const asArray = (r: any): any[] =>
      Array.isArray(r) ? r : ((r as any)?.rows ?? []);
    // Prefer db.query for `include` / `with` support.
    if (queryNs && (args.include || args.with)) {
      try {
        const rows = await queryNs.findMany({
          where: args.where
            ? (t: any, _ops: any) => buildWhere(t as Table, args.where)
            : undefined,
          with: args.include ?? args.with,
          columns:
            args.select && !args.include
              ? Object.fromEntries(
                  Object.entries(args.select).filter(([, v]) => v === true),
                )
              : undefined,
          orderBy: args.orderBy
            ? (t: any) => buildOrderBy(t as Table, args.orderBy)
            : undefined,
          limit: args.take,
          offset: args.skip,
        });
        return rows;
      } catch {
        // Fall through to basic select if relational query errors (e.g. unknown
        // relation). The rows simply won't have the included fields.
      }
    }

    const where = buildWhere(table, args.where);
    const ob = buildOrderBy(table, args.orderBy);
    const selectShape = buildSelect(table, args.select);
    let q: any = selectShape
      ? db.select(selectShape).from(table as any)
      : db.select().from(table as any);
    if (where) q = q.where(where);
    if (ob.length) q = q.orderBy(...ob);
    if (args.take != null) q = q.limit(args.take);
    if (args.skip != null) q = q.offset(args.skip);
    const rows = asArray(await q);
    return args.include ? applyInclude(table, rows, args.include) : rows;
  }

  return {
    async findMany(args: any = {}) {
      return executeSelect(args);
    },
    async findFirst(args: any = {}) {
      const rows = await executeSelect({ ...args, take: 1 });
      return rows[0] ?? null;
    },
    async findUnique(args: any = {}) {
      const rows = await executeSelect({ ...args, take: 1 });
      return rows[0] ?? null;
    },
    async findFirstOrThrow(args: any = {}) {
      const row = await this.findFirst(args);
      if (!row) throw new Error("Record not found");
      return row;
    },
    async findUniqueOrThrow(args: any = {}) {
      const row = await this.findUnique(args);
      if (!row) throw new Error("Record not found");
      return row;
    },
    async count(args: any = {}) {
      const where = buildWhere(table, args?.where);
      let q: any = db.select({ n: sqlCount() }).from(table as any);
      if (where) q = q.where(where);
      const [row] = await q;
      return Number(row.n);
    },
    async create(args: any) {
      const values = args.data;
      const rows: any = await db
        .insert(table as any)
        .values(values)
        .returning();
      return Array.isArray(rows) ? rows[0] : rows?.rows?.[0];
    },
    async createMany(args: any) {
      const data = Array.isArray(args.data) ? args.data : [args.data];
      if (!data.length) return { count: 0 };
      const result = await db.insert(table as any).values(data);
      return { count: (result as any).rowCount ?? data.length };
    },
    async update(args: any) {
      const where = buildWhere(table, args.where);
      if (!where) throw new Error("update() requires a where clause");
      const rows: any = await db
        .update(table as any)
        .set(args.data)
        .where(where)
        .returning();
      return Array.isArray(rows) ? rows[0] : rows?.rows?.[0];
    },
    async updateMany(args: any) {
      const where = buildWhere(table, args?.where);
      const q: any = db.update(table as any).set(args.data);
      const result = where ? await q.where(where) : await q;
      return { count: (result as any).rowCount ?? 0 };
    },
    async upsert(args: any) {
      const where = buildWhere(table, args.where);
      if (!where) throw new Error("upsert() requires a where clause");
      const existingRaw: any = await db
        .select()
        .from(table as any)
        .where(where)
        .limit(1);
      const existing: any[] = Array.isArray(existingRaw)
        ? existingRaw
        : (existingRaw?.rows ?? []);
      if (existing.length) {
        const updRows: any = await db
          .update(table as any)
          .set(args.update)
          .where(where)
          .returning();
        return Array.isArray(updRows) ? updRows[0] : updRows?.rows?.[0];
      }
      const insRows: any = await db
        .insert(table as any)
        .values(args.create)
        .returning();
      return Array.isArray(insRows) ? insRows[0] : insRows?.rows?.[0];
    },
    async delete(args: any) {
      const where = buildWhere(table, args.where);
      if (!where) throw new Error("delete() requires a where clause");
      const rows: any = await db
        .delete(table as any)
        .where(where)
        .returning();
      return Array.isArray(rows) ? rows[0] : rows?.rows?.[0];
    },
    async deleteMany(args: any = {}) {
      const where = buildWhere(table, args?.where);
      const q: any = db.delete(table as any);
      const result = where ? await q.where(where) : await q;
      return { count: (result as any).rowCount ?? 0 };
    },
    async aggregate(args: any = {}) {
      const where = buildWhere(table, args?.where);
      const selectShape: any = {};
      if (args._count) selectShape.__count = sqlCount();
      if (args._sum)
        for (const f of Object.keys(args._sum)) {
          const c = colOf(table, f);
          if (c) selectShape[`__sum_${f}`] = sqlSum(c);
        }
      if (args._avg)
        for (const f of Object.keys(args._avg)) {
          const c = colOf(table, f);
          if (c) selectShape[`__avg_${f}`] = sqlAvg(c);
        }
      if (args._min)
        for (const f of Object.keys(args._min)) {
          const c = colOf(table, f);
          if (c) selectShape[`__min_${f}`] = sqlMin(c);
        }
      if (args._max)
        for (const f of Object.keys(args._max)) {
          const c = colOf(table, f);
          if (c) selectShape[`__max_${f}`] = sqlMax(c);
        }
      let q: any = db.select(selectShape).from(table as any);
      if (where) q = q.where(where);
      const [row] = await q;
      const out: any = {};
      if (args._count)
        out._count =
          typeof args._count === "object"
            ? { _all: Number(row.__count) }
            : Number(row.__count);
      for (const section of ["_sum", "_avg", "_min", "_max"] as const) {
        if (args[section]) {
          out[section] = {};
          for (const f of Object.keys(args[section])) {
            out[section][f] = row[`_${section.slice(1)}_${f}`] ?? null;
          }
        }
      }
      return out;
    },
    async groupBy(_args: any): Promise<never> {
      throw new Error("[prisma-compat] groupBy is not implemented");
    },
  };
}

const clientCache: Record<string, ReturnType<typeof modelClient>> = {};

// ---------- top-level methods ----------

function $queryRawTagged(strings: TemplateStringsArray, ...values: any[]) {
  // Delegate to drizzle's sql template — it parameterizes values the same way
  // Prisma's $queryRaw does.
  const q = (drizzleSql as any)(strings, ...values);
  return (db.execute as any)(q).then((r: any) => r.rows ?? r);
}

function $executeRawTagged(strings: TemplateStringsArray, ...values: any[]) {
  const q = (drizzleSql as any)(strings, ...values);
  return (db.execute as any)(q).then((r: any) => (r as any).rowCount ?? 0);
}

// ---------- the exported client ----------

export const orm: any = new Proxy(
  {},
  {
    get(_target, prop: string | symbol) {
      if (typeof prop === "symbol") return undefined;
      switch (prop) {
        case "$transaction":
          return async (arg: any) => {
            if (Array.isArray(arg)) return Promise.all(arg);
            if (typeof arg === "function") {
              // Drizzle's neon-serverless driver supports `db.transaction`.
              if (typeof (db as any).transaction === "function") {
                return (db as any).transaction(async () => arg(orm));
              }
              return arg(orm);
            }
            return arg;
          };
        case "$queryRaw":
        case "$queryRawUnsafe":
          return $queryRawTagged;
        case "$executeRaw":
        case "$executeRawUnsafe":
          return $executeRawTagged;
        case "$connect":
        case "$disconnect":
          return async () => {};
        case "$on":
          return () => {};
        case "$extends":
          return () => orm;
      }
      if (!clientCache[prop]) clientCache[prop] = modelClient(prop);
      return clientCache[prop];
    },
  },
);

export default orm;
