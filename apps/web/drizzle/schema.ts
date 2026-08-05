import { pgTable, varchar, timestamp, text, integer, uuid, index, foreignKey, boolean, bigint, jsonb, uniqueIndex, numeric, unique, vector, primaryKey, pgEnum, customType, check } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

// NOTE: if you re-run `pnpm db:pull`, drizzle-kit will overwrite this file and
// emit `searchVector: unknown("search_vector")` again (tsvector has no built-in
// drizzle type). Re-add `customType` to the import and the definition below.
const tsvector = customType<{ data: string; driverData: string }>({
	dataType() {
		return "tsvector";
	},
});

export const activeStatus = pgEnum("ActiveStatus", ['ACTIVE', 'INACTIVE', 'PENDING'])
export const apiKeyProvider = pgEnum("ApiKeyProvider", ['OPENAI', 'FIRECRAWL', 'ANTHROPIC', 'GROQ'])
export const apiKeyScope = pgEnum("ApiKeyScope", ['SYSTEM', 'USER'])
export const documentProcessingStatus = pgEnum("DocumentProcessingStatus", ['PENDING', 'PROCESSING', 'READY', 'FAILED'])
export const documentSystemType = pgEnum("DocumentSystemType", ['RECEIPT', 'CONTRACT', 'OFFER', 'OTHER'])
export const emailFolder = pgEnum("EmailFolder", ['INBOX', 'SENT'])
export const exchangeRateSource = pgEnum("ExchangeRateSource", ['MANUAL', 'ECB'])
export const invoiceStatus = pgEnum("Invoice_Status", ['DRAFT', 'ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED', 'DISPUTED', 'REFUNDED', 'WRITTEN_OFF'])
export const invoiceType = pgEnum("Invoice_Type", ['INVOICE', 'CREDIT_NOTE', 'PROFORMA'])
export const language = pgEnum("Language", ['cz', 'en', 'de', 'uk'])
export const crmAccountProductStatus = pgEnum("crm_AccountProduct_Status", ['ACTIVE', 'EXPIRED', 'CANCELLED', 'PENDING'])
export const crmActivityStatus = pgEnum("crm_Activity_Status", ['scheduled', 'completed', 'cancelled'])
export const crmActivityType = pgEnum("crm_Activity_Type", ['call', 'meeting', 'note', 'email'])
export const crmAuditLogAction = pgEnum("crm_AuditLog_Action", ['created', 'updated', 'deleted', 'restored', 'relation_added', 'relation_removed'])
export const crmBillingPeriod = pgEnum("crm_Billing_Period", ['MONTHLY', 'QUARTERLY', 'ANNUALLY', 'ONE_TIME'])
export const crmContractsStatus = pgEnum("crm_Contracts_Status", ['NOTSTARTED', 'INPROGRESS', 'SIGNED'])
export const crmDiscountType = pgEnum("crm_Discount_Type", ['PERCENTAGE', 'FIXED'])
export const crmEnrichmentStatus = pgEnum("crm_Enrichment_Status", ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED'])
export const crmOpportunityStatus = pgEnum("crm_Opportunity_Status", ['ACTIVE', 'INACTIVE', 'PENDING', 'CLOSED'])
export const crmProductStatus = pgEnum("crm_Product_Status", ['DRAFT', 'ACTIVE', 'ARCHIVED'])
export const crmProductType = pgEnum("crm_Product_Type", ['PRODUCT', 'SERVICE'])
export const taskStatus = pgEnum("taskStatus", ['ACTIVE', 'PENDING', 'COMPLETE'])


export const prismaMigrations = pgTable("_prisma_migrations", {
	id: varchar({ length: 36 }).primaryKey().notNull(),
	checksum: varchar({ length: 64 }).notNull(),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
	migrationName: varchar("migration_name", { length: 255 }).notNull(),
	logs: text(),
	rolledBackAt: timestamp("rolled_back_at", { withTimezone: true, mode: 'string' }),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	appliedStepsCount: integer("applied_steps_count").default(0).notNull(),
});

export const crmOpportunitiesType = pgTable("crm_Opportunities_Type", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").default(0).notNull(),
	name: text().notNull(),
	order: integer(),
});

export const boards = pgTable("Boards", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").notNull(),
	description: text().notNull(),
	favourite: boolean(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	favouritePosition: bigint({ mode: "number" }),
	icon: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	position: bigint({ mode: "number" }),
	title: text().notNull(),
	user: uuid().notNull(),
	visibility: text(),
	sharedWith: uuid().array(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	createdBy: uuid(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }),
	updatedBy: uuid(),
	deletedAt: timestamp({ precision: 3, mode: 'string' }),
	deletedBy: uuid(),
}, (table) => [
	index("Boards_createdAt_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("Boards_createdBy_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("Boards_deletedAt_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamp_ops")),
	index("Boards_favourite_idx").using("btree", table.favourite.asc().nullsLast().op("bool_ops")),
	index("Boards_updatedBy_idx").using("btree", table.updatedBy.asc().nullsLast().op("uuid_ops")),
	index("Boards_user_favourite_idx").using("btree", table.user.asc().nullsLast().op("bool_ops"), table.favourite.asc().nullsLast().op("bool_ops")),
	index("Boards_user_idx").using("btree", table.user.asc().nullsLast().op("uuid_ops")),
	index("Boards_visibility_idx").using("btree", table.visibility.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.user],
			foreignColumns: [users.id],
			name: "Boards_user_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const crmOpportunitiesSalesStages = pgTable("crm_Opportunities_Sales_Stages", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").default(0).notNull(),
	name: text().notNull(),
	probability: integer(),
	order: integer(),
});

export const crmAccounts = pgTable("crm_Accounts", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	createdBy: uuid(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }),
	updatedBy: uuid(),
	annualRevenue: text("annual_revenue"),
	assignedTo: uuid("assigned_to"),
	billingCity: text("billing_city"),
	billingCountry: text("billing_country"),
	billingPostalCode: text("billing_postal_code"),
	billingState: text("billing_state"),
	billingStreet: text("billing_street"),
	companyId: text("company_id"),
	description: text(),
	email: text(),
	employees: text(),
	fax: text(),
	industry: uuid(),
	memberOf: text("member_of"),
	name: text().notNull(),
	officePhone: text("office_phone"),
	shippingCity: text("shipping_city"),
	shippingCountry: text("shipping_country"),
	shippingPostalCode: text("shipping_postal_code"),
	shippingState: text("shipping_state"),
	shippingStreet: text("shipping_street"),
	status: text().default('Inactive'),
	type: text().default('Customer'),
	vat: text(),
	website: text(),
	deletedAt: timestamp({ precision: 3, mode: 'string' }),
	deletedBy: uuid(),
}, (table) => [
	index("crm_Accounts_assigned_to_idx").using("btree", table.assignedTo.asc().nullsLast().op("uuid_ops")),
	index("crm_Accounts_createdAt_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Accounts_createdBy_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("crm_Accounts_deletedAt_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Accounts_industry_idx").using("btree", table.industry.asc().nullsLast().op("uuid_ops")),
	index("crm_Accounts_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("crm_Accounts_type_idx").using("btree", table.type.asc().nullsLast().op("text_ops")),
	index("crm_Accounts_updatedBy_idx").using("btree", table.updatedBy.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.industry],
			foreignColumns: [crmIndustryType.id],
			name: "crm_Accounts_industry_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.assignedTo],
			foreignColumns: [users.id],
			name: "crm_Accounts_assigned_to_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const crmContacts = pgTable("crm_Contacts", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").default(0).notNull(),
	account: uuid(),
	assignedTo: uuid("assigned_to"),
	birthday: text(),
	// NOTE: The `crm_Contacts` table has BOTH `created_by` (snake) and `createdBy`
	// (camel) columns in Postgres — legacy from the Mongo→Postgres migration. We
	// rename the snake version's JS property to match the DB column name so both
	// can coexist. If you re-run `pnpm db:pull`, drizzle-kit will regenerate a
	// duplicate `createdBy` here — re-apply this rename.
	created_by: uuid("created_by"),
	createdBy: uuid(),
	createdOn: timestamp("created_on", { precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	cratedAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	lastActivity: timestamp("last_activity", { precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp({ precision: 3, mode: 'string' }),
	updatedBy: uuid(),
	lastActivityBy: uuid("last_activity_by"),
	description: text(),
	email: text(),
	personalEmail: text("personal_email"),
	firstName: text("first_name"),
	lastName: text("last_name").notNull(),
	officePhone: text("office_phone"),
	mobilePhone: text("mobile_phone"),
	website: text(),
	position: text(),
	status: boolean().default(true).notNull(),
	socialTwitter: text("social_twitter"),
	socialFacebook: text("social_facebook"),
	socialLinkedin: text("social_linkedin"),
	socialSkype: text("social_skype"),
	socialInstagram: text("social_instagram"),
	socialYoutube: text("social_youtube"),
	socialTiktok: text("social_tiktok"),
	tags: text().array(),
	notes: text().array(),
	accountsIds: uuid("accountsIDs"),
	contactTypeId: uuid("contact_type_id"),
	deletedAt: timestamp({ precision: 3, mode: 'string' }),
	deletedBy: uuid(),
}, (table) => [
	index("crm_Contacts_accountsIDs_idx").using("btree", table.accountsIds.asc().nullsLast().op("uuid_ops")),
	index("crm_Contacts_assigned_to_idx").using("btree", table.assignedTo.asc().nullsLast().op("uuid_ops")),
	index("crm_Contacts_contact_type_id_idx").using("btree", table.contactTypeId.asc().nullsLast().op("uuid_ops")),
	index("crm_Contacts_cratedAt_idx").using("btree", table.cratedAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Contacts_createdBy_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("crm_Contacts_created_by_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("crm_Contacts_deletedAt_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Contacts_last_activity_idx").using("btree", table.lastActivity.asc().nullsLast().op("timestamp_ops")),
	index("crm_Contacts_status_idx").using("btree", table.status.asc().nullsLast().op("bool_ops")),
	index("crm_Contacts_updatedBy_idx").using("btree", table.updatedBy.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.assignedTo],
			foreignColumns: [users.id],
			name: "crm_Contacts_assigned_to_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "crm_Contacts_created_by_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.accountsIds],
			foreignColumns: [crmAccounts.id],
			name: "crm_Contacts_accountsIDs_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.contactTypeId],
			foreignColumns: [crmContactTypes.id],
			name: "crm_Contacts_contact_type_id_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const imageUpload = pgTable("ImageUpload", {
	id: uuid().primaryKey().notNull(),
});

export const crmAccountsTasks = pgTable("crm_Accounts_Tasks", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").notNull(),
	content: text(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	createdBy: uuid(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }),
	updatedBy: uuid(),
	dueDateAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	priority: text().notNull(),
	tags: jsonb(),
	title: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	likes: bigint({ mode: "number" }).default(0),
	user: uuid(),
	taskStatus: taskStatus().default('ACTIVE'),
	account: uuid(),
}, (table) => [
	index("crm_Accounts_Tasks_account_idx").using("btree", table.account.asc().nullsLast().op("uuid_ops")),
	index("crm_Accounts_Tasks_account_taskStatus_idx").using("btree", table.account.asc().nullsLast().op("enum_ops"), table.taskStatus.asc().nullsLast().op("enum_ops")),
	index("crm_Accounts_Tasks_createdAt_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Accounts_Tasks_createdBy_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("crm_Accounts_Tasks_dueDateAt_idx").using("btree", table.dueDateAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Accounts_Tasks_priority_idx").using("btree", table.priority.asc().nullsLast().op("text_ops")),
	index("crm_Accounts_Tasks_taskStatus_idx").using("btree", table.taskStatus.asc().nullsLast().op("enum_ops")),
	index("crm_Accounts_Tasks_updatedBy_idx").using("btree", table.updatedBy.asc().nullsLast().op("uuid_ops")),
	index("crm_Accounts_Tasks_user_idx").using("btree", table.user.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.user],
			foreignColumns: [users.id],
			name: "crm_Accounts_Tasks_user_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.account],
			foreignColumns: [crmAccounts.id],
			name: "crm_Accounts_Tasks_account_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const documentsTypes = pgTable("Documents_Types", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").notNull(),
	name: text().notNull(),
});

export const tasksComments = pgTable("tasksComments", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").notNull(),
	comment: text().notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	task: uuid(),
	user: uuid().notNull(),
	assignedCrmAccountTask: uuid("assigned_crm_account_task"),
}, (table) => [
	index("tasksComments_assigned_crm_account_task_idx").using("btree", table.assignedCrmAccountTask.asc().nullsLast().op("uuid_ops")),
	index("tasksComments_task_idx").using("btree", table.task.asc().nullsLast().op("uuid_ops")),
	index("tasksComments_user_idx").using("btree", table.user.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.assignedCrmAccountTask],
			foreignColumns: [crmAccountsTasks.id],
			name: "tasksComments_assigned_crm_account_task_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.task],
			foreignColumns: [tasks.id],
			name: "tasksComments_task_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.user],
			foreignColumns: [users.id],
			name: "tasksComments_user_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const sections = pgTable("Sections", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").notNull(),
	board: uuid().notNull(),
	title: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	position: bigint({ mode: "number" }),
}, (table) => [
	index("Sections_board_idx").using("btree", table.board.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.board],
			foreignColumns: [boards.id],
			name: "Sections_board_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const todoList = pgTable("TodoList", {
	id: uuid().primaryKey().notNull(),
	createdAt: text().notNull(),
	description: text().notNull(),
	title: text().notNull(),
	url: text().notNull(),
	user: text().notNull(),
});

export const tasks = pgTable("Tasks", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").notNull(),
	content: text(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	createdBy: uuid(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }),
	updatedBy: uuid(),
	dueDateAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	lastEditedAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	position: bigint({ mode: "number" }).notNull(),
	priority: text().notNull(),
	section: uuid(),
	tags: jsonb(),
	title: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	likes: bigint({ mode: "number" }).default(0),
	user: uuid(),
	taskStatus: taskStatus().default('ACTIVE'),
}, (table) => [
	index("Tasks_createdAt_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("Tasks_createdBy_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("Tasks_dueDateAt_idx").using("btree", table.dueDateAt.asc().nullsLast().op("timestamp_ops")),
	index("Tasks_priority_idx").using("btree", table.priority.asc().nullsLast().op("text_ops")),
	index("Tasks_section_idx").using("btree", table.section.asc().nullsLast().op("uuid_ops")),
	index("Tasks_taskStatus_idx").using("btree", table.taskStatus.asc().nullsLast().op("enum_ops")),
	index("Tasks_updatedBy_idx").using("btree", table.updatedBy.asc().nullsLast().op("uuid_ops")),
	index("Tasks_user_idx").using("btree", table.user.asc().nullsLast().op("uuid_ops")),
	index("Tasks_user_taskStatus_idx").using("btree", table.user.asc().nullsLast().op("uuid_ops"), table.taskStatus.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.user],
			foreignColumns: [users.id],
			name: "Tasks_user_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.section],
			foreignColumns: [sections.id],
			name: "Tasks_section_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const crmIndustryType = pgTable("crm_Industry_Type", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").default(0).notNull(),
	name: text().notNull(),
});

