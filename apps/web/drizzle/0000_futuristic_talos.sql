-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."ActiveStatus" AS ENUM('ACTIVE', 'INACTIVE', 'PENDING');--> statement-breakpoint
CREATE TYPE "public"."ApiKeyProvider" AS ENUM('OPENAI', 'FIRECRAWL', 'ANTHROPIC', 'GROQ');--> statement-breakpoint
CREATE TYPE "public"."ApiKeyScope" AS ENUM('SYSTEM', 'USER');--> statement-breakpoint
CREATE TYPE "public"."DocumentProcessingStatus" AS ENUM('PENDING', 'PROCESSING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."DocumentSystemType" AS ENUM('RECEIPT', 'CONTRACT', 'OFFER', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."EmailFolder" AS ENUM('INBOX', 'SENT');--> statement-breakpoint
CREATE TYPE "public"."ExchangeRateSource" AS ENUM('MANUAL', 'ECB');--> statement-breakpoint
CREATE TYPE "public"."Invoice_Status" AS ENUM('DRAFT', 'ISSUED', 'SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED', 'DISPUTED', 'REFUNDED', 'WRITTEN_OFF');--> statement-breakpoint
CREATE TYPE "public"."Invoice_Type" AS ENUM('INVOICE', 'CREDIT_NOTE', 'PROFORMA');--> statement-breakpoint
CREATE TYPE "public"."Language" AS ENUM('cz', 'en', 'de', 'uk');--> statement-breakpoint
CREATE TYPE "public"."crm_AccountProduct_Status" AS ENUM('ACTIVE', 'EXPIRED', 'CANCELLED', 'PENDING');--> statement-breakpoint
CREATE TYPE "public"."crm_Activity_Status" AS ENUM('scheduled', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."crm_Activity_Type" AS ENUM('call', 'meeting', 'note', 'email');--> statement-breakpoint
CREATE TYPE "public"."crm_AuditLog_Action" AS ENUM('created', 'updated', 'deleted', 'restored', 'relation_added', 'relation_removed');--> statement-breakpoint
CREATE TYPE "public"."crm_Billing_Period" AS ENUM('MONTHLY', 'QUARTERLY', 'ANNUALLY', 'ONE_TIME');--> statement-breakpoint
CREATE TYPE "public"."crm_Contracts_Status" AS ENUM('NOTSTARTED', 'INPROGRESS', 'SIGNED');--> statement-breakpoint
CREATE TYPE "public"."crm_Discount_Type" AS ENUM('PERCENTAGE', 'FIXED');--> statement-breakpoint
CREATE TYPE "public"."crm_Enrichment_Status" AS ENUM('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."crm_Opportunity_Status" AS ENUM('ACTIVE', 'INACTIVE', 'PENDING', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."crm_Product_Status" AS ENUM('DRAFT', 'ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."crm_Product_Type" AS ENUM('PRODUCT', 'SERVICE');--> statement-breakpoint
CREATE TYPE "public"."taskStatus" AS ENUM('ACTIVE', 'PENDING', 'COMPLETE');--> statement-breakpoint
CREATE TABLE "_prisma_migrations" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"finished_at" timestamp with time zone,
	"migration_name" varchar(255) NOT NULL,
	"logs" text,
	"rolled_back_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_steps_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_Opportunities_Type" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"order" integer
);
--> statement-breakpoint
CREATE TABLE "Boards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer NOT NULL,
	"description" text NOT NULL,
	"favourite" boolean,
	"favouritePosition" bigint,
	"icon" text,
	"position" bigint,
	"title" text NOT NULL,
	"user" uuid NOT NULL,
	"visibility" text,
	"sharedWith" uuid[],
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"createdBy" uuid,
	"updatedAt" timestamp(3),
	"updatedBy" uuid,
	"deletedAt" timestamp(3),
	"deletedBy" uuid
);
--> statement-breakpoint
CREATE TABLE "crm_Opportunities_Sales_Stages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	"probability" integer,
	"order" integer
);
--> statement-breakpoint
CREATE TABLE "crm_Accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"createdBy" uuid,
	"updatedAt" timestamp(3),
	"updatedBy" uuid,
	"annual_revenue" text,
	"assigned_to" uuid,
	"billing_city" text,
	"billing_country" text,
	"billing_postal_code" text,
	"billing_state" text,
	"billing_street" text,
	"company_id" text,
	"description" text,
	"email" text,
	"employees" text,
	"fax" text,
	"industry" uuid,
	"member_of" text,
	"name" text NOT NULL,
	"office_phone" text,
	"shipping_city" text,
	"shipping_country" text,
	"shipping_postal_code" text,
	"shipping_state" text,
	"shipping_street" text,
	"status" text DEFAULT 'Inactive',
	"type" text DEFAULT 'Customer',
	"vat" text,
	"website" text,
	"deletedAt" timestamp(3),
	"deletedBy" uuid
);
--> statement-breakpoint
CREATE TABLE "crm_Contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer DEFAULT 0 NOT NULL,
	"account" uuid,
	"assigned_to" uuid,
	"birthday" text,
	"created_by" uuid,
	"createdBy" uuid,
	"created_on" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"cratedAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"last_activity" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3),
	"updatedBy" uuid,
	"last_activity_by" uuid,
	"description" text,
	"email" text,
	"personal_email" text,
	"first_name" text,
	"last_name" text NOT NULL,
	"office_phone" text,
	"mobile_phone" text,
	"website" text,
	"position" text,
	"status" boolean DEFAULT true NOT NULL,
	"social_twitter" text,
	"social_facebook" text,
	"social_linkedin" text,
	"social_skype" text,
	"social_instagram" text,
	"social_youtube" text,
	"social_tiktok" text,
	"tags" text[],
	"notes" text[],
	"accountsIDs" uuid,
	"contact_type_id" uuid,
	"deletedAt" timestamp(3),
	"deletedBy" uuid
);
--> statement-breakpoint
CREATE TABLE "ImageUpload" (
	"id" uuid PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_Accounts_Tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer NOT NULL,
	"content" text,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"createdBy" uuid,
	"updatedAt" timestamp(3),
	"updatedBy" uuid,
	"dueDateAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"priority" text NOT NULL,
	"tags" jsonb,
	"title" text NOT NULL,
	"likes" bigint DEFAULT 0,
	"user" uuid,
	"taskStatus" "taskStatus" DEFAULT 'ACTIVE',
	"account" uuid
);
--> statement-breakpoint
CREATE TABLE "Documents_Types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasksComments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer NOT NULL,
	"comment" text NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"task" uuid,
	"user" uuid NOT NULL,
	"assigned_crm_account_task" uuid
);
--> statement-breakpoint
CREATE TABLE "Sections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer NOT NULL,
	"board" uuid NOT NULL,
	"title" text NOT NULL,
	"position" bigint
);
--> statement-breakpoint
CREATE TABLE "TodoList" (
	"id" uuid PRIMARY KEY NOT NULL,
	"createdAt" text NOT NULL,
	"description" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"user" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer NOT NULL,
	"content" text,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"createdBy" uuid,
	"updatedAt" timestamp(3),
	"updatedBy" uuid,
	"dueDateAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"lastEditedAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"position" bigint NOT NULL,
	"priority" text NOT NULL,
	"section" uuid,
	"tags" jsonb,
	"title" text NOT NULL,
	"likes" bigint DEFAULT 0,
	"user" uuid,
	"taskStatus" "taskStatus" DEFAULT 'ACTIVE'
);
--> statement-breakpoint
CREATE TABLE "crm_Industry_Type" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "systemServices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer NOT NULL,
	"name" text NOT NULL,
	"serviceUrl" text,
	"serviceId" text,
	"serviceKey" text,
	"servicePassword" text,
	"servicePort" text,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "Employees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer NOT NULL,
	"avatar" text NOT NULL,
	"email" text,
	"name" text NOT NULL,
	"salary" bigint NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"accountId" uuid NOT NULL,
	"balanceDue" numeric(14, 2) DEFAULT '0' NOT NULL,
	"bankAccount" text,
	"bankName" text,
	"baseCurrency" varchar(3),
	"billingSnapshot" jsonb,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"createdBy" uuid NOT NULL,
	"currency" varchar(3) NOT NULL,
	"discountTotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"dueDate" timestamp(3),
	"fxRateToBase" numeric(18, 8),
	"grandTotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"iban" text,
	"internalNotes" text,
	"issueDate" timestamp(3),
	"number" text,
	"numberOverridden" boolean DEFAULT false NOT NULL,
	"originalInvoiceId" uuid,
	"paidTotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"pdfGeneratedAt" timestamp(3),
	"pdfStorageKey" text,
	"publicNotes" text,
	"search_vector" "tsvector",
	"seriesId" uuid,
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"swift" text,
	"taxableSupplyDate" timestamp(3),
	"type" "Invoice_Type" DEFAULT 'INVOICE' NOT NULL,
	"updatedAt" timestamp(3) NOT NULL,
	"variableSymbol" text,
	"vatTotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" "Invoice_Status" DEFAULT 'DRAFT' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_Target_Contact" (
	"id" uuid PRIMARY KEY NOT NULL,
	"targetId" uuid NOT NULL,
	"contactId" uuid,
	"name" text,
	"email" text,
	"title" text,
	"phone" text,
	"linkedinUrl" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"enrichStatus" "crm_Enrichment_Status" DEFAULT 'PENDING' NOT NULL,
	"enrichedAt" timestamp(3),
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_Embeddings_Accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"content_hash" text NOT NULL,
	"embedded_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "crm_Embeddings_Accounts_account_id_key" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "Users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer DEFAULT 0 NOT NULL,
	"account_name" text,
	"avatar" text,
	"email" text NOT NULL,
	"is_account_admin" boolean DEFAULT false NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_on" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"lastLoginAt" timestamp(3),
	"name" text,
	"password" text,
	"username" text,
	"userStatus" "ActiveStatus" DEFAULT 'PENDING' NOT NULL,
	"userLanguage" "Language" DEFAULT 'en' NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"updated_at" timestamp(3),
	"banned" boolean DEFAULT false NOT NULL,
	"banReason" text,
	"banExpires" timestamp(3)
);
--> statement-breakpoint
CREATE TABLE "Invoice_Attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoiceId" uuid NOT NULL,
	"storageKey" text NOT NULL,
	"filename" text NOT NULL,
	"mimeType" text NOT NULL,
	"size" integer NOT NULL,
	"uploadedBy" uuid NOT NULL,
	"uploadedAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"isPrimaryPdf" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Invoice_LineItems" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoiceId" uuid NOT NULL,
	"position" integer NOT NULL,
	"productId" uuid,
	"description" text NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"unitPrice" numeric(14, 4) NOT NULL,
	"discountPercent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"taxRateId" uuid,
	"taxRateSnapshot" numeric(5, 2),
	"lineSubtotal" numeric(14, 2) NOT NULL,
	"lineVat" numeric(14, 2) NOT NULL,
	"lineTotal" numeric(14, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Invoice_Payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoiceId" uuid NOT NULL,
	"paidAt" timestamp(3) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"method" text,
	"reference" text,
	"note" text,
	"createdBy" uuid NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_Embeddings_Opportunities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"content_hash" text NOT NULL,
	"embedded_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "crm_Embeddings_Opportunities_opportunity_id_key" UNIQUE("opportunity_id")
);
--> statement-breakpoint
CREATE TABLE "ApiKeys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" "ApiKeyScope" NOT NULL,
	"userId" uuid,
	"provider" "ApiKeyProvider" NOT NULL,
	"encryptedKey" text NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ApiToken" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"tokenHash" text NOT NULL,
	"tokenPrefix" varchar(8) NOT NULL,
	"userId" uuid NOT NULL,
	"expiresAt" timestamp(3),
	"revokedAt" timestamp(3),
	"lastUsedAt" timestamp(3),
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_Contact_Enrichment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contactId" uuid NOT NULL,
	"status" "crm_Enrichment_Status" DEFAULT 'PENDING' NOT NULL,
	"fields" text[],
	"result" jsonb,
	"error" text,
	"triggeredBy" uuid,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_Embeddings_Contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contact_id" uuid NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"content_hash" text NOT NULL,
	"embedded_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "crm_Embeddings_Contacts_contact_id_key" UNIQUE("contact_id")
);
--> statement-breakpoint
CREATE TABLE "crm_Embeddings_Leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lead_id" uuid NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"content_hash" text NOT NULL,
	"embedded_at" timestamp(3) DEFAULT now() NOT NULL,
	CONSTRAINT "crm_Embeddings_Leads_lead_id_key" UNIQUE("lead_id")
);
--> statement-breakpoint
CREATE TABLE "Invoice_Activity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invoiceId" uuid NOT NULL,
	"actorId" uuid NOT NULL,
	"action" text NOT NULL,
	"meta" jsonb,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Invoice_TaxRates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(5, 2) NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Invoice_Series" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"prefixTemplate" text NOT NULL,
	"resetPolicy" text DEFAULT 'YEARLY' NOT NULL,
	"currentYear" integer,
	"counter" integer DEFAULT 0 NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_Target_Enrichment" (
	"id" uuid PRIMARY KEY NOT NULL,
	"targetId" uuid NOT NULL,
	"status" "crm_Enrichment_Status" DEFAULT 'PENDING' NOT NULL,
	"fields" text[],
	"result" jsonb,
	"error" text,
	"triggeredBy" uuid,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_Targets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"first_name" text,
	"last_name" text NOT NULL,
	"email" text,
	"mobile_phone" text,
	"office_phone" text,
	"company" text,
	"company_website" text,
	"personal_website" text,
	"position" text,
	"social_x" text,
	"social_linkedin" text,
	"social_instagram" text,
	"social_facebook" text,
	"status" boolean DEFAULT true NOT NULL,
	"tags" text[],
	"notes" text[],
	"created_by" uuid,
	"created_on" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3),
	"updatedBy" uuid,
	"personal_email" text,
	"company_email" text,
	"company_phone" text,
	"city" text,
	"country" text,
	"industry" text,
	"employees" text,
	"description" text,
	"converted_at" timestamp(3),
	"converted_account_id" uuid,
	"converted_contact_id" uuid,
	"deletedAt" timestamp(3),
	"deletedBy" uuid
);
--> statement-breakpoint
CREATE TABLE "crm_TargetLists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_on" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3),
	"deletedAt" timestamp(3),
	"deletedBy" uuid
);
--> statement-breakpoint
CREATE TABLE "crm_campaign_steps" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"template_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"delay_days" integer DEFAULT 0 NOT NULL,
	"send_to" text DEFAULT 'all' NOT NULL,
	"scheduled_at" timestamp(3),
	"sent_at" timestamp(3)
);
--> statement-breakpoint
CREATE TABLE "crm_campaign_sends" (
	"id" uuid PRIMARY KEY NOT NULL,
	"campaign_id" uuid NOT NULL,
	"step_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"email" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"resend_message_id" text,
	"unsubscribe_token" text NOT NULL,
	"opened_at" timestamp(3),
	"clicked_at" timestamp(3),
	"unsubscribed_at" timestamp(3),
	"error_message" text,
	"sent_at" timestamp(3)
);
--> statement-breakpoint
CREATE TABLE "crm_campaign_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"subject_default" text,
	"content_html" text NOT NULL,
	"content_json" jsonb NOT NULL,
	"created_by" uuid,
	"created_on" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3),
	"deletedAt" timestamp(3),
	"deletedBy" uuid
);
--> statement-breakpoint
CREATE TABLE "crm_campaigns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text,
	"template_id" uuid,
	"from_name" text,
	"reply_to" text,
	"scheduled_at" timestamp(3),
	"sent_at" timestamp(3),
	"created_by" uuid,
	"created_on" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3),
	"deletedAt" timestamp(3),
	"deletedBy" uuid
);
--> statement-breakpoint
CREATE TABLE "EmailAccount" (
	"id" uuid PRIMARY KEY NOT NULL,
	"userId" uuid NOT NULL,
	"label" text NOT NULL,
	"imapHost" text NOT NULL,
	"imapPort" integer NOT NULL,
	"imapSsl" boolean DEFAULT true NOT NULL,
	"smtpHost" text NOT NULL,
	"smtpPort" integer NOT NULL,
	"smtpSsl" boolean DEFAULT true NOT NULL,
	"username" text NOT NULL,
	"passwordEncrypted" text NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"sentFolderName" text DEFAULT 'Sent' NOT NULL,
	"lastSyncedAt" timestamp(3),
	"inboxLastUid" integer,
	"sentLastUid" integer,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Email" (
	"id" uuid PRIMARY KEY NOT NULL,
	"emailAccountId" uuid NOT NULL,
	"userId" uuid NOT NULL,
	"rfcMessageId" text NOT NULL,
	"imapUid" integer,
	"folder" "EmailFolder" NOT NULL,
	"subject" text,
	"fromName" text,
	"fromEmail" text,
	"toRecipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ccRecipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bccRecipients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"bodyText" text,
	"bodyHtml" text,
	"sentAt" timestamp(3),
	"isRead" boolean DEFAULT false NOT NULL,
	"isDeleted" boolean DEFAULT false NOT NULL,
	"updatedAt" timestamp(3) NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "Email_emailAccountId_rfcMessageId_key" UNIQUE("emailAccountId","rfcMessageId")
);
--> statement-breakpoint
CREATE TABLE "EmailEmbedding" (
	"id" uuid PRIMARY KEY NOT NULL,
	"emailId" uuid NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"contentHash" text NOT NULL,
	"embeddedAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "EmailEmbedding_emailId_key" UNIQUE("emailId")
);
--> statement-breakpoint
CREATE TABLE "crm_Contact_Types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "crm_Contact_Types_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "crm_Lead_Sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "crm_Lead_Sources_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "crm_Lead_Statuses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "crm_Lead_Statuses_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "crm_Lead_Types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer DEFAULT 0 NOT NULL,
	"name" text NOT NULL,
	CONSTRAINT "crm_Lead_Types_name_key" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "crm_Leads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"createdBy" uuid,
	"updatedAt" timestamp(3),
	"updatedBy" uuid,
	"firstName" text,
	"lastName" text NOT NULL,
	"company" text,
	"jobTitle" text,
	"email" text,
	"phone" text,
	"description" text,
	"refered_by" text,
	"campaign" text,
	"assigned_to" uuid,
	"accountsIDs" uuid,
	"lead_source_id" uuid,
	"lead_status_id" uuid,
	"lead_type_id" uuid,
	"deletedAt" timestamp(3),
	"deletedBy" uuid
);
--> statement-breakpoint
CREATE TABLE "Invoice_Settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"baseCurrency" varchar(3) NOT NULL,
	"defaultSeriesId" uuid,
	"defaultTaxRateId" uuid,
	"defaultDueDays" integer DEFAULT 14 NOT NULL,
	"bankName" text,
	"bankAccount" text,
	"iban" text,
	"swift" text,
	"footerText" text,
	"companyName" text,
	"companyAddress" text,
	"companyCity" text,
	"companyZip" text,
	"companyCountry" text,
	"companyVatId" text,
	"companyTaxId" text,
	"companyRegNo" text,
	"companyEmail" text,
	"companyPhone" text,
	"companyWebsite" text,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_ActivityLinks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"activityId" uuid NOT NULL,
	"entityType" text NOT NULL,
	"entityId" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_AuditLog" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entityType" text NOT NULL,
	"entityId" uuid NOT NULL,
	"action" "crm_AuditLog_Action" NOT NULL,
	"changes" jsonb,
	"userId" uuid,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_Report_Config" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"filters" jsonb NOT NULL,
	"isShared" boolean DEFAULT false NOT NULL,
	"createdBy" uuid NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_Report_Schedule" (
	"id" text PRIMARY KEY NOT NULL,
	"reportConfigId" text NOT NULL,
	"cronExpression" text NOT NULL,
	"recipients" jsonb NOT NULL,
	"format" text NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"lastSentAt" timestamp(3),
	"createdBy" uuid NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp(3) NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_Activities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type" "crm_Activity_Type" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"date" timestamp(3) NOT NULL,
	"duration" integer,
	"outcome" text,
	"status" "crm_Activity_Status" DEFAULT 'scheduled' NOT NULL,
	"metadata" jsonb,
	"createdBy" uuid,
	"updatedBy" uuid,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3),
	"deletedAt" timestamp(3),
	"deletedBy" uuid
);
--> statement-breakpoint
CREATE TABLE "Documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer,
	"date_created" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"last_updated" timestamp(3),
	"updatedAt" timestamp(3),
	"document_name" text NOT NULL,
	"created_by_user" uuid,
	"createdBy" uuid,
	"description" text,
	"document_type" uuid,
	"favourite" boolean,
	"document_file_mimeType" text NOT NULL,
	"document_file_url" text NOT NULL,
	"status" text,
	"visibility" text,
	"tags" jsonb,
	"key" text,
	"size" integer,
	"assigned_user" uuid,
	"connected_documents" text[],
	"document_system_type" "DocumentSystemType" DEFAULT 'OTHER',
	"content_text" text,
	"summary" text,
	"content_hash" text,
	"thumbnail_url" text,
	"processing_status" "DocumentProcessingStatus" DEFAULT 'PENDING' NOT NULL,
	"processing_error" text,
	"version" integer DEFAULT 1 NOT NULL,
	"parent_document_id" uuid,
	"deletedAt" timestamp(3),
	"deletedBy" uuid
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" uuid NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp(3),
	"refreshTokenExpiresAt" timestamp(3),
	"scope" text,
	"password" text,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_Embeddings_Documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"content_hash" text NOT NULL,
	"embedded_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_Document_Chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_text" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"embedded_at" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_SystemSettings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp(3) NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"updatedAt" timestamp(3)
);
--> statement-breakpoint
CREATE TABLE "crm_Opportunities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer DEFAULT 0 NOT NULL,
	"account" uuid,
	"assigned_to" uuid,
	"budget" numeric(18, 2) DEFAULT '0' NOT NULL,
	"campaign" uuid,
	"close_date" timestamp(3),
	"contact" uuid,
	"created_by" uuid,
	"createdBy" uuid,
	"created_on" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"last_activity" timestamp(3),
	"updatedAt" timestamp(3),
	"updatedBy" uuid,
	"last_activity_by" uuid,
	"currency" varchar(3),
	"description" text,
	"expected_revenue" numeric(18, 2) DEFAULT '0' NOT NULL,
	"name" text,
	"next_step" text,
	"sales_stage" uuid,
	"type" uuid,
	"status" "crm_Opportunity_Status" DEFAULT 'ACTIVE',
	"deletedAt" timestamp(3),
	"deletedBy" uuid,
	"snapshot_rate" numeric(18, 8)
);
--> statement-breakpoint
CREATE TABLE "crm_Contracts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"__v" integer NOT NULL,
	"title" text NOT NULL,
	"value" numeric(18, 2) NOT NULL,
	"startDate" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"endDate" timestamp(3),
	"renewalReminderDate" timestamp(3),
	"customerSignedDate" timestamp(3),
	"companySignedDate" timestamp(3),
	"description" text,
	"account" uuid,
	"assigned_to" uuid,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP,
	"createdBy" uuid,
	"updatedAt" timestamp(3),
	"updatedBy" uuid,
	"status" "crm_Contracts_Status" DEFAULT 'NOTSTARTED' NOT NULL,
	"type" text,
	"deletedAt" timestamp(3),
	"deletedBy" uuid,
	"currency" varchar(3),
	"snapshot_rate" numeric(18, 8)
);
--> statement-breakpoint
CREATE TABLE "Currency" (
	"code" varchar(3) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"symbol" varchar(5) NOT NULL,
	"isEnabled" boolean DEFAULT true NOT NULL,
	"isDefault" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ExchangeRate" (
	"id" uuid PRIMARY KEY NOT NULL,
	"fromCurrency" varchar(3) NOT NULL,
	"toCurrency" varchar(3) NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"source" "ExchangeRateSource" DEFAULT 'MANUAL' NOT NULL,
	"effectiveDate" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_AccountProducts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"accountId" uuid NOT NULL,
	"productId" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"custom_price" numeric(18, 2),
	"currency" varchar(3) NOT NULL,
	"snapshot_rate" numeric(18, 8),
	"status" "crm_AccountProduct_Status" DEFAULT 'ACTIVE' NOT NULL,
	"start_date" timestamp(3) NOT NULL,
	"end_date" timestamp(3),
	"renewal_date" timestamp(3),
	"notes" text,
	"__v" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL,
	"createdBy" uuid NOT NULL,
	"updatedBy" uuid
);
--> statement-breakpoint
CREATE TABLE "crm_ProductCategories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"order" integer DEFAULT 0 NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL,
	"createdBy" uuid NOT NULL,
	"updatedBy" uuid
);
--> statement-breakpoint
CREATE TABLE "crm_Products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"sku" text,
	"type" "crm_Product_Type" NOT NULL,
	"status" "crm_Product_Status" DEFAULT 'DRAFT' NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL,
	"unit_cost" numeric(18, 2),
	"currency" varchar(3) NOT NULL,
	"tax_rate" numeric(5, 2),
	"unit" text,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"billing_period" "crm_Billing_Period",
	"categoryId" uuid,
	"__v" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL,
	"createdBy" uuid NOT NULL,
	"updatedBy" uuid,
	"deletedAt" timestamp(3),
	"deletedBy" uuid
);
--> statement-breakpoint
CREATE TABLE "crm_OpportunityLineItems" (
	"id" uuid PRIMARY KEY NOT NULL,
	"opportunityId" uuid NOT NULL,
	"productId" uuid,
	"name" text NOT NULL,
	"sku" text,
	"description" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL,
	"discount_type" "crm_Discount_Type" DEFAULT 'PERCENTAGE' NOT NULL,
	"discount_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"__v" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL,
	"createdBy" uuid NOT NULL,
	"updatedBy" uuid
);
--> statement-breakpoint
CREATE TABLE "crm_ContractLineItems" (
	"id" uuid PRIMARY KEY NOT NULL,
	"contractId" uuid NOT NULL,
	"productId" uuid,
	"name" text NOT NULL,
	"sku" text,
	"description" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(18, 2) NOT NULL,
	"discount_type" "crm_Discount_Type" DEFAULT 'PERCENTAGE' NOT NULL,
	"discount_value" numeric(18, 2) DEFAULT '0' NOT NULL,
	"line_total" numeric(18, 2) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"__v" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL,
	"createdBy" uuid NOT NULL,
	"updatedBy" uuid
);
--> statement-breakpoint
CREATE TABLE "DocumentsToOpportunities" (
	"document_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	CONSTRAINT "DocumentsToOpportunities_pkey" PRIMARY KEY("document_id","opportunity_id")
);
--> statement-breakpoint
CREATE TABLE "DocumentsToContacts" (
	"document_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	CONSTRAINT "DocumentsToContacts_pkey" PRIMARY KEY("document_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "DocumentsToTasks" (
	"document_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	CONSTRAINT "DocumentsToTasks_pkey" PRIMARY KEY("document_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "BoardWatchers" (
	"board_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "BoardWatchers_pkey" PRIMARY KEY("board_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "ContactsToOpportunities" (
	"contact_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	CONSTRAINT "ContactsToOpportunities_pkey" PRIMARY KEY("contact_id","opportunity_id")
);
--> statement-breakpoint
CREATE TABLE "DocumentsToCrmAccountsTasks" (
	"document_id" uuid NOT NULL,
	"crm_accounts_task_id" uuid NOT NULL,
	CONSTRAINT "DocumentsToCrmAccountsTasks_pkey" PRIMARY KEY("document_id","crm_accounts_task_id")
);
--> statement-breakpoint
CREATE TABLE "DocumentsToLeads" (
	"document_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	CONSTRAINT "DocumentsToLeads_pkey" PRIMARY KEY("document_id","lead_id")
);
--> statement-breakpoint
CREATE TABLE "DocumentsToAccounts" (
	"document_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	CONSTRAINT "DocumentsToAccounts_pkey" PRIMARY KEY("document_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "AccountWatchers" (
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "AccountWatchers_pkey" PRIMARY KEY("account_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "TargetsToTargetLists" (
	"target_id" uuid NOT NULL,
	"target_list_id" uuid NOT NULL,
	CONSTRAINT "TargetsToTargetLists_pkey" PRIMARY KEY("target_id","target_list_id")
);
--> statement-breakpoint
CREATE TABLE "CampaignToTargetLists" (
	"campaign_id" uuid NOT NULL,
	"target_list_id" uuid NOT NULL,
	CONSTRAINT "CampaignToTargetLists_pkey" PRIMARY KEY("campaign_id","target_list_id")
);
--> statement-breakpoint
CREATE TABLE "EmailsToContacts" (
	"emailId" uuid NOT NULL,
	"contactId" uuid NOT NULL,
	CONSTRAINT "EmailsToContacts_pkey" PRIMARY KEY("emailId","contactId")
);
--> statement-breakpoint
CREATE TABLE "EmailsToAccounts" (
	"emailId" uuid NOT NULL,
	"accountId" uuid NOT NULL,
	CONSTRAINT "EmailsToAccounts_pkey" PRIMARY KEY("emailId","accountId")
);
--> statement-breakpoint
ALTER TABLE "Boards" ADD CONSTRAINT "Boards_user_fkey" FOREIGN KEY ("user") REFERENCES "public"."Users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Accounts" ADD CONSTRAINT "crm_Accounts_industry_fkey" FOREIGN KEY ("industry") REFERENCES "public"."crm_Industry_Type"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Accounts" ADD CONSTRAINT "crm_Accounts_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Contacts" ADD CONSTRAINT "crm_Contacts_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Contacts" ADD CONSTRAINT "crm_Contacts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Contacts" ADD CONSTRAINT "crm_Contacts_accountsIDs_fkey" FOREIGN KEY ("accountsIDs") REFERENCES "public"."crm_Accounts"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Contacts" ADD CONSTRAINT "crm_Contacts_contact_type_id_fkey" FOREIGN KEY ("contact_type_id") REFERENCES "public"."crm_Contact_Types"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Accounts_Tasks" ADD CONSTRAINT "crm_Accounts_Tasks_user_fkey" FOREIGN KEY ("user") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Accounts_Tasks" ADD CONSTRAINT "crm_Accounts_Tasks_account_fkey" FOREIGN KEY ("account") REFERENCES "public"."crm_Accounts"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tasksComments" ADD CONSTRAINT "tasksComments_assigned_crm_account_task_fkey" FOREIGN KEY ("assigned_crm_account_task") REFERENCES "public"."crm_Accounts_Tasks"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tasksComments" ADD CONSTRAINT "tasksComments_task_fkey" FOREIGN KEY ("task") REFERENCES "public"."Tasks"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tasksComments" ADD CONSTRAINT "tasksComments_user_fkey" FOREIGN KEY ("user") REFERENCES "public"."Users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Sections" ADD CONSTRAINT "Sections_board_fkey" FOREIGN KEY ("board") REFERENCES "public"."Boards"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Tasks" ADD CONSTRAINT "Tasks_user_fkey" FOREIGN KEY ("user") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Tasks" ADD CONSTRAINT "Tasks_section_fkey" FOREIGN KEY ("section") REFERENCES "public"."Sections"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invoices" ADD CONSTRAINT "Invoices_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."Users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invoices" ADD CONSTRAINT "Invoices_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "public"."Invoice_Series"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invoices" ADD CONSTRAINT "Invoices_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."crm_Accounts"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invoices" ADD CONSTRAINT "Invoices_currency_fkey" FOREIGN KEY ("currency") REFERENCES "public"."Currency"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invoices" ADD CONSTRAINT "Invoices_originalInvoiceId_fkey" FOREIGN KEY ("originalInvoiceId") REFERENCES "public"."Invoices"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Target_Contact" ADD CONSTRAINT "crm_Target_Contact_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "public"."crm_Targets"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Target_Contact" ADD CONSTRAINT "crm_Target_Contact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."crm_Contacts"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Embeddings_Accounts" ADD CONSTRAINT "crm_Embeddings_Accounts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."crm_Accounts"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invoice_Attachments" ADD CONSTRAINT "Invoice_Attachments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."Invoices"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invoice_Attachments" ADD CONSTRAINT "Invoice_Attachments_uploadedBy_fkey" FOREIGN KEY ("uploadedBy") REFERENCES "public"."Users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invoice_LineItems" ADD CONSTRAINT "Invoice_LineItems_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."Invoices"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invoice_LineItems" ADD CONSTRAINT "Invoice_LineItems_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."crm_Products"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invoice_LineItems" ADD CONSTRAINT "Invoice_LineItems_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "public"."Invoice_TaxRates"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invoice_Payments" ADD CONSTRAINT "Invoice_Payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."Invoices"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invoice_Payments" ADD CONSTRAINT "Invoice_Payments_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."Users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Embeddings_Opportunities" ADD CONSTRAINT "crm_Embeddings_Opportunities_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_Opportunities"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ApiKeys" ADD CONSTRAINT "ApiKeys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Contact_Enrichment" ADD CONSTRAINT "crm_Contact_Enrichment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."crm_Contacts"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Contact_Enrichment" ADD CONSTRAINT "crm_Contact_Enrichment_triggeredBy_fkey" FOREIGN KEY ("triggeredBy") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Embeddings_Contacts" ADD CONSTRAINT "crm_Embeddings_Contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_Contacts"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Embeddings_Leads" ADD CONSTRAINT "crm_Embeddings_Leads_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."crm_Leads"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invoice_Activity" ADD CONSTRAINT "Invoice_Activity_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."Invoices"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invoice_Activity" ADD CONSTRAINT "Invoice_Activity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."Users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Target_Enrichment" ADD CONSTRAINT "crm_Target_Enrichment_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "public"."crm_Targets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Target_Enrichment" ADD CONSTRAINT "crm_Target_Enrichment_triggeredBy_fkey" FOREIGN KEY ("triggeredBy") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Targets" ADD CONSTRAINT "crm_Targets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Targets" ADD CONSTRAINT "crm_Targets_converted_account_id_fkey" FOREIGN KEY ("converted_account_id") REFERENCES "public"."crm_Accounts"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Targets" ADD CONSTRAINT "crm_Targets_converted_contact_id_fkey" FOREIGN KEY ("converted_contact_id") REFERENCES "public"."crm_Contacts"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_TargetLists" ADD CONSTRAINT "crm_TargetLists_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_campaign_steps" ADD CONSTRAINT "crm_campaign_steps_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."crm_campaigns"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_campaign_steps" ADD CONSTRAINT "crm_campaign_steps_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."crm_campaign_templates"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_campaign_sends" ADD CONSTRAINT "crm_campaign_sends_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."crm_campaigns"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_campaign_sends" ADD CONSTRAINT "crm_campaign_sends_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "public"."crm_campaign_steps"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_campaign_sends" ADD CONSTRAINT "crm_campaign_sends_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "public"."crm_Targets"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_campaign_templates" ADD CONSTRAINT "crm_campaign_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."crm_campaign_templates"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_campaigns" ADD CONSTRAINT "crm_campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EmailAccount" ADD CONSTRAINT "EmailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Email" ADD CONSTRAINT "Email_emailAccountId_fkey" FOREIGN KEY ("emailAccountId") REFERENCES "public"."EmailAccount"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Email" ADD CONSTRAINT "Email_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EmailEmbedding" ADD CONSTRAINT "EmailEmbedding_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "public"."Email"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD CONSTRAINT "crm_Leads_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD CONSTRAINT "crm_Leads_accountsIDs_fkey" FOREIGN KEY ("accountsIDs") REFERENCES "public"."crm_Accounts"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD CONSTRAINT "crm_Leads_lead_source_id_fkey" FOREIGN KEY ("lead_source_id") REFERENCES "public"."crm_Lead_Sources"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD CONSTRAINT "crm_Leads_lead_status_id_fkey" FOREIGN KEY ("lead_status_id") REFERENCES "public"."crm_Lead_Statuses"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Leads" ADD CONSTRAINT "crm_Leads_lead_type_id_fkey" FOREIGN KEY ("lead_type_id") REFERENCES "public"."crm_Lead_Types"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invoice_Settings" ADD CONSTRAINT "Invoice_Settings_defaultSeriesId_fkey" FOREIGN KEY ("defaultSeriesId") REFERENCES "public"."Invoice_Series"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Invoice_Settings" ADD CONSTRAINT "Invoice_Settings_defaultTaxRateId_fkey" FOREIGN KEY ("defaultTaxRateId") REFERENCES "public"."Invoice_TaxRates"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_ActivityLinks" ADD CONSTRAINT "crm_ActivityLinks_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "public"."crm_Activities"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_AuditLog" ADD CONSTRAINT "crm_AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Report_Config" ADD CONSTRAINT "crm_Report_Config_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."Users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Report_Schedule" ADD CONSTRAINT "crm_Report_Schedule_reportConfigId_fkey" FOREIGN KEY ("reportConfigId") REFERENCES "public"."crm_Report_Config"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Report_Schedule" ADD CONSTRAINT "crm_Report_Schedule_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."Users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Activities" ADD CONSTRAINT "crm_Activities_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Activities" ADD CONSTRAINT "crm_Activities_updatedBy_fkey" FOREIGN KEY ("updatedBy") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Documents" ADD CONSTRAINT "Documents_created_by_user_fkey" FOREIGN KEY ("created_by_user") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Documents" ADD CONSTRAINT "Documents_assigned_user_fkey" FOREIGN KEY ("assigned_user") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Documents" ADD CONSTRAINT "Documents_document_type_fkey" FOREIGN KEY ("document_type") REFERENCES "public"."Documents_Types"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Documents" ADD CONSTRAINT "Documents_parent_document_id_fkey" FOREIGN KEY ("parent_document_id") REFERENCES "public"."Documents"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."Users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Embeddings_Documents" ADD CONSTRAINT "crm_Embeddings_Documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."Documents"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Document_Chunks" ADD CONSTRAINT "crm_Document_Chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."Documents"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Opportunities" ADD CONSTRAINT "crm_Opportunities_type_fkey" FOREIGN KEY ("type") REFERENCES "public"."crm_Opportunities_Type"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Opportunities" ADD CONSTRAINT "crm_Opportunities_sales_stage_fkey" FOREIGN KEY ("sales_stage") REFERENCES "public"."crm_Opportunities_Sales_Stages"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Opportunities" ADD CONSTRAINT "crm_Opportunities_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Opportunities" ADD CONSTRAINT "crm_Opportunities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Opportunities" ADD CONSTRAINT "crm_Opportunities_account_fkey" FOREIGN KEY ("account") REFERENCES "public"."crm_Accounts"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Opportunities" ADD CONSTRAINT "crm_Opportunities_campaign_fkey" FOREIGN KEY ("campaign") REFERENCES "public"."crm_campaigns"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Opportunities" ADD CONSTRAINT "crm_Opportunities_currency_fkey" FOREIGN KEY ("currency") REFERENCES "public"."Currency"("code") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Contracts" ADD CONSTRAINT "crm_Contracts_account_fkey" FOREIGN KEY ("account") REFERENCES "public"."crm_Accounts"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Contracts" ADD CONSTRAINT "crm_Contracts_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Contracts" ADD CONSTRAINT "crm_Contracts_currency_fkey" FOREIGN KEY ("currency") REFERENCES "public"."Currency"("code") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_fromCurrency_fkey" FOREIGN KEY ("fromCurrency") REFERENCES "public"."Currency"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ExchangeRate" ADD CONSTRAINT "ExchangeRate_toCurrency_fkey" FOREIGN KEY ("toCurrency") REFERENCES "public"."Currency"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_AccountProducts" ADD CONSTRAINT "crm_AccountProducts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."crm_Accounts"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_AccountProducts" ADD CONSTRAINT "crm_AccountProducts_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."crm_Products"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_AccountProducts" ADD CONSTRAINT "crm_AccountProducts_currency_fkey" FOREIGN KEY ("currency") REFERENCES "public"."Currency"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Products" ADD CONSTRAINT "crm_Products_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "public"."crm_ProductCategories"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Products" ADD CONSTRAINT "crm_Products_currency_fkey" FOREIGN KEY ("currency") REFERENCES "public"."Currency"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Products" ADD CONSTRAINT "crm_Products_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."Users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_OpportunityLineItems" ADD CONSTRAINT "crm_OpportunityLineItems_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "public"."crm_Opportunities"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_OpportunityLineItems" ADD CONSTRAINT "crm_OpportunityLineItems_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."crm_Products"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_ContractLineItems" ADD CONSTRAINT "crm_ContractLineItems_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "public"."crm_Contracts"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_ContractLineItems" ADD CONSTRAINT "crm_ContractLineItems_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."crm_Products"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DocumentsToOpportunities" ADD CONSTRAINT "DocumentsToOpportunities_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."Documents"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DocumentsToOpportunities" ADD CONSTRAINT "DocumentsToOpportunities_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_Opportunities"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DocumentsToContacts" ADD CONSTRAINT "DocumentsToContacts_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."Documents"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DocumentsToContacts" ADD CONSTRAINT "DocumentsToContacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_Contacts"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DocumentsToTasks" ADD CONSTRAINT "DocumentsToTasks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."Documents"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DocumentsToTasks" ADD CONSTRAINT "DocumentsToTasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "public"."Tasks"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "BoardWatchers" ADD CONSTRAINT "BoardWatchers_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."Boards"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "BoardWatchers" ADD CONSTRAINT "BoardWatchers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."Users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ContactsToOpportunities" ADD CONSTRAINT "ContactsToOpportunities_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_Contacts"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ContactsToOpportunities" ADD CONSTRAINT "ContactsToOpportunities_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_Opportunities"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DocumentsToCrmAccountsTasks" ADD CONSTRAINT "DocumentsToCrmAccountsTasks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."Documents"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DocumentsToCrmAccountsTasks" ADD CONSTRAINT "DocumentsToCrmAccountsTasks_crm_accounts_task_id_fkey" FOREIGN KEY ("crm_accounts_task_id") REFERENCES "public"."crm_Accounts_Tasks"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DocumentsToLeads" ADD CONSTRAINT "DocumentsToLeads_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."Documents"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DocumentsToLeads" ADD CONSTRAINT "DocumentsToLeads_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "public"."crm_Leads"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DocumentsToAccounts" ADD CONSTRAINT "DocumentsToAccounts_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."Documents"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "DocumentsToAccounts" ADD CONSTRAINT "DocumentsToAccounts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."crm_Accounts"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AccountWatchers" ADD CONSTRAINT "AccountWatchers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."crm_Accounts"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AccountWatchers" ADD CONSTRAINT "AccountWatchers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."Users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TargetsToTargetLists" ADD CONSTRAINT "TargetsToTargetLists_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "public"."crm_Targets"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "TargetsToTargetLists" ADD CONSTRAINT "TargetsToTargetLists_target_list_id_fkey" FOREIGN KEY ("target_list_id") REFERENCES "public"."crm_TargetLists"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CampaignToTargetLists" ADD CONSTRAINT "CampaignToTargetLists_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."crm_campaigns"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CampaignToTargetLists" ADD CONSTRAINT "CampaignToTargetLists_target_list_id_fkey" FOREIGN KEY ("target_list_id") REFERENCES "public"."crm_TargetLists"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EmailsToContacts" ADD CONSTRAINT "EmailsToContacts_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "public"."Email"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EmailsToContacts" ADD CONSTRAINT "EmailsToContacts_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."crm_Contacts"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EmailsToAccounts" ADD CONSTRAINT "EmailsToAccounts_emailId_fkey" FOREIGN KEY ("emailId") REFERENCES "public"."Email"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "EmailsToAccounts" ADD CONSTRAINT "EmailsToAccounts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."crm_Accounts"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "Boards_createdAt_idx" ON "Boards" USING btree ("createdAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "Boards_createdBy_idx" ON "Boards" USING btree ("createdBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "Boards_deletedAt_idx" ON "Boards" USING btree ("deletedAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "Boards_favourite_idx" ON "Boards" USING btree ("favourite" bool_ops);--> statement-breakpoint
CREATE INDEX "Boards_updatedBy_idx" ON "Boards" USING btree ("updatedBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "Boards_user_favourite_idx" ON "Boards" USING btree ("user" bool_ops,"favourite" bool_ops);--> statement-breakpoint
CREATE INDEX "Boards_user_idx" ON "Boards" USING btree ("user" uuid_ops);--> statement-breakpoint
CREATE INDEX "Boards_visibility_idx" ON "Boards" USING btree ("visibility" text_ops);--> statement-breakpoint
CREATE INDEX "crm_Accounts_assigned_to_idx" ON "crm_Accounts" USING btree ("assigned_to" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Accounts_createdAt_idx" ON "crm_Accounts" USING btree ("createdAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Accounts_createdBy_idx" ON "crm_Accounts" USING btree ("createdBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Accounts_deletedAt_idx" ON "crm_Accounts" USING btree ("deletedAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Accounts_industry_idx" ON "crm_Accounts" USING btree ("industry" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Accounts_status_idx" ON "crm_Accounts" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "crm_Accounts_type_idx" ON "crm_Accounts" USING btree ("type" text_ops);--> statement-breakpoint
CREATE INDEX "crm_Accounts_updatedBy_idx" ON "crm_Accounts" USING btree ("updatedBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Contacts_accountsIDs_idx" ON "crm_Contacts" USING btree ("accountsIDs" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Contacts_assigned_to_idx" ON "crm_Contacts" USING btree ("assigned_to" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Contacts_contact_type_id_idx" ON "crm_Contacts" USING btree ("contact_type_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Contacts_cratedAt_idx" ON "crm_Contacts" USING btree ("cratedAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Contacts_createdBy_idx" ON "crm_Contacts" USING btree ("createdBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Contacts_created_by_idx" ON "crm_Contacts" USING btree ("created_by" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Contacts_deletedAt_idx" ON "crm_Contacts" USING btree ("deletedAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Contacts_last_activity_idx" ON "crm_Contacts" USING btree ("last_activity" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Contacts_status_idx" ON "crm_Contacts" USING btree ("status" bool_ops);--> statement-breakpoint
CREATE INDEX "crm_Contacts_updatedBy_idx" ON "crm_Contacts" USING btree ("updatedBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Accounts_Tasks_account_idx" ON "crm_Accounts_Tasks" USING btree ("account" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Accounts_Tasks_account_taskStatus_idx" ON "crm_Accounts_Tasks" USING btree ("account" enum_ops,"taskStatus" enum_ops);--> statement-breakpoint
CREATE INDEX "crm_Accounts_Tasks_createdAt_idx" ON "crm_Accounts_Tasks" USING btree ("createdAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Accounts_Tasks_createdBy_idx" ON "crm_Accounts_Tasks" USING btree ("createdBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Accounts_Tasks_dueDateAt_idx" ON "crm_Accounts_Tasks" USING btree ("dueDateAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Accounts_Tasks_priority_idx" ON "crm_Accounts_Tasks" USING btree ("priority" text_ops);--> statement-breakpoint
CREATE INDEX "crm_Accounts_Tasks_taskStatus_idx" ON "crm_Accounts_Tasks" USING btree ("taskStatus" enum_ops);--> statement-breakpoint
CREATE INDEX "crm_Accounts_Tasks_updatedBy_idx" ON "crm_Accounts_Tasks" USING btree ("updatedBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Accounts_Tasks_user_idx" ON "crm_Accounts_Tasks" USING btree ("user" uuid_ops);--> statement-breakpoint
CREATE INDEX "tasksComments_assigned_crm_account_task_idx" ON "tasksComments" USING btree ("assigned_crm_account_task" uuid_ops);--> statement-breakpoint
CREATE INDEX "tasksComments_task_idx" ON "tasksComments" USING btree ("task" uuid_ops);--> statement-breakpoint
CREATE INDEX "tasksComments_user_idx" ON "tasksComments" USING btree ("user" uuid_ops);--> statement-breakpoint
CREATE INDEX "Sections_board_idx" ON "Sections" USING btree ("board" uuid_ops);--> statement-breakpoint
CREATE INDEX "Tasks_createdAt_idx" ON "Tasks" USING btree ("createdAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "Tasks_createdBy_idx" ON "Tasks" USING btree ("createdBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "Tasks_dueDateAt_idx" ON "Tasks" USING btree ("dueDateAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "Tasks_priority_idx" ON "Tasks" USING btree ("priority" text_ops);--> statement-breakpoint
CREATE INDEX "Tasks_section_idx" ON "Tasks" USING btree ("section" uuid_ops);--> statement-breakpoint
CREATE INDEX "Tasks_taskStatus_idx" ON "Tasks" USING btree ("taskStatus" enum_ops);--> statement-breakpoint
CREATE INDEX "Tasks_updatedBy_idx" ON "Tasks" USING btree ("updatedBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "Tasks_user_idx" ON "Tasks" USING btree ("user" uuid_ops);--> statement-breakpoint
CREATE INDEX "Tasks_user_taskStatus_idx" ON "Tasks" USING btree ("user" uuid_ops,"taskStatus" uuid_ops);--> statement-breakpoint
CREATE INDEX "Invoices_accountId_idx" ON "Invoices" USING btree ("accountId" uuid_ops);--> statement-breakpoint
CREATE INDEX "Invoices_createdBy_idx" ON "Invoices" USING btree ("createdBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "Invoices_dueDate_idx" ON "Invoices" USING btree ("dueDate" timestamp_ops);--> statement-breakpoint
CREATE INDEX "Invoices_issueDate_idx" ON "Invoices" USING btree ("issueDate" timestamp_ops);--> statement-breakpoint
CREATE INDEX "Invoices_originalInvoiceId_idx" ON "Invoices" USING btree ("originalInvoiceId" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "Invoices_seriesId_number_key" ON "Invoices" USING btree ("seriesId" text_ops,"number" text_ops);--> statement-breakpoint
CREATE INDEX "Invoices_status_idx" ON "Invoices" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "crm_Target_Contact_enrichStatus_idx" ON "crm_Target_Contact" USING btree ("enrichStatus" enum_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "crm_Target_Contact_targetId_email_key" ON "crm_Target_Contact" USING btree ("targetId" uuid_ops,"email" text_ops);--> statement-breakpoint
CREATE INDEX "crm_Target_Contact_targetId_idx" ON "crm_Target_Contact" USING btree ("targetId" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "crm_Target_Contact_targetId_linkedinUrl_key" ON "crm_Target_Contact" USING btree ("targetId" text_ops,"linkedinUrl" uuid_ops);--> statement-breakpoint
CREATE INDEX "Users_created_on_idx" ON "Users" USING btree ("created_on" timestamp_ops);--> statement-breakpoint
CREATE INDEX "Users_email_idx" ON "Users" USING btree ("email" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "Users_email_key" ON "Users" USING btree ("email" text_ops);--> statement-breakpoint
CREATE INDEX "Users_is_account_admin_idx" ON "Users" USING btree ("is_account_admin" bool_ops);--> statement-breakpoint
CREATE INDEX "Users_is_admin_idx" ON "Users" USING btree ("is_admin" bool_ops);--> statement-breakpoint
CREATE INDEX "Users_lastLoginAt_idx" ON "Users" USING btree ("lastLoginAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "Users_userLanguage_idx" ON "Users" USING btree ("userLanguage" enum_ops);--> statement-breakpoint
CREATE INDEX "Users_userStatus_idx" ON "Users" USING btree ("userStatus" enum_ops);--> statement-breakpoint
CREATE INDEX "Invoice_Attachments_invoiceId_idx" ON "Invoice_Attachments" USING btree ("invoiceId" uuid_ops);--> statement-breakpoint
CREATE INDEX "Invoice_LineItems_invoiceId_idx" ON "Invoice_LineItems" USING btree ("invoiceId" uuid_ops);--> statement-breakpoint
CREATE INDEX "Invoice_LineItems_productId_idx" ON "Invoice_LineItems" USING btree ("productId" uuid_ops);--> statement-breakpoint
CREATE INDEX "Invoice_LineItems_taxRateId_idx" ON "Invoice_LineItems" USING btree ("taxRateId" uuid_ops);--> statement-breakpoint
CREATE INDEX "Invoice_Payments_invoiceId_idx" ON "Invoice_Payments" USING btree ("invoiceId" uuid_ops);--> statement-breakpoint
CREATE INDEX "ApiKeys_scope_provider_idx" ON "ApiKeys" USING btree ("scope" enum_ops,"provider" enum_ops);--> statement-breakpoint
CREATE INDEX "ApiKeys_userId_provider_idx" ON "ApiKeys" USING btree ("userId" uuid_ops,"provider" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_system_provider_unique" ON "ApiKeys" USING btree ("provider" enum_ops) WHERE (scope = 'SYSTEM'::"ApiKeyScope");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_user_provider_unique" ON "ApiKeys" USING btree ("userId" uuid_ops,"provider" uuid_ops) WHERE (scope = 'USER'::"ApiKeyScope");--> statement-breakpoint
CREATE UNIQUE INDEX "ApiToken_tokenHash_key" ON "ApiToken" USING btree ("tokenHash" text_ops);--> statement-breakpoint
CREATE INDEX "ApiToken_userId_idx" ON "ApiToken" USING btree ("userId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Contact_Enrichment_contactId_idx" ON "crm_Contact_Enrichment" USING btree ("contactId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Contact_Enrichment_createdAt_idx" ON "crm_Contact_Enrichment" USING btree ("createdAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Contact_Enrichment_status_idx" ON "crm_Contact_Enrichment" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "crm_Contact_Enrichment_triggeredBy_idx" ON "crm_Contact_Enrichment" USING btree ("triggeredBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "Invoice_Activity_invoiceId_idx" ON "Invoice_Activity" USING btree ("invoiceId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Target_Enrichment_createdAt_idx" ON "crm_Target_Enrichment" USING btree ("createdAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Target_Enrichment_status_idx" ON "crm_Target_Enrichment" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "crm_Target_Enrichment_targetId_idx" ON "crm_Target_Enrichment" USING btree ("targetId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Target_Enrichment_triggeredBy_idx" ON "crm_Target_Enrichment" USING btree ("triggeredBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Targets_converted_account_id_idx" ON "crm_Targets" USING btree ("converted_account_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Targets_converted_contact_id_idx" ON "crm_Targets" USING btree ("converted_contact_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Targets_created_by_idx" ON "crm_Targets" USING btree ("created_by" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Targets_created_on_idx" ON "crm_Targets" USING btree ("created_on" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Targets_deletedAt_idx" ON "crm_Targets" USING btree ("deletedAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Targets_status_idx" ON "crm_Targets" USING btree ("status" bool_ops);--> statement-breakpoint
CREATE INDEX "crm_TargetLists_created_by_idx" ON "crm_TargetLists" USING btree ("created_by" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_TargetLists_deletedAt_idx" ON "crm_TargetLists" USING btree ("deletedAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_TargetLists_status_idx" ON "crm_TargetLists" USING btree ("status" bool_ops);--> statement-breakpoint
CREATE INDEX "crm_campaign_steps_campaign_id_idx" ON "crm_campaign_steps" USING btree ("campaign_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "crm_campaign_steps_campaign_id_order_key" ON "crm_campaign_steps" USING btree ("campaign_id" int4_ops,"order" int4_ops);--> statement-breakpoint
CREATE INDEX "crm_campaign_steps_scheduled_at_idx" ON "crm_campaign_steps" USING btree ("scheduled_at" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_campaign_sends_campaign_id_idx" ON "crm_campaign_sends" USING btree ("campaign_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_campaign_sends_resend_message_id_idx" ON "crm_campaign_sends" USING btree ("resend_message_id" text_ops);--> statement-breakpoint
CREATE INDEX "crm_campaign_sends_status_idx" ON "crm_campaign_sends" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "crm_campaign_sends_step_id_target_id_idx" ON "crm_campaign_sends" USING btree ("step_id" uuid_ops,"target_id" uuid_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "crm_campaign_sends_step_id_target_id_key" ON "crm_campaign_sends" USING btree ("step_id" uuid_ops,"target_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_campaign_sends_unsubscribe_token_idx" ON "crm_campaign_sends" USING btree ("unsubscribe_token" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "crm_campaign_sends_unsubscribe_token_key" ON "crm_campaign_sends" USING btree ("unsubscribe_token" text_ops);--> statement-breakpoint
CREATE INDEX "crm_campaign_templates_created_by_idx" ON "crm_campaign_templates" USING btree ("created_by" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_campaign_templates_deletedAt_idx" ON "crm_campaign_templates" USING btree ("deletedAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_campaigns_deletedAt_idx" ON "crm_campaigns" USING btree ("deletedAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "EmailAccount_isActive_idx" ON "EmailAccount" USING btree ("isActive" bool_ops);--> statement-breakpoint
CREATE INDEX "EmailAccount_userId_idx" ON "EmailAccount" USING btree ("userId" uuid_ops);--> statement-breakpoint
CREATE INDEX "Email_emailAccountId_idx" ON "Email" USING btree ("emailAccountId" uuid_ops);--> statement-breakpoint
CREATE INDEX "Email_folder_idx" ON "Email" USING btree ("folder" enum_ops);--> statement-breakpoint
CREATE INDEX "Email_isDeleted_idx" ON "Email" USING btree ("isDeleted" bool_ops);--> statement-breakpoint
CREATE INDEX "Email_sentAt_idx" ON "Email" USING btree ("sentAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "Email_userId_folder_isDeleted_isRead_idx" ON "Email" USING btree ("userId" uuid_ops,"folder" bool_ops,"isDeleted" enum_ops,"isRead" enum_ops);--> statement-breakpoint
CREATE INDEX "Email_userId_idx" ON "Email" USING btree ("userId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Contact_Types_name_idx" ON "crm_Contact_Types" USING btree ("name" text_ops);--> statement-breakpoint
CREATE INDEX "crm_Lead_Sources_name_idx" ON "crm_Lead_Sources" USING btree ("name" text_ops);--> statement-breakpoint
CREATE INDEX "crm_Lead_Statuses_name_idx" ON "crm_Lead_Statuses" USING btree ("name" text_ops);--> statement-breakpoint
CREATE INDEX "crm_Lead_Types_name_idx" ON "crm_Lead_Types" USING btree ("name" text_ops);--> statement-breakpoint
CREATE INDEX "crm_Leads_accountsIDs_idx" ON "crm_Leads" USING btree ("accountsIDs" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Leads_assigned_to_idx" ON "crm_Leads" USING btree ("assigned_to" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Leads_createdAt_idx" ON "crm_Leads" USING btree ("createdAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Leads_createdBy_idx" ON "crm_Leads" USING btree ("createdBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Leads_deletedAt_idx" ON "crm_Leads" USING btree ("deletedAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Leads_lead_source_id_idx" ON "crm_Leads" USING btree ("lead_source_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Leads_lead_status_id_idx" ON "crm_Leads" USING btree ("lead_status_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Leads_lead_type_id_idx" ON "crm_Leads" USING btree ("lead_type_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Leads_updatedBy_idx" ON "crm_Leads" USING btree ("updatedBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_ActivityLinks_activityId_idx" ON "crm_ActivityLinks" USING btree ("activityId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_ActivityLinks_entityType_entityId_activityId_idx" ON "crm_ActivityLinks" USING btree ("entityType" text_ops,"entityId" uuid_ops,"activityId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_AuditLog_createdAt_idx" ON "crm_AuditLog" USING btree ("createdAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_AuditLog_entityType_createdAt_idx" ON "crm_AuditLog" USING btree ("entityType" text_ops,"createdAt" text_ops);--> statement-breakpoint
CREATE INDEX "crm_AuditLog_entityType_entityId_createdAt_idx" ON "crm_AuditLog" USING btree ("entityType" text_ops,"entityId" timestamp_ops,"createdAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_AuditLog_userId_idx" ON "crm_AuditLog" USING btree ("userId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Report_Config_category_idx" ON "crm_Report_Config" USING btree ("category" text_ops);--> statement-breakpoint
CREATE INDEX "crm_Report_Config_createdBy_idx" ON "crm_Report_Config" USING btree ("createdBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Report_Config_isShared_idx" ON "crm_Report_Config" USING btree ("isShared" bool_ops);--> statement-breakpoint
CREATE INDEX "crm_Report_Schedule_createdBy_idx" ON "crm_Report_Schedule" USING btree ("createdBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Report_Schedule_isActive_idx" ON "crm_Report_Schedule" USING btree ("isActive" bool_ops);--> statement-breakpoint
CREATE INDEX "crm_Report_Schedule_lastSentAt_idx" ON "crm_Report_Schedule" USING btree ("lastSentAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Report_Schedule_reportConfigId_idx" ON "crm_Report_Schedule" USING btree ("reportConfigId" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_key" ON "session" USING btree ("token" text_ops);--> statement-breakpoint
CREATE INDEX "crm_Activities_createdAt_idx" ON "crm_Activities" USING btree ("createdAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Activities_createdBy_idx" ON "crm_Activities" USING btree ("createdBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Activities_date_idx" ON "crm_Activities" USING btree ("date" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Activities_deletedAt_idx" ON "crm_Activities" USING btree ("deletedAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Activities_status_idx" ON "crm_Activities" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "crm_Activities_type_idx" ON "crm_Activities" USING btree ("type" enum_ops);--> statement-breakpoint
CREATE INDEX "Documents_assigned_user_idx" ON "Documents" USING btree ("assigned_user" uuid_ops);--> statement-breakpoint
CREATE INDEX "Documents_content_hash_idx" ON "Documents" USING btree ("content_hash" text_ops);--> statement-breakpoint
CREATE INDEX "Documents_createdAt_idx" ON "Documents" USING btree ("createdAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "Documents_createdBy_idx" ON "Documents" USING btree ("createdBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "Documents_created_by_user_idx" ON "Documents" USING btree ("created_by_user" uuid_ops);--> statement-breakpoint
CREATE INDEX "Documents_deletedAt_idx" ON "Documents" USING btree ("deletedAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "Documents_document_system_type_idx" ON "Documents" USING btree ("document_system_type" enum_ops);--> statement-breakpoint
CREATE INDEX "Documents_document_type_idx" ON "Documents" USING btree ("document_type" uuid_ops);--> statement-breakpoint
CREATE INDEX "Documents_favourite_idx" ON "Documents" USING btree ("favourite" bool_ops);--> statement-breakpoint
CREATE INDEX "Documents_parent_document_id_idx" ON "Documents" USING btree ("parent_document_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "Documents_processing_status_idx" ON "Documents" USING btree ("processing_status" enum_ops);--> statement-breakpoint
CREATE INDEX "Documents_status_idx" ON "Documents" USING btree ("status" text_ops);--> statement-breakpoint
CREATE INDEX "Documents_visibility_idx" ON "Documents" USING btree ("visibility" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "crm_Embeddings_Documents_document_id_key" ON "crm_Embeddings_Documents" USING btree ("document_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Document_Chunks_document_id_idx" ON "crm_Document_Chunks" USING btree ("document_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Opportunities_account_idx" ON "crm_Opportunities" USING btree ("account" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Opportunities_assigned_to_idx" ON "crm_Opportunities" USING btree ("assigned_to" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Opportunities_campaign_idx" ON "crm_Opportunities" USING btree ("campaign" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Opportunities_close_date_idx" ON "crm_Opportunities" USING btree ("close_date" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Opportunities_contact_idx" ON "crm_Opportunities" USING btree ("contact" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Opportunities_createdAt_idx" ON "crm_Opportunities" USING btree ("createdAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Opportunities_created_by_idx" ON "crm_Opportunities" USING btree ("created_by" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Opportunities_deletedAt_idx" ON "crm_Opportunities" USING btree ("deletedAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Opportunities_sales_stage_idx" ON "crm_Opportunities" USING btree ("sales_stage" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Opportunities_status_idx" ON "crm_Opportunities" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "crm_Opportunities_status_sales_stage_idx" ON "crm_Opportunities" USING btree ("status" enum_ops,"sales_stage" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Opportunities_type_idx" ON "crm_Opportunities" USING btree ("type" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Contracts_account_idx" ON "crm_Contracts" USING btree ("account" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Contracts_assigned_to_idx" ON "crm_Contracts" USING btree ("assigned_to" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Contracts_createdAt_idx" ON "crm_Contracts" USING btree ("createdAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Contracts_createdBy_idx" ON "crm_Contracts" USING btree ("createdBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Contracts_deletedAt_idx" ON "crm_Contracts" USING btree ("deletedAt" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Contracts_endDate_idx" ON "crm_Contracts" USING btree ("endDate" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Contracts_startDate_endDate_idx" ON "crm_Contracts" USING btree ("startDate" timestamp_ops,"endDate" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Contracts_startDate_idx" ON "crm_Contracts" USING btree ("startDate" timestamp_ops);--> statement-breakpoint
CREATE INDEX "crm_Contracts_status_idx" ON "crm_Contracts" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "crm_Contracts_updatedBy_idx" ON "crm_Contracts" USING btree ("updatedBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "ExchangeRate_fromCurrency_idx" ON "ExchangeRate" USING btree ("fromCurrency" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ExchangeRate_fromCurrency_toCurrency_key" ON "ExchangeRate" USING btree ("fromCurrency" text_ops,"toCurrency" text_ops);--> statement-breakpoint
CREATE INDEX "ExchangeRate_toCurrency_idx" ON "ExchangeRate" USING btree ("toCurrency" text_ops);--> statement-breakpoint
CREATE INDEX "crm_AccountProducts_accountId_idx" ON "crm_AccountProducts" USING btree ("accountId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_AccountProducts_accountId_productId_idx" ON "crm_AccountProducts" USING btree ("accountId" uuid_ops,"productId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_AccountProducts_productId_idx" ON "crm_AccountProducts" USING btree ("productId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_AccountProducts_status_idx" ON "crm_AccountProducts" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "crm_ProductCategories_isActive_idx" ON "crm_ProductCategories" USING btree ("isActive" bool_ops);--> statement-breakpoint
CREATE INDEX "crm_Products_categoryId_idx" ON "crm_Products" USING btree ("categoryId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Products_createdBy_idx" ON "crm_Products" USING btree ("createdBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Products_deletedAt_idx" ON "crm_Products" USING btree ("deletedAt" timestamp_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "crm_Products_sku_key" ON "crm_Products" USING btree ("sku" text_ops);--> statement-breakpoint
CREATE INDEX "crm_Products_status_idx" ON "crm_Products" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "crm_Products_type_idx" ON "crm_Products" USING btree ("type" enum_ops);--> statement-breakpoint
CREATE INDEX "crm_OpportunityLineItems_opportunityId_idx" ON "crm_OpportunityLineItems" USING btree ("opportunityId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_OpportunityLineItems_productId_idx" ON "crm_OpportunityLineItems" USING btree ("productId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_ContractLineItems_contractId_idx" ON "crm_ContractLineItems" USING btree ("contractId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_ContractLineItems_productId_idx" ON "crm_ContractLineItems" USING btree ("productId" uuid_ops);--> statement-breakpoint
CREATE INDEX "DocumentsToOpportunities_document_id_idx" ON "DocumentsToOpportunities" USING btree ("document_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "DocumentsToOpportunities_opportunity_id_idx" ON "DocumentsToOpportunities" USING btree ("opportunity_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "DocumentsToContacts_contact_id_idx" ON "DocumentsToContacts" USING btree ("contact_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "DocumentsToContacts_document_id_idx" ON "DocumentsToContacts" USING btree ("document_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "DocumentsToTasks_document_id_idx" ON "DocumentsToTasks" USING btree ("document_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "DocumentsToTasks_task_id_idx" ON "DocumentsToTasks" USING btree ("task_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "BoardWatchers_board_id_idx" ON "BoardWatchers" USING btree ("board_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "BoardWatchers_user_id_idx" ON "BoardWatchers" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "ContactsToOpportunities_contact_id_idx" ON "ContactsToOpportunities" USING btree ("contact_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "ContactsToOpportunities_opportunity_id_idx" ON "ContactsToOpportunities" USING btree ("opportunity_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "DocumentsToCrmAccountsTasks_crm_accounts_task_id_idx" ON "DocumentsToCrmAccountsTasks" USING btree ("crm_accounts_task_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "DocumentsToCrmAccountsTasks_document_id_idx" ON "DocumentsToCrmAccountsTasks" USING btree ("document_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "DocumentsToLeads_document_id_idx" ON "DocumentsToLeads" USING btree ("document_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "DocumentsToLeads_lead_id_idx" ON "DocumentsToLeads" USING btree ("lead_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "DocumentsToAccounts_account_id_idx" ON "DocumentsToAccounts" USING btree ("account_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "DocumentsToAccounts_document_id_idx" ON "DocumentsToAccounts" USING btree ("document_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "AccountWatchers_account_id_idx" ON "AccountWatchers" USING btree ("account_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "AccountWatchers_user_id_idx" ON "AccountWatchers" USING btree ("user_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "TargetsToTargetLists_target_id_idx" ON "TargetsToTargetLists" USING btree ("target_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "TargetsToTargetLists_target_list_id_idx" ON "TargetsToTargetLists" USING btree ("target_list_id" uuid_ops);--> statement-breakpoint
CREATE INDEX "EmailsToContacts_contactId_idx" ON "EmailsToContacts" USING btree ("contactId" uuid_ops);--> statement-breakpoint
CREATE INDEX "EmailsToContacts_emailId_idx" ON "EmailsToContacts" USING btree ("emailId" uuid_ops);--> statement-breakpoint
CREATE INDEX "EmailsToAccounts_accountId_idx" ON "EmailsToAccounts" USING btree ("accountId" uuid_ops);--> statement-breakpoint
CREATE INDEX "EmailsToAccounts_emailId_idx" ON "EmailsToAccounts" USING btree ("emailId" uuid_ops);
*/