export const systemServices = pgTable("systemServices", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").notNull(),
	name: text().notNull(),
	serviceUrl: text(),
	serviceId: text(),
	serviceKey: text(),
	servicePassword: text(),
	servicePort: text(),
	description: text(),
});

export const employees = pgTable("Employees", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").notNull(),
	avatar: text().notNull(),
	email: text(),
	name: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	salary: bigint({ mode: "number" }).notNull(),
	status: text().notNull(),
});

export const invoices = pgTable("Invoices", {
	id: uuid().primaryKey().notNull(),
	accountId: uuid().notNull(),
	balanceDue: numeric({ precision: 14, scale:  2 }).default('0').notNull(),
	bankAccount: text(),
	bankName: text(),
	baseCurrency: varchar({ length: 3 }),
	billingSnapshot: jsonb(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	createdBy: uuid().notNull(),
	currency: varchar({ length: 3 }).notNull(),
	discountTotal: numeric({ precision: 14, scale:  2 }).default('0').notNull(),
	dueDate: timestamp({ precision: 3, mode: 'string' }),
	fxRateToBase: numeric({ precision: 18, scale:  8 }),
	grandTotal: numeric({ precision: 14, scale:  2 }).default('0').notNull(),
	iban: text(),
	internalNotes: text(),
	issueDate: timestamp({ precision: 3, mode: 'string' }),
	number: text(),
	numberOverridden: boolean().default(false).notNull(),
	originalInvoiceId: uuid(),
	paidTotal: numeric({ precision: 14, scale:  2 }).default('0').notNull(),
	pdfGeneratedAt: timestamp({ precision: 3, mode: 'string' }),
	pdfStorageKey: text(),
	publicNotes: text(),
	searchVector: tsvector("search_vector"),
	seriesId: uuid(),
	subtotal: numeric({ precision: 14, scale:  2 }).default('0').notNull(),
	swift: text(),
	taxableSupplyDate: timestamp({ precision: 3, mode: 'string' }),
	type: invoiceType().default('INVOICE').notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
	variableSymbol: text(),
	vatTotal: numeric({ precision: 14, scale:  2 }).default('0').notNull(),
	status: invoiceStatus().default('DRAFT').notNull(),
}, (table) => [
	index("Invoices_accountId_idx").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("Invoices_createdBy_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("Invoices_dueDate_idx").using("btree", table.dueDate.asc().nullsLast().op("timestamp_ops")),
	index("Invoices_issueDate_idx").using("btree", table.issueDate.asc().nullsLast().op("timestamp_ops")),
	index("Invoices_originalInvoiceId_idx").using("btree", table.originalInvoiceId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("Invoices_seriesId_number_key").using("btree", table.seriesId.asc().nullsLast().op("text_ops"), table.number.asc().nullsLast().op("text_ops")),
	index("Invoices_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "Invoices_createdBy_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.seriesId],
			foreignColumns: [invoiceSeries.id],
			name: "Invoices_seriesId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [crmAccounts.id],
			name: "Invoices_accountId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.currency],
			foreignColumns: [currency.code],
			name: "Invoices_currency_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.originalInvoiceId],
			foreignColumns: [table.id],
			name: "Invoices_originalInvoiceId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const crmTargetContact = pgTable("crm_Target_Contact", {
	id: uuid().primaryKey().notNull(),
	targetId: uuid().notNull(),
	contactId: uuid(),
	name: text(),
	email: text(),
	title: text(),
	phone: text(),
	linkedinUrl: text(),
	source: text().default('manual').notNull(),
	enrichStatus: crmEnrichmentStatus().default('PENDING').notNull(),
	enrichedAt: timestamp({ precision: 3, mode: 'string' }),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
}, (table) => [
	index("crm_Target_Contact_enrichStatus_idx").using("btree", table.enrichStatus.asc().nullsLast().op("enum_ops")),
	uniqueIndex("crm_Target_Contact_targetId_email_key").using("btree", table.targetId.asc().nullsLast().op("uuid_ops"), table.email.asc().nullsLast().op("text_ops")),
	index("crm_Target_Contact_targetId_idx").using("btree", table.targetId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("crm_Target_Contact_targetId_linkedinUrl_key").using("btree", table.targetId.asc().nullsLast().op("text_ops"), table.linkedinUrl.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.targetId],
			foreignColumns: [crmTargets.id],
			name: "crm_Target_Contact_targetId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [crmContacts.id],
			name: "crm_Target_Contact_contactId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const crmEmbeddingsAccounts = pgTable("crm_Embeddings_Accounts", {
	id: uuid().primaryKey().notNull(),
	accountId: uuid("account_id").notNull(),
	embedding: vector({ dimensions: 1536 }).notNull(),
	contentHash: text("content_hash").notNull(),
	embeddedAt: timestamp("embedded_at", { precision: 3, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [crmAccounts.id],
			name: "crm_Embeddings_Accounts_account_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	unique("crm_Embeddings_Accounts_account_id_key").on(table.accountId),
]);

export const users = pgTable("Users", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").default(0).notNull(),
	accountName: text("account_name"),
	avatar: text(),
	email: text().notNull(),
	isAccountAdmin: boolean("is_account_admin").default(false).notNull(),
	isAdmin: boolean("is_admin").default(false).notNull(),
	createdOn: timestamp("created_on", { precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	lastLoginAt: timestamp({ precision: 3, mode: 'string' }),
	name: text(),
	password: text(),
	username: text(),
	userStatus: activeStatus().default('PENDING').notNull(),
	userLanguage: language().default('en').notNull(),
	role: text().default('member').notNull(),
	emailVerified: boolean().default(false).notNull(),
	image: text(),
	updatedAt: timestamp("updated_at", { precision: 3, mode: 'string' }),
	banned: boolean().default(false).notNull(),
	banReason: text(),
	banExpires: timestamp({ precision: 3, mode: 'string' }),
	whatsApp: text("whatsapp"),
}, (table) => [
	index("Users_created_on_idx").using("btree", table.createdOn.asc().nullsLast().op("timestamp_ops")),
	index("Users_email_idx").using("btree", table.email.asc().nullsLast().op("text_ops")),
	uniqueIndex("Users_email_key").using("btree", table.email.asc().nullsLast().op("text_ops")),
	index("Users_is_account_admin_idx").using("btree", table.isAccountAdmin.asc().nullsLast().op("bool_ops")),
	index("Users_is_admin_idx").using("btree", table.isAdmin.asc().nullsLast().op("bool_ops")),
	index("Users_lastLoginAt_idx").using("btree", table.lastLoginAt.asc().nullsLast().op("timestamp_ops")),
	index("Users_userLanguage_idx").using("btree", table.userLanguage.asc().nullsLast().op("enum_ops")),
	index("Users_userStatus_idx").using("btree", table.userStatus.asc().nullsLast().op("enum_ops")),
]);

export const invoiceAttachments = pgTable("Invoice_Attachments", {
	id: uuid().primaryKey().notNull(),
	invoiceId: uuid().notNull(),
	storageKey: text().notNull(),
	filename: text().notNull(),
	mimeType: text().notNull(),
	size: integer().notNull(),
	uploadedBy: uuid().notNull(),
	uploadedAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	isPrimaryPdf: boolean().default(false).notNull(),
}, (table) => [
	index("Invoice_Attachments_invoiceId_idx").using("btree", table.invoiceId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.invoiceId],
			foreignColumns: [invoices.id],
			name: "Invoice_Attachments_invoiceId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.uploadedBy],
			foreignColumns: [users.id],
			name: "Invoice_Attachments_uploadedBy_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const invoiceLineItems = pgTable("Invoice_LineItems", {
	id: uuid().primaryKey().notNull(),
	invoiceId: uuid().notNull(),
	position: integer().notNull(),
	productId: uuid(),
	description: text().notNull(),
	quantity: numeric({ precision: 14, scale:  4 }).notNull(),
	unitPrice: numeric({ precision: 14, scale:  4 }).notNull(),
	discountPercent: numeric({ precision: 5, scale:  2 }).default('0').notNull(),
	taxRateId: uuid(),
	taxRateSnapshot: numeric({ precision: 5, scale:  2 }),
	lineSubtotal: numeric({ precision: 14, scale:  2 }).notNull(),
	lineVat: numeric({ precision: 14, scale:  2 }).notNull(),
	lineTotal: numeric({ precision: 14, scale:  2 }).notNull(),
}, (table) => [
	index("Invoice_LineItems_invoiceId_idx").using("btree", table.invoiceId.asc().nullsLast().op("uuid_ops")),
	index("Invoice_LineItems_productId_idx").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	index("Invoice_LineItems_taxRateId_idx").using("btree", table.taxRateId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.invoiceId],
			foreignColumns: [invoices.id],
			name: "Invoice_LineItems_invoiceId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [crmProducts.id],
			name: "Invoice_LineItems_productId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.taxRateId],
			foreignColumns: [invoiceTaxRates.id],
			name: "Invoice_LineItems_taxRateId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const invoicePayments = pgTable("Invoice_Payments", {
	id: uuid().primaryKey().notNull(),
	invoiceId: uuid().notNull(),
	paidAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
	amount: numeric({ precision: 14, scale:  2 }).notNull(),
	method: text(),
	reference: text(),
	note: text(),
	createdBy: uuid().notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("Invoice_Payments_invoiceId_idx").using("btree", table.invoiceId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.invoiceId],
			foreignColumns: [invoices.id],
			name: "Invoice_Payments_invoiceId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "Invoice_Payments_createdBy_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const crmEmbeddingsOpportunities = pgTable("crm_Embeddings_Opportunities", {
	id: uuid().primaryKey().notNull(),
	opportunityId: uuid("opportunity_id").notNull(),
	embedding: vector({ dimensions: 1536 }).notNull(),
	contentHash: text("content_hash").notNull(),
	embeddedAt: timestamp("embedded_at", { precision: 3, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.opportunityId],
			foreignColumns: [crmOpportunities.id],
			name: "crm_Embeddings_Opportunities_opportunity_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	unique("crm_Embeddings_Opportunities_opportunity_id_key").on(table.opportunityId),
]);

export const apiKeys = pgTable("ApiKeys", {
	id: uuid().primaryKey().notNull(),
	scope: apiKeyScope().notNull(),
	userId: uuid(),
	provider: apiKeyProvider().notNull(),
	encryptedKey: text().notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
}, (table) => [
	index("ApiKeys_scope_provider_idx").using("btree", table.scope.asc().nullsLast().op("enum_ops"), table.provider.asc().nullsLast().op("enum_ops")),
	index("ApiKeys_userId_provider_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.provider.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("api_keys_system_provider_unique").using("btree", table.provider.asc().nullsLast().op("enum_ops")).where(sql`(scope = 'SYSTEM'::"ApiKeyScope")`),
	uniqueIndex("api_keys_user_provider_unique").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.provider.asc().nullsLast().op("uuid_ops")).where(sql`(scope = 'USER'::"ApiKeyScope")`),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "ApiKeys_userId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const apiToken = pgTable("ApiToken", {
	id: uuid().primaryKey().notNull(),
	name: text().notNull(),
	tokenHash: text().notNull(),
	tokenPrefix: varchar({ length: 8 }).notNull(),
	userId: uuid().notNull(),
	expiresAt: timestamp({ precision: 3, mode: 'string' }),
	revokedAt: timestamp({ precision: 3, mode: 'string' }),
	lastUsedAt: timestamp({ precision: 3, mode: 'string' }),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("ApiToken_tokenHash_key").using("btree", table.tokenHash.asc().nullsLast().op("text_ops")),
	index("ApiToken_userId_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "ApiToken_userId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const crmContactEnrichment = pgTable("crm_Contact_Enrichment", {
	id: uuid().primaryKey().notNull(),
	contactId: uuid().notNull(),
	status: crmEnrichmentStatus().default('PENDING').notNull(),
	fields: text().array(),
	result: jsonb(),
	error: text(),
	triggeredBy: uuid(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
}, (table) => [
	index("crm_Contact_Enrichment_contactId_idx").using("btree", table.contactId.asc().nullsLast().op("uuid_ops")),
	index("crm_Contact_Enrichment_createdAt_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Contact_Enrichment_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("crm_Contact_Enrichment_triggeredBy_idx").using("btree", table.triggeredBy.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [crmContacts.id],
			name: "crm_Contact_Enrichment_contactId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.triggeredBy],
			foreignColumns: [users.id],
			name: "crm_Contact_Enrichment_triggeredBy_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const crmEmbeddingsContacts = pgTable("crm_Embeddings_Contacts", {
	id: uuid().primaryKey().notNull(),
	contactId: uuid("contact_id").notNull(),
	embedding: vector({ dimensions: 1536 }).notNull(),
	contentHash: text("content_hash").notNull(),
	embeddedAt: timestamp("embedded_at", { precision: 3, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [crmContacts.id],
			name: "crm_Embeddings_Contacts_contact_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	unique("crm_Embeddings_Contacts_contact_id_key").on(table.contactId),
]);

export const crmEmbeddingsLeads = pgTable("crm_Embeddings_Leads", {
	id: uuid().primaryKey().notNull(),
	leadId: uuid("lead_id").notNull(),
	embedding: vector({ dimensions: 1536 }).notNull(),
	contentHash: text("content_hash").notNull(),
	embeddedAt: timestamp("embedded_at", { precision: 3, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.leadId],
			foreignColumns: [crmLeads.id],
			name: "crm_Embeddings_Leads_lead_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	unique("crm_Embeddings_Leads_lead_id_key").on(table.leadId),
]);

export const invoiceActivity = pgTable("Invoice_Activity", {
	id: uuid().primaryKey().notNull(),
	invoiceId: uuid().notNull(),
	actorId: uuid().notNull(),
	action: text().notNull(),
	meta: jsonb(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("Invoice_Activity_invoiceId_idx").using("btree", table.invoiceId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.invoiceId],
			foreignColumns: [invoices.id],
			name: "Invoice_Activity_invoiceId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [users.id],
			name: "Invoice_Activity_actorId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const invoiceTaxRates = pgTable("Invoice_TaxRates", {
	id: uuid().primaryKey().notNull(),
	name: text().notNull(),
	rate: numeric({ precision: 5, scale:  2 }).notNull(),
	isDefault: boolean().default(false).notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
});

export const invoiceSeries = pgTable("Invoice_Series", {
	id: uuid().primaryKey().notNull(),
	name: text().notNull(),
	prefixTemplate: text().notNull(),
	resetPolicy: text().default('YEARLY').notNull(),
	currentYear: integer(),
	counter: integer().default(0).notNull(),
	isDefault: boolean().default(false).notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
});

export const crmTargetEnrichment = pgTable("crm_Target_Enrichment", {
	id: uuid().primaryKey().notNull(),
	targetId: uuid().notNull(),
	status: crmEnrichmentStatus().default('PENDING').notNull(),
	fields: text().array(),
	result: jsonb(),
	error: text(),
	triggeredBy: uuid(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
}, (table) => [
	index("crm_Target_Enrichment_createdAt_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Target_Enrichment_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("crm_Target_Enrichment_targetId_idx").using("btree", table.targetId.asc().nullsLast().op("uuid_ops")),
	index("crm_Target_Enrichment_triggeredBy_idx").using("btree", table.triggeredBy.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.targetId],
			foreignColumns: [crmTargets.id],
			name: "crm_Target_Enrichment_targetId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.triggeredBy],
			foreignColumns: [users.id],
			name: "crm_Target_Enrichment_triggeredBy_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const crmTargets = pgTable("crm_Targets", {
	id: uuid().primaryKey().notNull(),
	firstName: text("first_name"),
	lastName: text("last_name").notNull(),
	email: text(),
	mobilePhone: text("mobile_phone"),
	officePhone: text("office_phone"),
	company: text(),
	companyWebsite: text("company_website"),
	personalWebsite: text("personal_website"),
	position: text(),
	socialX: text("social_x"),
	socialLinkedin: text("social_linkedin"),
	socialInstagram: text("social_instagram"),
	socialFacebook: text("social_facebook"),
	status: boolean().default(true).notNull(),
	tags: text().array(),
	notes: text().array(),
	createdBy: uuid("created_by"),
	createdOn: timestamp("created_on", { precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp({ precision: 3, mode: 'string' }),
	updatedBy: uuid(),
	personalEmail: text("personal_email"),
	companyEmail: text("company_email"),
	companyPhone: text("company_phone"),
	city: text(),
	country: text(),
	industry: text(),
	employees: text(),
	description: text(),
	convertedAt: timestamp("converted_at", { precision: 3, mode: 'string' }),
	convertedAccountId: uuid("converted_account_id"),
	convertedContactId: uuid("converted_contact_id"),
	deletedAt: timestamp({ precision: 3, mode: 'string' }),
	deletedBy: uuid(),
}, (table) => [
	index("crm_Targets_converted_account_id_idx").using("btree", table.convertedAccountId.asc().nullsLast().op("uuid_ops")),
	index("crm_Targets_converted_contact_id_idx").using("btree", table.convertedContactId.asc().nullsLast().op("uuid_ops")),
	index("crm_Targets_created_by_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("crm_Targets_created_on_idx").using("btree", table.createdOn.asc().nullsLast().op("timestamp_ops")),
	index("crm_Targets_deletedAt_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Targets_status_idx").using("btree", table.status.asc().nullsLast().op("bool_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "crm_Targets_created_by_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.convertedAccountId],
			foreignColumns: [crmAccounts.id],
			name: "crm_Targets_converted_account_id_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.convertedContactId],
			foreignColumns: [crmContacts.id],
			name: "crm_Targets_converted_contact_id_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const crmTargetLists = pgTable("crm_TargetLists", {
	id: uuid().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	status: boolean().default(true).notNull(),
	createdBy: uuid("created_by"),
	createdOn: timestamp("created_on", { precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp({ precision: 3, mode: 'string' }),
	deletedAt: timestamp({ precision: 3, mode: 'string' }),
	deletedBy: uuid(),
}, (table) => [
	index("crm_TargetLists_created_by_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("crm_TargetLists_deletedAt_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_TargetLists_status_idx").using("btree", table.status.asc().nullsLast().op("bool_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "crm_TargetLists_created_by_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const crmCampaignSteps = pgTable("crm_campaign_steps", {
	id: uuid().primaryKey().notNull(),
	campaignId: uuid("campaign_id").notNull(),
	order: integer().notNull(),
	templateId: uuid("template_id").notNull(),
	subject: text().notNull(),
	delayDays: integer("delay_days").default(0).notNull(),
	sendTo: text("send_to").default('all').notNull(),
	scheduledAt: timestamp("scheduled_at", { precision: 3, mode: 'string' }),
	sentAt: timestamp("sent_at", { precision: 3, mode: 'string' }),
}, (table) => [
	index("crm_campaign_steps_campaign_id_idx").using("btree", table.campaignId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("crm_campaign_steps_campaign_id_order_key").using("btree", table.campaignId.asc().nullsLast().op("int4_ops"), table.order.asc().nullsLast().op("int4_ops")),
	index("crm_campaign_steps_scheduled_at_idx").using("btree", table.scheduledAt.asc().nullsLast().op("timestamp_ops")),
	foreignKey({
			columns: [table.campaignId],
			foreignColumns: [crmCampaigns.id],
			name: "crm_campaign_steps_campaign_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.templateId],
			foreignColumns: [crmCampaignTemplates.id],
			name: "crm_campaign_steps_template_id_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const crmCampaignSends = pgTable("crm_campaign_sends", {
	id: uuid().primaryKey().notNull(),
	campaignId: uuid("campaign_id").notNull(),
	stepId: uuid("step_id").notNull(),
	targetId: uuid("target_id").notNull(),
	email: text().notNull(),
	status: text().default('queued').notNull(),
	resendMessageId: text("resend_message_id"),
	unsubscribeToken: text("unsubscribe_token").notNull(),
	openedAt: timestamp("opened_at", { precision: 3, mode: 'string' }),
	clickedAt: timestamp("clicked_at", { precision: 3, mode: 'string' }),
	unsubscribedAt: timestamp("unsubscribed_at", { precision: 3, mode: 'string' }),
	errorMessage: text("error_message"),
	sentAt: timestamp("sent_at", { precision: 3, mode: 'string' }),
}, (table) => [
	index("crm_campaign_sends_campaign_id_idx").using("btree", table.campaignId.asc().nullsLast().op("uuid_ops")),
	index("crm_campaign_sends_resend_message_id_idx").using("btree", table.resendMessageId.asc().nullsLast().op("text_ops")),
	index("crm_campaign_sends_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("crm_campaign_sends_step_id_target_id_idx").using("btree", table.stepId.asc().nullsLast().op("uuid_ops"), table.targetId.asc().nullsLast().op("uuid_ops")),
	uniqueIndex("crm_campaign_sends_step_id_target_id_key").using("btree", table.stepId.asc().nullsLast().op("uuid_ops"), table.targetId.asc().nullsLast().op("uuid_ops")),
	index("crm_campaign_sends_unsubscribe_token_idx").using("btree", table.unsubscribeToken.asc().nullsLast().op("text_ops")),
	uniqueIndex("crm_campaign_sends_unsubscribe_token_key").using("btree", table.unsubscribeToken.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.campaignId],
			foreignColumns: [crmCampaigns.id],
			name: "crm_campaign_sends_campaign_id_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.stepId],
			foreignColumns: [crmCampaignSteps.id],
			name: "crm_campaign_sends_step_id_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.targetId],
			foreignColumns: [crmTargets.id],
			name: "crm_campaign_sends_target_id_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const crmCampaignTemplates = pgTable("crm_campaign_templates", {
	id: uuid().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	subjectDefault: text("subject_default"),
	contentHtml: text("content_html").notNull(),
	contentJson: jsonb("content_json").notNull(),
	createdBy: uuid("created_by"),
	createdOn: timestamp("created_on", { precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp({ precision: 3, mode: 'string' }),
	deletedAt: timestamp({ precision: 3, mode: 'string' }),
	deletedBy: uuid(),
}, (table) => [
	index("crm_campaign_templates_created_by_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("crm_campaign_templates_deletedAt_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamp_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "crm_campaign_templates_created_by_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const crmCampaigns = pgTable("crm_campaigns", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").notNull(),
	name: text().notNull(),
	description: text(),
	status: text(),
	templateId: uuid("template_id"),
	fromName: text("from_name"),
	replyTo: text("reply_to"),
	scheduledAt: timestamp("scheduled_at", { precision: 3, mode: 'string' }),
	sentAt: timestamp("sent_at", { precision: 3, mode: 'string' }),
	createdBy: uuid("created_by"),
	createdOn: timestamp("created_on", { precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp({ precision: 3, mode: 'string' }),
	deletedAt: timestamp({ precision: 3, mode: 'string' }),
	deletedBy: uuid(),
}, (table) => [
	index("crm_campaigns_deletedAt_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamp_ops")),
	foreignKey({
			columns: [table.templateId],
			foreignColumns: [crmCampaignTemplates.id],
			name: "crm_campaigns_template_id_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "crm_campaigns_created_by_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const emailAccount = pgTable("EmailAccount", {
	id: uuid().primaryKey().notNull(),
	userId: uuid().notNull(),
	label: text().notNull(),
	imapHost: text().notNull(),
	imapPort: integer().notNull(),
	imapSsl: boolean().default(true).notNull(),
	smtpHost: text().notNull(),
	smtpPort: integer().notNull(),
	smtpSsl: boolean().default(true).notNull(),
	username: text().notNull(),
	passwordEncrypted: text().notNull(),
	isActive: boolean().default(true).notNull(),
	sentFolderName: text().default('Sent').notNull(),
	lastSyncedAt: timestamp({ precision: 3, mode: 'string' }),
	inboxLastUid: integer(),
	sentLastUid: integer(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
}, (table) => [
	index("EmailAccount_isActive_idx").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
	index("EmailAccount_userId_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "EmailAccount_userId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const email = pgTable("Email", {
	id: uuid().primaryKey().notNull(),
	emailAccountId: uuid().notNull(),
	userId: uuid().notNull(),
	rfcMessageId: text().notNull(),
	imapUid: integer(),
	folder: emailFolder().notNull(),
	subject: text(),
	fromName: text(),
	fromEmail: text(),
	toRecipients: jsonb().default([]).notNull(),
	ccRecipients: jsonb().default([]).notNull(),
	bccRecipients: jsonb().default([]).notNull(),
	bodyText: text(),
	bodyHtml: text(),
	sentAt: timestamp({ precision: 3, mode: 'string' }),
	isRead: boolean().default(false).notNull(),
	isDeleted: boolean().default(false).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("Email_emailAccountId_idx").using("btree", table.emailAccountId.asc().nullsLast().op("uuid_ops")),
	index("Email_folder_idx").using("btree", table.folder.asc().nullsLast().op("enum_ops")),
	index("Email_isDeleted_idx").using("btree", table.isDeleted.asc().nullsLast().op("bool_ops")),
	index("Email_sentAt_idx").using("btree", table.sentAt.asc().nullsLast().op("timestamp_ops")),
	index("Email_userId_folder_isDeleted_isRead_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.folder.asc().nullsLast().op("bool_ops"), table.isDeleted.asc().nullsLast().op("enum_ops"), table.isRead.asc().nullsLast().op("enum_ops")),
	index("Email_userId_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.emailAccountId],
			foreignColumns: [emailAccount.id],
			name: "Email_emailAccountId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "Email_userId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	unique("Email_emailAccountId_rfcMessageId_key").on(table.emailAccountId, table.rfcMessageId),
]);

export const emailEmbedding = pgTable("EmailEmbedding", {
	id: uuid().primaryKey().notNull(),
	emailId: uuid().notNull(),
	embedding: vector({ dimensions: 1536 }).notNull(),
	contentHash: text().notNull(),
	embeddedAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.emailId],
			foreignColumns: [email.id],
			name: "EmailEmbedding_emailId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	unique("EmailEmbedding_emailId_key").on(table.emailId),
]);

export const crmContactTypes = pgTable("crm_Contact_Types", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").default(0).notNull(),
	name: text().notNull(),
}, (table) => [
	index("crm_Contact_Types_name_idx").using("btree", table.name.asc().nullsLast().op("text_ops")),
	unique("crm_Contact_Types_name_key").on(table.name),
]);

export const crmLeadSources = pgTable("crm_Lead_Sources", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").default(0).notNull(),
	name: text().notNull(),
}, (table) => [
	index("crm_Lead_Sources_name_idx").using("btree", table.name.asc().nullsLast().op("text_ops")),
	unique("crm_Lead_Sources_name_key").on(table.name),
]);

export const crmLeadStatuses = pgTable("crm_Lead_Statuses", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").default(0).notNull(),
	name: text().notNull(),
}, (table) => [
	index("crm_Lead_Statuses_name_idx").using("btree", table.name.asc().nullsLast().op("text_ops")),
	unique("crm_Lead_Statuses_name_key").on(table.name),
]);

export const crmLeadTypes = pgTable("crm_Lead_Types", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").default(0).notNull(),
	name: text().notNull(),
}, (table) => [
	index("crm_Lead_Types_name_idx").using("btree", table.name.asc().nullsLast().op("text_ops")),
	unique("crm_Lead_Types_name_key").on(table.name),
]);

export const crmLeads = pgTable("crm_Leads", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").default(0).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	createdBy: uuid(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }),
	updatedBy: uuid(),
	firstName: text(),
	lastName: text().notNull(),
	company: text(),
	jobTitle: text(),
	email: text(),
	phone: text(),
	description: text(),
	referedBy: text("refered_by"),
	campaign: text(),
	assignedTo: uuid("assigned_to"),
	accountsIds: uuid("accountsIDs"),
	leadSourceId: uuid("lead_source_id"),
	leadStatusId: uuid("lead_status_id"),
	leadTypeId: uuid("lead_type_id"),
	deletedAt: timestamp({ precision: 3, mode: 'string' }),
	deletedBy: uuid(),
	// --- NuraView Upwork ingestion columns (added via scripts/migrate-nuraview.ts)
	upworkJobUrl: text("upwork_job_url"),
	upworkJobId: text("upwork_job_id"),
	extractedAt: timestamp("extracted_at", { precision: 3, mode: 'string' }),
	sourcePayload: jsonb("source_payload"),
	highlightedAt: timestamp("highlighted_at", { precision: 3, mode: 'string' }),
	highlightedBy: uuid("highlighted_by"),
	lastContactedAt: timestamp("last_contacted_at", { precision: 3, mode: 'string' }),
	lastContactedBy: uuid("last_contacted_by"),
	reminderAt: timestamp("reminder_at", { precision: 3, mode: 'string' }),
	reminderSentAt: timestamp("reminder_sent_at", { precision: 3, mode: 'string' }),
	// First-send anchor + auto-followup flag (Apr 2026 client ask).
	// firstSentAt: when the *first* WhatsApp went out for the current cycle.
	//   The Kanban Reminders column keeps the card visible for 24h after
	//   this so reviewers can do multiple follow-ups on the same lead.
	//   Reset to null when the user starts a fresh cycle (sets a new
	//   reminderAt) — so the cron treats the next fire as a "first send"
	//   again.
	// followupPending: true after a first send, until either the auto
	//   +6h follow-up fires OR the user takes any action (set new
	//   reminder, cancel).
	reminderFirstSentAt: timestamp("reminder_first_sent_at", { precision: 3, mode: 'string' }),
	reminderFollowupPending: boolean("reminder_followup_pending").default(false).notNull(),
	reminderNote: text("reminder_note"),
	// Which paired WhatsApp account the reminder for this lead sends from
	// (matches whatsapp_session.account). NULL = the default 'primary'
	// account, so existing leads keep their current behaviour.
	reminderAccount: text("reminder_account"),
	hasClientInfo: boolean("has_client_info"),
	// When the CLIENT posted the job on Upwork — parsed from the scraper's
	// relative time string ("5 hours ago", "13 minutes ago") at ingest time.
	// More meaningful for reviewers than `extractedAt` (= when WE scraped)
	// because Upwork leads go stale fast.
	postedAt: timestamp("posted_at", { precision: 3, mode: 'string' }),
	// Manual contact fields — added per client ask (Apr 2026). Reviewers
	// copy/paste these from LinkedIn / job comments / etc. while triaging
	// leads. `email` / `phone` (above) are treated as primary; these are
	// the secondary slots plus a dedicated LinkedIn URL.
	linkedinUrl: text("linkedin_url"),
	emailSecondary: text("email_secondary"),
	phoneSecondary: text("phone_secondary"),
	// Cap share URL (self-hosted Loom replacement, apps/cap). Recorded per
	// lead and embedded as a GIF thumbnail card in outreach emails.
	videoLink: text("video_link"),
	// "Irrelevant" mark — reviewer says "this lead is not even our service"
	// (e.g. UGC requests landing in a graphic-design pipeline). Hidden from
	// the default list / kanban / stats. The reason is the AI training
	// signal we want to capture for later (auto-mark via Gemini).
	irrelevantAt: timestamp("irrelevant_at", { precision: 3, mode: 'string' }),
	irrelevantBy: uuid("irrelevant_by"),
	irrelevantReason: text("irrelevant_reason"),
	// Lead enrichment status — set by the enrichLead Inngest pipeline.
	// Used by the list view to show a badge ("enriched" / "failed" / "running")
	// and by the auto-trigger to skip already-enriched rows. The audit trail
	// (per-run results, costs, raw provider responses) lives in the
	// crm_Lead_Enrichment table; these two columns are the cheap projection.
	enrichmentStatus: crmEnrichmentStatus("enrichment_status"),
	enrichedAt: timestamp("enriched_at", { precision: 3, mode: 'string' }),
	// AI-generated email draft — persisted so the reviewer can navigate
	// away and come back without losing the generated content. Written by
	// the Generate Email button in the lead drawer, cleared on successful
	// send (or re-generated to overwrite).
	generatedEmailSubject: text("generated_email_subject"),
	generatedEmailBody: text("generated_email_body"),
	// Snapshot of the email actually SENT to this lead, captured at send time
	// in /api/leads/[id]/send-email. The generated_email_* draft above is wiped
	// on a successful send, and the marketing email tables store no CC and
	// aren't linked back to the lead — so these columns are the only per-lead
	// record of what went out. Surfaced on the Kanban "Taken care" card.
	sentEmailSubject: text("sent_email_subject"),
	sentEmailBody: text("sent_email_body"),
	sentEmailTo: text("sent_email_to"),
	sentEmailCc: text("sent_email_cc"),
}, (table) => [
	index("crm_Leads_accountsIDs_idx").using("btree", table.accountsIds.asc().nullsLast().op("uuid_ops")),
	index("crm_Leads_assigned_to_idx").using("btree", table.assignedTo.asc().nullsLast().op("uuid_ops")),
	index("crm_Leads_createdAt_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Leads_createdBy_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("crm_Leads_deletedAt_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Leads_lead_source_id_idx").using("btree", table.leadSourceId.asc().nullsLast().op("uuid_ops")),
	index("crm_Leads_lead_status_id_idx").using("btree", table.leadStatusId.asc().nullsLast().op("uuid_ops")),
	index("crm_Leads_lead_type_id_idx").using("btree", table.leadTypeId.asc().nullsLast().op("uuid_ops")),
	index("crm_Leads_updatedBy_idx").using("btree", table.updatedBy.asc().nullsLast().op("uuid_ops")),
	// Partial index on the irrelevant archive — small subset (only marked
	// rows) so it stays cheap while making the "Irrelevant" tab query fast.
	index("crm_Leads_irrelevant_at_idx")
		.using("btree", table.irrelevantAt.asc().nullsLast().op("timestamp_ops"))
		.where(sql`irrelevant_at IS NOT NULL`),
	// Partial unique index — required by the upwork ingest endpoint's
	// `ON CONFLICT (upwork_job_url) WHERE upwork_job_url IS NOT NULL` upsert.
	// Without this index, every scrape forward returns HTTP 500 because
	// Postgres raises "no unique constraint matching ON CONFLICT".
	uniqueIndex("crm_Leads_upwork_job_url_unique")
		.on(table.upworkJobUrl)
		.where(sql`upwork_job_url IS NOT NULL`),
	// Stable Upwork job ID dedup. The scraper sometimes produces two
	// different URL slugs for the same job (Upwork's HTML highlight
	// markup leaks into the href on search-result pages, producing
	// e.g. ".../Mobile-app-explainer-video_~02XXX/" vs
	// ".../Mobile-app-span-class-highlight-explainer-span-..._~02XXX/").
	// The trailing ~02XXX is the canonical job ID — using it as the
	// dedup key prevents the same job from inserting twice.
	//
	// TEMPORARILY non-unique (Apr 2026): production data has 43 dup pairs
	// from before the URL-slug normalization landed; making this UNIQUE
	// would fail to apply via drizzle-kit push. Re-promote to uniqueIndex
	// after a one-shot dedup script removes the duplicates and the
	// upwork-ingest route is verified to not produce new ones.
	index("crm_Leads_upwork_job_id_unique")
		.on(table.upworkJobId)
		.where(sql`upwork_job_id IS NOT NULL`),
	foreignKey({
			columns: [table.assignedTo],
			foreignColumns: [users.id],
			name: "crm_Leads_assigned_to_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.irrelevantBy],
			foreignColumns: [users.id],
			name: "crm_Leads_irrelevant_by_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.accountsIds],
			foreignColumns: [crmAccounts.id],
			name: "crm_Leads_accountsIDs_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.leadSourceId],
			foreignColumns: [crmLeadSources.id],
			name: "crm_Leads_lead_source_id_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.leadStatusId],
			foreignColumns: [crmLeadStatuses.id],
			name: "crm_Leads_lead_status_id_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.leadTypeId],
			foreignColumns: [crmLeadTypes.id],
			name: "crm_Leads_lead_type_id_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

// Audit log for lead enrichment runs. Mirrors crm_Contact_Enrichment shape
// but with two extras the lead pipeline needs:
//   - mode: distinguishes auto-on-ingest from manual click and Deep-enrich
//     (Deep-enrich adds a phone-find step + escalates to the E2B agent on
//     waterfall miss; cost ~10× a normal run).
//   - costUsd: rolling per-run cost tally so the daily-budget guard can
//     check the last-24h sum and SKIP_BUDGET when over the cap.
export const crmLeadEnrichment = pgTable("crm_Lead_Enrichment", {
	id: uuid().primaryKey().notNull(),
	leadId: uuid().notNull(),
	status: crmEnrichmentStatus().default('PENDING').notNull(),
	mode: text(), // "auto" | "manual" | "deep"
	fields: text().array(),
	result: jsonb(),
	costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).default('0'),
	error: text(),
	triggeredBy: uuid(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
}, (table) => [
	index("crm_Lead_Enrichment_leadId_idx").using("btree", table.leadId.asc().nullsLast().op("uuid_ops")),
	index("crm_Lead_Enrichment_createdAt_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Lead_Enrichment_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("crm_Lead_Enrichment_triggeredBy_idx").using("btree", table.triggeredBy.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.leadId],
			foreignColumns: [crmLeads.id],
			name: "crm_Lead_Enrichment_leadId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.triggeredBy],
			foreignColumns: [users.id],
			name: "crm_Lead_Enrichment_triggeredBy_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const invoiceSettings = pgTable("Invoice_Settings", {
	id: uuid().primaryKey().notNull(),
	baseCurrency: varchar({ length: 3 }).notNull(),
	defaultSeriesId: uuid(),
	defaultTaxRateId: uuid(),
	defaultDueDays: integer().default(14).notNull(),
	bankName: text(),
	bankAccount: text(),
	iban: text(),
	swift: text(),
	footerText: text(),
	companyName: text(),
	companyAddress: text(),
	companyCity: text(),
	companyZip: text(),
	companyCountry: text(),
	companyVatId: text(),
	companyTaxId: text(),
	companyRegNo: text(),
	companyEmail: text(),
	companyPhone: text(),
	companyWebsite: text(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.defaultSeriesId],
			foreignColumns: [invoiceSeries.id],
			name: "Invoice_Settings_defaultSeriesId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.defaultTaxRateId],
			foreignColumns: [invoiceTaxRates.id],
			name: "Invoice_Settings_defaultTaxRateId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const crmActivityLinks = pgTable("crm_ActivityLinks", {
	id: uuid().primaryKey().notNull(),
	activityId: uuid().notNull(),
	entityType: text().notNull(),
	entityId: uuid().notNull(),
}, (table) => [
	index("crm_ActivityLinks_activityId_idx").using("btree", table.activityId.asc().nullsLast().op("uuid_ops")),
	index("crm_ActivityLinks_entityType_entityId_activityId_idx").using("btree", table.entityType.asc().nullsLast().op("text_ops"), table.entityId.asc().nullsLast().op("uuid_ops"), table.activityId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.activityId],
			foreignColumns: [crmActivities.id],
			name: "crm_ActivityLinks_activityId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const crmAuditLog = pgTable("crm_AuditLog", {
	id: uuid().primaryKey().notNull(),
	entityType: text().notNull(),
	entityId: uuid().notNull(),
	action: crmAuditLogAction().notNull(),
	changes: jsonb(),
	userId: uuid(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("crm_AuditLog_createdAt_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_AuditLog_entityType_createdAt_idx").using("btree", table.entityType.asc().nullsLast().op("text_ops"), table.createdAt.asc().nullsLast().op("text_ops")),
	index("crm_AuditLog_entityType_entityId_createdAt_idx").using("btree", table.entityType.asc().nullsLast().op("text_ops"), table.entityId.asc().nullsLast().op("timestamp_ops"), table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_AuditLog_userId_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "crm_AuditLog_userId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const crmReportConfig = pgTable("crm_Report_Config", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	category: text().notNull(),
	filters: jsonb().notNull(),
	isShared: boolean().default(false).notNull(),
	createdBy: uuid().notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
}, (table) => [
	index("crm_Report_Config_category_idx").using("btree", table.category.asc().nullsLast().op("text_ops")),
	index("crm_Report_Config_createdBy_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("crm_Report_Config_isShared_idx").using("btree", table.isShared.asc().nullsLast().op("bool_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "crm_Report_Config_createdBy_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const crmReportSchedule = pgTable("crm_Report_Schedule", {
	id: text().primaryKey().notNull(),
	reportConfigId: text().notNull(),
	cronExpression: text().notNull(),
	recipients: jsonb().notNull(),
	format: text().notNull(),
	isActive: boolean().default(true).notNull(),
	lastSentAt: timestamp({ precision: 3, mode: 'string' }),
	createdBy: uuid().notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
}, (table) => [
	index("crm_Report_Schedule_createdBy_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("crm_Report_Schedule_isActive_idx").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
	index("crm_Report_Schedule_lastSentAt_idx").using("btree", table.lastSentAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Report_Schedule_reportConfigId_idx").using("btree", table.reportConfigId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.reportConfigId],
			foreignColumns: [crmReportConfig.id],
			name: "crm_Report_Schedule_reportConfigId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "crm_Report_Schedule_createdBy_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const session = pgTable("session", {
	id: text().primaryKey().notNull(),
	expiresAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
	token: text().notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
	ipAddress: text(),
	userAgent: text(),
	userId: uuid().notNull(),
}, (table) => [
	uniqueIndex("session_token_key").using("btree", table.token.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "session_userId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const crmActivities = pgTable("crm_Activities", {
	id: uuid().primaryKey().notNull(),
	type: crmActivityType().notNull(),
	title: text().notNull(),
	description: text(),
	date: timestamp({ precision: 3, mode: 'string' }).notNull(),
	duration: integer(),
	outcome: text(),
	status: crmActivityStatus().default('scheduled').notNull(),
	metadata: jsonb(),
	createdBy: uuid(),
	updatedBy: uuid(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }),
	deletedAt: timestamp({ precision: 3, mode: 'string' }),
	deletedBy: uuid(),
}, (table) => [
	index("crm_Activities_createdAt_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Activities_createdBy_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("crm_Activities_date_idx").using("btree", table.date.asc().nullsLast().op("timestamp_ops")),
	index("crm_Activities_deletedAt_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Activities_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("crm_Activities_type_idx").using("btree", table.type.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "crm_Activities_createdBy_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.updatedBy],
			foreignColumns: [users.id],
			name: "crm_Activities_updatedBy_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const documents = pgTable("Documents", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v"),
	dateCreated: timestamp("date_created", { precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	lastUpdated: timestamp("last_updated", { precision: 3, mode: 'string' }),
	updatedAt: timestamp({ precision: 3, mode: 'string' }),
	documentName: text("document_name").notNull(),
	createdByUser: uuid("created_by_user"),
	createdBy: uuid(),
	description: text(),
	documentType: uuid("document_type"),
	favourite: boolean(),
	documentFileMimeType: text("document_file_mimeType").notNull(),
	documentFileUrl: text("document_file_url").notNull(),
	status: text(),
	visibility: text(),
	tags: jsonb(),
	key: text(),
	size: integer(),
	assignedUser: uuid("assigned_user"),
	connectedDocuments: text("connected_documents").array(),
	documentSystemType: documentSystemType("document_system_type").default('OTHER'),
	contentText: text("content_text"),
	summary: text(),
	contentHash: text("content_hash"),
	thumbnailUrl: text("thumbnail_url"),
	processingStatus: documentProcessingStatus("processing_status").default('PENDING').notNull(),
	processingError: text("processing_error"),
	version: integer().default(1).notNull(),
	parentDocumentId: uuid("parent_document_id"),
	deletedAt: timestamp({ precision: 3, mode: 'string' }),
	deletedBy: uuid(),
}, (table) => [
	index("Documents_assigned_user_idx").using("btree", table.assignedUser.asc().nullsLast().op("uuid_ops")),
	index("Documents_content_hash_idx").using("btree", table.contentHash.asc().nullsLast().op("text_ops")),
	index("Documents_createdAt_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("Documents_createdBy_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("Documents_created_by_user_idx").using("btree", table.createdByUser.asc().nullsLast().op("uuid_ops")),
	index("Documents_deletedAt_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamp_ops")),
	index("Documents_document_system_type_idx").using("btree", table.documentSystemType.asc().nullsLast().op("enum_ops")),
	index("Documents_document_type_idx").using("btree", table.documentType.asc().nullsLast().op("uuid_ops")),
	index("Documents_favourite_idx").using("btree", table.favourite.asc().nullsLast().op("bool_ops")),
	index("Documents_parent_document_id_idx").using("btree", table.parentDocumentId.asc().nullsLast().op("uuid_ops")),
	index("Documents_processing_status_idx").using("btree", table.processingStatus.asc().nullsLast().op("enum_ops")),
	index("Documents_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	index("Documents_visibility_idx").using("btree", table.visibility.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.createdByUser],
			foreignColumns: [users.id],
			name: "Documents_created_by_user_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.assignedUser],
			foreignColumns: [users.id],
			name: "Documents_assigned_user_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.documentType],
			foreignColumns: [documentsTypes.id],
			name: "Documents_document_type_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.parentDocumentId],
			foreignColumns: [table.id],
			name: "Documents_parent_document_id_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const account = pgTable("account", {
	id: text().primaryKey().notNull(),
	accountId: text().notNull(),
	providerId: text().notNull(),
	userId: uuid().notNull(),
	accessToken: text(),
	refreshToken: text(),
	idToken: text(),
	accessTokenExpiresAt: timestamp({ precision: 3, mode: 'string' }),
	refreshTokenExpiresAt: timestamp({ precision: 3, mode: 'string' }),
	scope: text(),
	password: text(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "account_userId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const crmEmbeddingsDocuments = pgTable("crm_Embeddings_Documents", {
	id: uuid().primaryKey().notNull(),
	documentId: uuid("document_id").notNull(),
	embedding: vector({ dimensions: 1536 }).notNull(),
	contentHash: text("content_hash").notNull(),
	embeddedAt: timestamp("embedded_at", { precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("crm_Embeddings_Documents_document_id_key").using("btree", table.documentId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.documentId],
			foreignColumns: [documents.id],
			name: "crm_Embeddings_Documents_document_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const crmDocumentChunks = pgTable("crm_Document_Chunks", {
	id: uuid().primaryKey().notNull(),
	documentId: uuid("document_id").notNull(),
	chunkIndex: integer("chunk_index").notNull(),
	chunkText: text("chunk_text").notNull(),
	embedding: vector({ dimensions: 1536 }).notNull(),
	embeddedAt: timestamp("embedded_at", { precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("crm_Document_Chunks_document_id_idx").using("btree", table.documentId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.documentId],
			foreignColumns: [documents.id],
			name: "crm_Document_Chunks_document_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const crmSystemSettings = pgTable("crm_SystemSettings", {
	key: text().primaryKey().notNull(),
	value: text().notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
});

export const verification = pgTable("verification", {
	id: uuid().primaryKey().notNull(),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	updatedAt: timestamp({ precision: 3, mode: 'string' }),
});

export const crmOpportunities = pgTable("crm_Opportunities", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").default(0).notNull(),
	account: uuid(),
	assignedTo: uuid("assigned_to"),
	budget: numeric({ precision: 18, scale:  2 }).default('0').notNull(),
	campaign: uuid(),
	closeDate: timestamp("close_date", { precision: 3, mode: 'string' }),
	contact: uuid(),
	// NOTE: same `created_by` vs `createdBy` quirk as `crm_Contacts` above —
	// rename the snake column's JS property. Re-apply after `pnpm db:pull`.
	created_by: uuid("created_by"),
	createdBy: uuid(),
	createdOn: timestamp("created_on", { precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	lastActivity: timestamp("last_activity", { precision: 3, mode: 'string' }),
	updatedAt: timestamp({ precision: 3, mode: 'string' }),
	updatedBy: uuid(),
	lastActivityBy: uuid("last_activity_by"),
	currency: varchar({ length: 3 }),
	description: text(),
	expectedRevenue: numeric("expected_revenue", { precision: 18, scale:  2 }).default('0').notNull(),
	name: text(),
	nextStep: text("next_step"),
	salesStage: uuid("sales_stage"),
	type: uuid(),
	status: crmOpportunityStatus().default('ACTIVE'),
	deletedAt: timestamp({ precision: 3, mode: 'string' }),
	deletedBy: uuid(),
	snapshotRate: numeric("snapshot_rate", { precision: 18, scale:  8 }),
}, (table) => [
	index("crm_Opportunities_account_idx").using("btree", table.account.asc().nullsLast().op("uuid_ops")),
	index("crm_Opportunities_assigned_to_idx").using("btree", table.assignedTo.asc().nullsLast().op("uuid_ops")),
	index("crm_Opportunities_campaign_idx").using("btree", table.campaign.asc().nullsLast().op("uuid_ops")),
	index("crm_Opportunities_close_date_idx").using("btree", table.closeDate.asc().nullsLast().op("timestamp_ops")),
	index("crm_Opportunities_contact_idx").using("btree", table.contact.asc().nullsLast().op("uuid_ops")),
	index("crm_Opportunities_createdAt_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Opportunities_created_by_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("crm_Opportunities_deletedAt_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Opportunities_sales_stage_idx").using("btree", table.salesStage.asc().nullsLast().op("uuid_ops")),
	index("crm_Opportunities_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("crm_Opportunities_status_sales_stage_idx").using("btree", table.status.asc().nullsLast().op("enum_ops"), table.salesStage.asc().nullsLast().op("uuid_ops")),
	index("crm_Opportunities_type_idx").using("btree", table.type.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.type],
			foreignColumns: [crmOpportunitiesType.id],
			name: "crm_Opportunities_type_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.salesStage],
			foreignColumns: [crmOpportunitiesSalesStages.id],
			name: "crm_Opportunities_sales_stage_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.assignedTo],
			foreignColumns: [users.id],
			name: "crm_Opportunities_assigned_to_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "crm_Opportunities_created_by_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.account],
			foreignColumns: [crmAccounts.id],
			name: "crm_Opportunities_account_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.campaign],
			foreignColumns: [crmCampaigns.id],
			name: "crm_Opportunities_campaign_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.currency],
			foreignColumns: [currency.code],
			name: "crm_Opportunities_currency_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const crmContracts = pgTable("crm_Contracts", {
	id: uuid().primaryKey().notNull(),
	v: integer("__v").notNull(),
	title: text().notNull(),
	value: numeric({ precision: 18, scale:  2 }).notNull(),
	startDate: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	endDate: timestamp({ precision: 3, mode: 'string' }),
	renewalReminderDate: timestamp({ precision: 3, mode: 'string' }),
	customerSignedDate: timestamp({ precision: 3, mode: 'string' }),
	companySignedDate: timestamp({ precision: 3, mode: 'string' }),
	description: text(),
	account: uuid(),
	assignedTo: uuid("assigned_to"),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`),
	createdBy: uuid(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }),
	updatedBy: uuid(),
	status: crmContractsStatus().default('NOTSTARTED').notNull(),
	type: text(),
	deletedAt: timestamp({ precision: 3, mode: 'string' }),
	deletedBy: uuid(),
	currency: varchar({ length: 3 }),
	snapshotRate: numeric("snapshot_rate", { precision: 18, scale:  8 }),
}, (table) => [
	index("crm_Contracts_account_idx").using("btree", table.account.asc().nullsLast().op("uuid_ops")),
	index("crm_Contracts_assigned_to_idx").using("btree", table.assignedTo.asc().nullsLast().op("uuid_ops")),
	index("crm_Contracts_createdAt_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Contracts_createdBy_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("crm_Contracts_deletedAt_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamp_ops")),
	index("crm_Contracts_endDate_idx").using("btree", table.endDate.asc().nullsLast().op("timestamp_ops")),
	index("crm_Contracts_startDate_endDate_idx").using("btree", table.startDate.asc().nullsLast().op("timestamp_ops"), table.endDate.asc().nullsLast().op("timestamp_ops")),
	index("crm_Contracts_startDate_idx").using("btree", table.startDate.asc().nullsLast().op("timestamp_ops")),
	index("crm_Contracts_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("crm_Contracts_updatedBy_idx").using("btree", table.updatedBy.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.account],
			foreignColumns: [crmAccounts.id],
			name: "crm_Contracts_account_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.assignedTo],
			foreignColumns: [users.id],
			name: "crm_Contracts_assigned_to_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.currency],
			foreignColumns: [currency.code],
			name: "crm_Contracts_currency_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const currency = pgTable("Currency", {
	code: varchar({ length: 3 }).primaryKey().notNull(),
	name: text().notNull(),
	symbol: varchar({ length: 5 }).notNull(),
	isEnabled: boolean().default(true).notNull(),
	isDefault: boolean().default(false).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
});

export const exchangeRate = pgTable("ExchangeRate", {
	id: uuid().primaryKey().notNull(),
	fromCurrency: varchar({ length: 3 }).notNull(),
	toCurrency: varchar({ length: 3 }).notNull(),
	rate: numeric({ precision: 18, scale:  8 }).notNull(),
	source: exchangeRateSource().default('MANUAL').notNull(),
	effectiveDate: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
}, (table) => [
	index("ExchangeRate_fromCurrency_idx").using("btree", table.fromCurrency.asc().nullsLast().op("text_ops")),
	uniqueIndex("ExchangeRate_fromCurrency_toCurrency_key").using("btree", table.fromCurrency.asc().nullsLast().op("text_ops"), table.toCurrency.asc().nullsLast().op("text_ops")),
	index("ExchangeRate_toCurrency_idx").using("btree", table.toCurrency.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.fromCurrency],
			foreignColumns: [currency.code],
			name: "ExchangeRate_fromCurrency_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.toCurrency],
			foreignColumns: [currency.code],
			name: "ExchangeRate_toCurrency_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const crmAccountProducts = pgTable("crm_AccountProducts", {
	id: uuid().primaryKey().notNull(),
	accountId: uuid().notNull(),
	productId: uuid().notNull(),
	quantity: integer().default(1).notNull(),
	customPrice: numeric("custom_price", { precision: 18, scale:  2 }),
	currency: varchar({ length: 3 }).notNull(),
	snapshotRate: numeric("snapshot_rate", { precision: 18, scale:  8 }),
	status: crmAccountProductStatus().default('ACTIVE').notNull(),
	startDate: timestamp("start_date", { precision: 3, mode: 'string' }).notNull(),
	endDate: timestamp("end_date", { precision: 3, mode: 'string' }),
	renewalDate: timestamp("renewal_date", { precision: 3, mode: 'string' }),
	notes: text(),
	v: integer("__v").default(0).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
	createdBy: uuid().notNull(),
	updatedBy: uuid(),
}, (table) => [
	index("crm_AccountProducts_accountId_idx").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("crm_AccountProducts_accountId_productId_idx").using("btree", table.accountId.asc().nullsLast().op("uuid_ops"), table.productId.asc().nullsLast().op("uuid_ops")),
	index("crm_AccountProducts_productId_idx").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	index("crm_AccountProducts_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [crmAccounts.id],
			name: "crm_AccountProducts_accountId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [crmProducts.id],
			name: "crm_AccountProducts_productId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.currency],
			foreignColumns: [currency.code],
			name: "crm_AccountProducts_currency_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const crmProductCategories = pgTable("crm_ProductCategories", {
	id: uuid().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	order: integer().default(0).notNull(),
	isActive: boolean().default(true).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
	createdBy: uuid().notNull(),
	updatedBy: uuid(),
}, (table) => [
	index("crm_ProductCategories_isActive_idx").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
]);

export const crmProducts = pgTable("crm_Products", {
	id: uuid().primaryKey().notNull(),
	name: text().notNull(),
	description: text(),
	sku: text(),
	type: crmProductType().notNull(),
	status: crmProductStatus().default('DRAFT').notNull(),
	unitPrice: numeric("unit_price", { precision: 18, scale:  2 }).notNull(),
	unitCost: numeric("unit_cost", { precision: 18, scale:  2 }),
	currency: varchar({ length: 3 }).notNull(),
	taxRate: numeric("tax_rate", { precision: 5, scale:  2 }),
	unit: text(),
	isRecurring: boolean("is_recurring").default(false).notNull(),
	billingPeriod: crmBillingPeriod("billing_period"),
	categoryId: uuid(),
	v: integer("__v").default(0).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
	createdBy: uuid().notNull(),
	updatedBy: uuid(),
	deletedAt: timestamp({ precision: 3, mode: 'string' }),
	deletedBy: uuid(),
}, (table) => [
	index("crm_Products_categoryId_idx").using("btree", table.categoryId.asc().nullsLast().op("uuid_ops")),
	index("crm_Products_createdBy_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("crm_Products_deletedAt_idx").using("btree", table.deletedAt.asc().nullsLast().op("timestamp_ops")),
	uniqueIndex("crm_Products_sku_key").using("btree", table.sku.asc().nullsLast().op("text_ops")),
	index("crm_Products_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("crm_Products_type_idx").using("btree", table.type.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [crmProductCategories.id],
			name: "crm_Products_categoryId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.currency],
			foreignColumns: [currency.code],
			name: "crm_Products_currency_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "crm_Products_createdBy_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const crmOpportunityLineItems = pgTable("crm_OpportunityLineItems", {
	id: uuid().primaryKey().notNull(),
	opportunityId: uuid().notNull(),
	productId: uuid(),
	name: text().notNull(),
	sku: text(),
	description: text(),
	quantity: integer().default(1).notNull(),
	unitPrice: numeric("unit_price", { precision: 18, scale:  2 }).notNull(),
	discountType: crmDiscountType("discount_type").default('PERCENTAGE').notNull(),
	discountValue: numeric("discount_value", { precision: 18, scale:  2 }).default('0').notNull(),
	lineTotal: numeric("line_total", { precision: 18, scale:  2 }).notNull(),
	currency: varchar({ length: 3 }).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	v: integer("__v").default(0).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
	createdBy: uuid().notNull(),
	updatedBy: uuid(),
}, (table) => [
	index("crm_OpportunityLineItems_opportunityId_idx").using("btree", table.opportunityId.asc().nullsLast().op("uuid_ops")),
	index("crm_OpportunityLineItems_productId_idx").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.opportunityId],
			foreignColumns: [crmOpportunities.id],
			name: "crm_OpportunityLineItems_opportunityId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [crmProducts.id],
			name: "crm_OpportunityLineItems_productId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const crmContractLineItems = pgTable("crm_ContractLineItems", {
	id: uuid().primaryKey().notNull(),
	contractId: uuid().notNull(),
	productId: uuid(),
	name: text().notNull(),
	sku: text(),
	description: text(),
	quantity: integer().default(1).notNull(),
	unitPrice: numeric("unit_price", { precision: 18, scale:  2 }).notNull(),
	discountType: crmDiscountType("discount_type").default('PERCENTAGE').notNull(),
	discountValue: numeric("discount_value", { precision: 18, scale:  2 }).default('0').notNull(),
	lineTotal: numeric("line_total", { precision: 18, scale:  2 }).notNull(),
	currency: varchar({ length: 3 }).notNull(),
	sortOrder: integer("sort_order").default(0).notNull(),
	v: integer("__v").default(0).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
	createdBy: uuid().notNull(),
	updatedBy: uuid(),
}, (table) => [
	index("crm_ContractLineItems_contractId_idx").using("btree", table.contractId.asc().nullsLast().op("uuid_ops")),
	index("crm_ContractLineItems_productId_idx").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.contractId],
			foreignColumns: [crmContracts.id],
			name: "crm_ContractLineItems_contractId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [crmProducts.id],
			name: "crm_ContractLineItems_productId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const documentsToOpportunities = pgTable("DocumentsToOpportunities", {
	documentId: uuid("document_id").notNull(),
	opportunityId: uuid("opportunity_id").notNull(),
}, (table) => [
	index("DocumentsToOpportunities_document_id_idx").using("btree", table.documentId.asc().nullsLast().op("uuid_ops")),
	index("DocumentsToOpportunities_opportunity_id_idx").using("btree", table.opportunityId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.documentId],
			foreignColumns: [documents.id],
			name: "DocumentsToOpportunities_document_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.opportunityId],
			foreignColumns: [crmOpportunities.id],
			name: "DocumentsToOpportunities_opportunity_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	primaryKey({ columns: [table.documentId, table.opportunityId], name: "DocumentsToOpportunities_pkey"}),
]);

export const documentsToContacts = pgTable("DocumentsToContacts", {
	documentId: uuid("document_id").notNull(),
	contactId: uuid("contact_id").notNull(),
}, (table) => [
	index("DocumentsToContacts_contact_id_idx").using("btree", table.contactId.asc().nullsLast().op("uuid_ops")),
	index("DocumentsToContacts_document_id_idx").using("btree", table.documentId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.documentId],
			foreignColumns: [documents.id],
			name: "DocumentsToContacts_document_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [crmContacts.id],
			name: "DocumentsToContacts_contact_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	primaryKey({ columns: [table.documentId, table.contactId], name: "DocumentsToContacts_pkey"}),
]);

export const documentsToTasks = pgTable("DocumentsToTasks", {
	documentId: uuid("document_id").notNull(),
	taskId: uuid("task_id").notNull(),
}, (table) => [
	index("DocumentsToTasks_document_id_idx").using("btree", table.documentId.asc().nullsLast().op("uuid_ops")),
	index("DocumentsToTasks_task_id_idx").using("btree", table.taskId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.documentId],
			foreignColumns: [documents.id],
			name: "DocumentsToTasks_document_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.taskId],
			foreignColumns: [tasks.id],
			name: "DocumentsToTasks_task_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	primaryKey({ columns: [table.documentId, table.taskId], name: "DocumentsToTasks_pkey"}),
]);

export const boardWatchers = pgTable("BoardWatchers", {
	boardId: uuid("board_id").notNull(),
	userId: uuid("user_id").notNull(),
}, (table) => [
	index("BoardWatchers_board_id_idx").using("btree", table.boardId.asc().nullsLast().op("uuid_ops")),
	index("BoardWatchers_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.boardId],
			foreignColumns: [boards.id],
			name: "BoardWatchers_board_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "BoardWatchers_user_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	primaryKey({ columns: [table.boardId, table.userId], name: "BoardWatchers_pkey"}),
]);

export const contactsToOpportunities = pgTable("ContactsToOpportunities", {
	contactId: uuid("contact_id").notNull(),
	opportunityId: uuid("opportunity_id").notNull(),
}, (table) => [
	index("ContactsToOpportunities_contact_id_idx").using("btree", table.contactId.asc().nullsLast().op("uuid_ops")),
	index("ContactsToOpportunities_opportunity_id_idx").using("btree", table.opportunityId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [crmContacts.id],
			name: "ContactsToOpportunities_contact_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.opportunityId],
			foreignColumns: [crmOpportunities.id],
			name: "ContactsToOpportunities_opportunity_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	primaryKey({ columns: [table.contactId, table.opportunityId], name: "ContactsToOpportunities_pkey"}),
]);

export const documentsToCrmAccountsTasks = pgTable("DocumentsToCrmAccountsTasks", {
	documentId: uuid("document_id").notNull(),
	crmAccountsTaskId: uuid("crm_accounts_task_id").notNull(),
}, (table) => [
	index("DocumentsToCrmAccountsTasks_crm_accounts_task_id_idx").using("btree", table.crmAccountsTaskId.asc().nullsLast().op("uuid_ops")),
	index("DocumentsToCrmAccountsTasks_document_id_idx").using("btree", table.documentId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.documentId],
			foreignColumns: [documents.id],
			name: "DocumentsToCrmAccountsTasks_document_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.crmAccountsTaskId],
			foreignColumns: [crmAccountsTasks.id],
			name: "DocumentsToCrmAccountsTasks_crm_accounts_task_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	primaryKey({ columns: [table.documentId, table.crmAccountsTaskId], name: "DocumentsToCrmAccountsTasks_pkey"}),
]);

// Per-user "I have opened this lead" log. Stamped on every drawer open
// (the GET /api/leads/[id] route side-effect-upserts here). The list
// view left-joins this for the current user so each row shows a 👁
// icon for leads the reviewer has already eyeballed — quick "what's
// new since last time" scan signal. Composite PK = one row per user
// per lead; viewed_at is refreshed on each subsequent open.
export const crmLeadViews = pgTable("crm_Lead_Views", {
	leadId: uuid("lead_id").notNull(),
	userId: uuid("user_id").notNull(),
	viewedAt: timestamp("viewed_at", { precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	// Most queries are "is THIS lead viewed by THIS user" — that's the PK
	// lookup. The user-scoped index serves "show me leads I haven't seen"
	// style queries cheaply.
	index("crm_Lead_Views_user_id_viewed_at_idx")
		.using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.viewedAt.desc().nullsLast().op("timestamp_ops")),
	foreignKey({
			columns: [table.leadId],
			foreignColumns: [crmLeads.id],
			name: "crm_Lead_Views_lead_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "crm_Lead_Views_user_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	primaryKey({ columns: [table.leadId, table.userId], name: "crm_Lead_Views_pkey"}),
]);

// Per-user outreach activity counters powering the "Daily Activity"
// motivation dashboard. Append-only — one row per tracked action:
//   - type 'call'  → reviewer SET/CHANGED a lead's PRIMARY phone (PATCH /api/leads/[id])
//   - type 'email' → reviewer SET/CHANGED a lead's PRIMARY email
// "Projects viewed" is NOT stored here — it's derived from crm_Lead_Views (the
// 👁 eyeball log) so re-opening the same lead never inflates the count. Only the
// human drawer editor inserts here, so AI enrichment / follow-ups (which write
// leads on other code paths) never count as manual outreach.
export const crmActivityEvents = pgTable("crm_Activity_Events", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	userId: uuid("user_id").notNull(),
	type: text().notNull(),
	leadId: uuid("lead_id"),
	createdAt: timestamp("created_at", { precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("crm_Activity_Events_user_id_created_at_idx")
		.using("btree", table.userId.asc().nullsLast().op("uuid_ops"), table.createdAt.desc().nullsLast().op("timestamp_ops")),
	index("crm_Activity_Events_type_created_at_idx")
		.using("btree", table.type.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsLast().op("timestamp_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "crm_Activity_Events_user_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.leadId],
			foreignColumns: [crmLeads.id],
			name: "crm_Activity_Events_lead_id_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const documentsToLeads = pgTable("DocumentsToLeads", {
	documentId: uuid("document_id").notNull(),
	leadId: uuid("lead_id").notNull(),
}, (table) => [
	index("DocumentsToLeads_document_id_idx").using("btree", table.documentId.asc().nullsLast().op("uuid_ops")),
	index("DocumentsToLeads_lead_id_idx").using("btree", table.leadId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.documentId],
			foreignColumns: [documents.id],
			name: "DocumentsToLeads_document_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.leadId],
			foreignColumns: [crmLeads.id],
			name: "DocumentsToLeads_lead_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	primaryKey({ columns: [table.documentId, table.leadId], name: "DocumentsToLeads_pkey"}),
]);

export const documentsToAccounts = pgTable("DocumentsToAccounts", {
	documentId: uuid("document_id").notNull(),
	accountId: uuid("account_id").notNull(),
}, (table) => [
	index("DocumentsToAccounts_account_id_idx").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("DocumentsToAccounts_document_id_idx").using("btree", table.documentId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.documentId],
			foreignColumns: [documents.id],
			name: "DocumentsToAccounts_document_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [crmAccounts.id],
			name: "DocumentsToAccounts_account_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	primaryKey({ columns: [table.documentId, table.accountId], name: "DocumentsToAccounts_pkey"}),
]);

export const accountWatchers = pgTable("AccountWatchers", {
	accountId: uuid("account_id").notNull(),
	userId: uuid("user_id").notNull(),
}, (table) => [
	index("AccountWatchers_account_id_idx").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("AccountWatchers_user_id_idx").using("btree", table.userId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [crmAccounts.id],
			name: "AccountWatchers_account_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "AccountWatchers_user_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	primaryKey({ columns: [table.accountId, table.userId], name: "AccountWatchers_pkey"}),
]);

export const targetsToTargetLists = pgTable("TargetsToTargetLists", {
	targetId: uuid("target_id").notNull(),
	targetListId: uuid("target_list_id").notNull(),
}, (table) => [
	index("TargetsToTargetLists_target_id_idx").using("btree", table.targetId.asc().nullsLast().op("uuid_ops")),
	index("TargetsToTargetLists_target_list_id_idx").using("btree", table.targetListId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.targetId],
			foreignColumns: [crmTargets.id],
			name: "TargetsToTargetLists_target_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.targetListId],
			foreignColumns: [crmTargetLists.id],
			name: "TargetsToTargetLists_target_list_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	primaryKey({ columns: [table.targetId, table.targetListId], name: "TargetsToTargetLists_pkey"}),
]);

export const campaignToTargetLists = pgTable("CampaignToTargetLists", {
	campaignId: uuid("campaign_id").notNull(),
	targetListId: uuid("target_list_id").notNull(),
}, (table) => [
	foreignKey({
			columns: [table.campaignId],
			foreignColumns: [crmCampaigns.id],
			name: "CampaignToTargetLists_campaign_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.targetListId],
			foreignColumns: [crmTargetLists.id],
			name: "CampaignToTargetLists_target_list_id_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	primaryKey({ columns: [table.campaignId, table.targetListId], name: "CampaignToTargetLists_pkey"}),
]);

export const emailsToContacts = pgTable("EmailsToContacts", {
	emailId: uuid().notNull(),
	contactId: uuid().notNull(),
}, (table) => [
	index("EmailsToContacts_contactId_idx").using("btree", table.contactId.asc().nullsLast().op("uuid_ops")),
	index("EmailsToContacts_emailId_idx").using("btree", table.emailId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.emailId],
			foreignColumns: [email.id],
			name: "EmailsToContacts_emailId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [crmContacts.id],
			name: "EmailsToContacts_contactId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	primaryKey({ columns: [table.emailId, table.contactId], name: "EmailsToContacts_pkey"}),
]);

export const emailsToAccounts = pgTable("EmailsToAccounts", {
	emailId: uuid().notNull(),
	accountId: uuid().notNull(),
}, (table) => [
	index("EmailsToAccounts_accountId_idx").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("EmailsToAccounts_emailId_idx").using("btree", table.emailId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.emailId],
			foreignColumns: [email.id],
			name: "EmailsToAccounts_emailId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [crmAccounts.id],
			name: "EmailsToAccounts_accountId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	primaryKey({ columns: [table.emailId, table.accountId], name: "EmailsToAccounts_pkey"}),
]);

// ===========================================================================
// Manually-managed tables.
//
// These were originally created by raw SQL on Neon and used via
// `db.execute(sql\`…\`)`. They MUST stay declared here so `drizzle-kit push`
// does not drop them again — which already happened once.
//
// If you change anything here, follow up with the corresponding
// CREATE/ALTER in drizzle/manual/ and apply it before pushing.
// ===========================================================================

export const scraperCookies = pgTable("scraper_cookies", {
	id: integer().primaryKey().default(1),
	uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	uploadedBy: uuid("uploaded_by"),
	cookies: jsonb().notNull(),
}, (t) => [
	check("scraper_cookies_id_check", sql`${t.id} = 1`),
]);

export const scraperHeartbeat = pgTable("scraper_heartbeat", {
	id: integer().primaryKey().default(1),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	cookiesCount: integer("cookies_count"),
	cookiesPresent: boolean("cookies_present"),
	cookiesMinExpiry: timestamp("cookies_min_expiry", { withTimezone: true, mode: "string" }),
	cookiesHardExpired: boolean("cookies_hard_expired"),
	cookiesWorking: boolean("cookies_working"),
	cookiesSignal: text("cookies_signal"),
	cookiesClientInfoRate: numeric("cookies_client_info_rate", { precision: 5, scale: 4 }),
	scraperHealthy: boolean("scraper_healthy"),
	scraperVersion: text("scraper_version"),
	geminiEnabled: boolean("gemini_enabled"),
	keywords: jsonb(),
	currentKeyword: text("current_keyword"),
	lastError: text("last_error"),
}, (t) => [
	check("scraper_heartbeat_id_check", sql`${t.id} = 1`),
]);

export const scrapeRuns = pgTable("scrape_runs", {
	id: uuid().primaryKey().defaultRandom(),
	tickId: text("tick_id").notNull(),
	query: text().notNull(),
	status: text().default("running").notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
	jobsExpected: integer("jobs_expected"),
	jobsFound: integer("jobs_found"),
	jobsInserted: integer("jobs_inserted"),
	jobsUpdated: integer("jobs_updated"),
	error: text(),
}, (t) => [
	index("scrape_runs_started_at_idx").using("btree", t.startedAt.desc()),
	index("scrape_runs_status_started_idx").using("btree", t.status, t.startedAt.desc()),
	index("scrape_runs_query_started_idx").using("btree", t.query, t.startedAt.desc()),
	check("scrape_runs_status_check", sql`${t.status} IN ('running', 'completed', 'failed', 'skipped')`),
]);

// One row per paired WhatsApp account. Previously a hard singleton (id = 1);
// now keyed by a stable `account` slug ('primary', 'secondary', …) so the
// bridge can run multiple Baileys sockets and the CRM can pick which number
// a reminder sends from. The 'primary' account preserves the original
// pairing (its auth creds stay in the bridge's base AUTH_DIR).
export const whatsappSession = pgTable("whatsapp_session", {
	account: text().primaryKey().default("primary"),
	// Friendly name for the number, supplied by the bridge heartbeat. Falls
	// back to the account slug in the UI when absent.
	label: text(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	connected: boolean(),
	jid: text(),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "string" }),
	qrDataUrl: text("qr_data_url"),
	qrIssuedAt: timestamp("qr_issued_at", { withTimezone: true, mode: "string" }),
	lastError: text("last_error"),
});

export const whatsappOutbox = pgTable("whatsapp_outbox", {
	id: uuid().primaryKey().defaultRandom(),
	// Which paired account this message must send FROM. Matches
	// whatsapp_session.account; the bridge only claims rows for its own
	// connected accounts. Defaults to 'primary' so existing rows + callers
	// that don't specify an account keep working unchanged.
	account: text().default("primary").notNull(),
	toJid: text("to_jid").notNull(),
	body: text().notNull(),
	status: text().default("pending").notNull(),
	attempts: integer().default(0).notNull(),
	messageId: text("message_id"),
	error: text(),
	enqueuedBy: text("enqueued_by"),
	leadId: text("lead_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
	attemptedAt: timestamp("attempted_at", { withTimezone: true, mode: "string" }),
	sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }),
}, (t) => [
	index("whatsapp_outbox_pending_idx").using("btree", t.createdAt).where(sql`status = 'pending'`),
	// Per-account claim: the bridge fetches pending rows for one account at a
	// time, so index (account, created_at) over just the pending rows.
	index("whatsapp_outbox_account_pending_idx").using("btree", t.account, t.createdAt).where(sql`status = 'pending'`),
	index("whatsapp_outbox_lead_idx").using("btree", t.leadId).where(sql`lead_id IS NOT NULL`),
	check("whatsapp_outbox_status_check", sql`${t.status} IN ('pending', 'sending', 'sent', 'failed')`),
]);

export const whatsappMessage = pgTable("whatsapp_message", {
	id: uuid().primaryKey().defaultRandom(),
	messageId: text("message_id"),
	direction: text().notNull(),
	jid: text().notNull(),
	pushname: text(),
	body: text(),
	hasMedia: boolean("has_media").default(false).notNull(),
	waTimestamp: bigint("wa_timestamp", { mode: "number" }),
	leadId: text("lead_id"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (t) => [
	index("whatsapp_message_jid_idx").using("btree", t.jid, t.createdAt.desc()),
	index("whatsapp_message_lead_idx").using("btree", t.leadId).where(sql`lead_id IS NOT NULL`),
	check("whatsapp_message_direction_check", sql`${t.direction} IN ('in', 'out')`),
]);

// ────────────────────────────────────────────────────────────────────────────
// Proposals module (Plutio-style proposal maker). Mirrors the Invoices tables.
// ────────────────────────────────────────────────────────────────────────────

export const proposalStatus = pgEnum("Proposal_Status", ['DRAFT', 'SENT', 'VIEWED', 'APPROVED', 'REJECTED', 'EXPIRED', 'PAID'])

export const crmProposals = pgTable("crm_Proposals", {
	id: uuid().primaryKey().notNull(),
	number: integer(),
	clientSlug: text(),
	title: text().notNull(),
	status: proposalStatus().default('DRAFT').notNull(),
	// links
	accountId: uuid(),
	contactId: uuid(),
	createdBy: uuid().notNull(),
	// template support (single-table approach)
	isTemplate: boolean().default(false).notNull(),
	templateName: text(),
	sourceTemplateId: uuid(),
	// merge fields
	clientName: text(),
	clientCompany: text(),
	clientEmail: text(),
	clientAddress: text(),
	projectName: text(),
	proposalDate: timestamp({ precision: 3, mode: 'string' }),
	currency: varchar({ length: 3 }).notNull(),
	// v2: presentation + media
	theme: text().default('creative'),
	videoUrl: text(),
	scheduleCallUrl: text(),
	// v3: design preset + tokens (accent/font/layout) seeded from a code preset
	designPresetId: text(),
	designTokens: jsonb(),
	// editable portfolio titles + a CTA link box { recentTitle, generalTitle, note, linkUrl, linkLabel }
	portfolioConfig: jsonb(),
	// content: ordered Tiptap section list
	sections: jsonb(),
	// pricing
	pricingMode: text().default('LINE_ITEMS').notNull(),
	fixedPrice: numeric({ precision: 14, scale: 2 }),
	subtotal: numeric({ precision: 14, scale: 2 }).default('0').notNull(),
	discountTotal: numeric({ precision: 14, scale: 2 }).default('0').notNull(),
	taxTotal: numeric({ precision: 14, scale: 2 }).default('0').notNull(),
	transactionFee: numeric({ precision: 14, scale: 2 }).default('0').notNull(),
	grandTotal: numeric({ precision: 14, scale: 2 }).default('0').notNull(),
	depositAmount: numeric({ precision: 14, scale: 2 }),
	// sharing
	shareToken: text(),
	// lifecycle
	sentAt: timestamp({ precision: 3, mode: 'string' }),
	firstViewedAt: timestamp({ precision: 3, mode: 'string' }),
	lastViewedAt: timestamp({ precision: 3, mode: 'string' }),
	viewCount: integer().default(0).notNull(),
	decisionAt: timestamp({ precision: 3, mode: 'string' }),
	expiresAt: timestamp({ precision: 3, mode: 'string' }),
	// signature
	approvedByName: text(),
	approvedByEmail: text(),
	signatureType: text(),
	signatureTypedName: text(),
	signatureStorageKey: text(),
	signatureIpAddress: text(),
	rejectionReason: text(),
	// payment
	paymentMethod: text(),
	paymentProvider: text(),
	processingFee: numeric({ precision: 14, scale: 2 }).default('0').notNull(),
	stripePaymentIntentId: text(),
	stripeCustomerId: text(),
	paypalOrderId: text(),
	paypalCaptureId: text(),
	paidAt: timestamp({ precision: 3, mode: 'string' }),
	linkedInvoiceId: uuid(),
	// branding override
	brandColor: text(),
	logoStorageKey: text(),
	// pdf
	pdfStorageKey: text(),
	pdfGeneratedAt: timestamp({ precision: 3, mode: 'string' }),
	// notes / standard
	publicNotes: text(),
	internalNotes: text(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
	deletedAt: timestamp({ precision: 3, mode: 'string' }),
}, (table) => [
	index("crm_Proposals_accountId_idx").using("btree", table.accountId.asc().nullsLast().op("uuid_ops")),
	index("crm_Proposals_contactId_idx").using("btree", table.contactId.asc().nullsLast().op("uuid_ops")),
	index("crm_Proposals_createdBy_idx").using("btree", table.createdBy.asc().nullsLast().op("uuid_ops")),
	index("crm_Proposals_status_idx").using("btree", table.status.asc().nullsLast().op("enum_ops")),
	index("crm_Proposals_isTemplate_idx").using("btree", table.isTemplate.asc().nullsLast().op("bool_ops")),
	uniqueIndex("crm_Proposals_shareToken_key").using("btree", table.shareToken.asc().nullsLast().op("text_ops")),
	uniqueIndex("crm_Proposals_number_key").using("btree", table.number.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.createdBy],
			foreignColumns: [users.id],
			name: "crm_Proposals_createdBy_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [crmAccounts.id],
			name: "crm_Proposals_accountId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.contactId],
			foreignColumns: [crmContacts.id],
			name: "crm_Proposals_contactId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.currency],
			foreignColumns: [currency.code],
			name: "crm_Proposals_currency_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.sourceTemplateId],
			foreignColumns: [table.id],
			name: "crm_Proposals_sourceTemplateId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.linkedInvoiceId],
			foreignColumns: [invoices.id],
			name: "crm_Proposals_linkedInvoiceId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const crmProposalLineItems = pgTable("crm_Proposal_LineItems", {
	id: uuid().primaryKey().notNull(),
	proposalId: uuid().notNull(),
	position: integer().notNull(),
	productId: uuid(),
	description: text().notNull(),
	quantity: numeric({ precision: 14, scale: 4 }).notNull(),
	unitPrice: numeric({ precision: 14, scale: 4 }).notNull(),
	discountPercent: numeric({ precision: 5, scale: 2 }).default('0').notNull(),
	taxRateId: uuid(),
	taxRateSnapshot: numeric({ precision: 5, scale: 2 }),
	lineSubtotal: numeric({ precision: 14, scale: 2 }).notNull(),
	lineVat: numeric({ precision: 14, scale: 2 }).notNull(),
	lineTotal: numeric({ precision: 14, scale: 2 }).notNull(),
	// dynamic client-adjustable quantity (e.g. # of pitch decks)
	clientAdjustable: boolean().default(false).notNull(),
	// volume/tier pricing: [{ minQty, unitPrice }] — unit price drops as qty rises
	tiers: jsonb(),
	minQty: numeric({ precision: 14, scale: 4 }),
	maxQty: numeric({ precision: 14, scale: 4 }),
}, (table) => [
	index("crm_Proposal_LineItems_proposalId_idx").using("btree", table.proposalId.asc().nullsLast().op("uuid_ops")),
	index("crm_Proposal_LineItems_productId_idx").using("btree", table.productId.asc().nullsLast().op("uuid_ops")),
	index("crm_Proposal_LineItems_taxRateId_idx").using("btree", table.taxRateId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.proposalId],
			foreignColumns: [crmProposals.id],
			name: "crm_Proposal_LineItems_proposalId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [crmProducts.id],
			name: "crm_Proposal_LineItems_productId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.taxRateId],
			foreignColumns: [invoiceTaxRates.id],
			name: "crm_Proposal_LineItems_taxRateId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const crmProposalAssets = pgTable("crm_Proposal_Assets", {
	id: uuid().primaryKey().notNull(),
	proposalId: uuid().notNull(),
	position: integer().default(0).notNull(),
	kind: text().default('PDF').notNull(),
	title: text(),
	storageKey: text().notNull(),
	previewStorageKey: text(),
	pageCount: integer(),
	fileSize: integer(),
	// v2: categorized interactive portfolio
	category: text().default('GENERAL').notNull(),
	featured: boolean().default(false).notNull(),
	externalUrl: text(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("crm_Proposal_Assets_proposalId_idx").using("btree", table.proposalId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.proposalId],
			foreignColumns: [crmProposals.id],
			name: "crm_Proposal_Assets_proposalId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
]);

export const crmProposalActivity = pgTable("crm_Proposal_Activity", {
	id: uuid().primaryKey().notNull(),
	proposalId: uuid().notNull(),
	actorId: uuid(),
	action: text().notNull(),
	meta: jsonb(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("crm_Proposal_Activity_proposalId_idx").using("btree", table.proposalId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.proposalId],
			foreignColumns: [crmProposals.id],
			name: "crm_Proposal_Activity_proposalId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.actorId],
			foreignColumns: [users.id],
			name: "crm_Proposal_Activity_actorId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const proposalSettings = pgTable("Proposal_Settings", {
	id: uuid().primaryKey().notNull(),
	baseCurrency: varchar({ length: 3 }).notNull(),
	defaultExpiryDays: integer().default(30).notNull(),
	defaultTaxRateId: uuid(),
	defaultTermsHtml: text(),
	// branding
	logoStorageKey: text(),
	brandColor: text().default('#2563eb'),
	accentColor: text(),
	fontFamily: text().default('Helvetica'),
	clientAvatars: jsonb(),
	// company block
	companyName: text(),
	companyAddress: text(),
	companyEmail: text(),
	companyPhone: text(),
	companyWebsite: text(),
	footerText: text(),
	// v2: direct-transfer bank details + scheduling + Stripe fee
	bankName: text(),
	bankAccountName: text(),
	bankAccountNumber: text(),
	bankIban: text(),
	bankSwift: text(),
	bankRouting: text(),
	bankInstructions: text(),
	scheduleCallUrl: text(),
	stripeFeePercent: numeric({ precision: 5, scale: 2 }).default('3.5'),
	// where to send a client after they sign (e.g. leave a recommendation)
	postSignRedirectUrl: text(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.defaultTaxRateId],
			foreignColumns: [invoiceTaxRates.id],
			name: "Proposal_Settings_defaultTaxRateId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);
