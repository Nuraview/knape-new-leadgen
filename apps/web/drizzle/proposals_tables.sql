CREATE TYPE "public"."Proposal_Status" AS ENUM('DRAFT', 'SENT', 'VIEWED', 'APPROVED', 'REJECTED', 'EXPIRED', 'PAID');--> statement-breakpoint
CREATE TABLE "crm_Proposal_Activity" (
	"id" uuid PRIMARY KEY NOT NULL,
	"proposalId" uuid NOT NULL,
	"actorId" uuid,
	"action" text NOT NULL,
	"meta" jsonb,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_Proposal_Assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"proposalId" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"kind" text DEFAULT 'PDF' NOT NULL,
	"title" text,
	"storageKey" text NOT NULL,
	"previewStorageKey" text,
	"pageCount" integer,
	"fileSize" integer,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crm_Proposal_LineItems" (
	"id" uuid PRIMARY KEY NOT NULL,
	"proposalId" uuid NOT NULL,
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
	"lineTotal" numeric(14, 2) NOT NULL,
	"clientAdjustable" boolean DEFAULT false NOT NULL,
	"minQty" numeric(14, 4),
	"maxQty" numeric(14, 4)
);
--> statement-breakpoint
CREATE TABLE "crm_Proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" integer,
	"clientSlug" text,
	"title" text NOT NULL,
	"status" "Proposal_Status" DEFAULT 'DRAFT' NOT NULL,
	"accountId" uuid,
	"contactId" uuid,
	"createdBy" uuid NOT NULL,
	"isTemplate" boolean DEFAULT false NOT NULL,
	"templateName" text,
	"sourceTemplateId" uuid,
	"clientName" text,
	"clientCompany" text,
	"projectName" text,
	"proposalDate" timestamp(3),
	"currency" varchar(3) NOT NULL,
	"sections" jsonb,
	"pricingMode" text DEFAULT 'LINE_ITEMS' NOT NULL,
	"fixedPrice" numeric(14, 2),
	"subtotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"discountTotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"taxTotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"transactionFee" numeric(14, 2) DEFAULT '0' NOT NULL,
	"grandTotal" numeric(14, 2) DEFAULT '0' NOT NULL,
	"depositAmount" numeric(14, 2),
	"shareToken" text,
	"sentAt" timestamp(3),
	"firstViewedAt" timestamp(3),
	"lastViewedAt" timestamp(3),
	"decisionAt" timestamp(3),
	"expiresAt" timestamp(3),
	"approvedByName" text,
	"approvedByEmail" text,
	"signatureType" text,
	"signatureTypedName" text,
	"signatureStorageKey" text,
	"signatureIpAddress" text,
	"rejectionReason" text,
	"paymentProvider" text,
	"stripePaymentIntentId" text,
	"stripeCustomerId" text,
	"paypalOrderId" text,
	"paidAt" timestamp(3),
	"linkedInvoiceId" uuid,
	"brandColor" text,
	"logoStorageKey" text,
	"pdfStorageKey" text,
	"pdfGeneratedAt" timestamp(3),
	"publicNotes" text,
	"internalNotes" text,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL,
	"deletedAt" timestamp(3)
);
--> statement-breakpoint
CREATE TABLE "Proposal_Settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"baseCurrency" varchar(3) NOT NULL,
	"defaultExpiryDays" integer DEFAULT 30 NOT NULL,
	"defaultTaxRateId" uuid,
	"defaultTermsHtml" text,
	"logoStorageKey" text,
	"brandColor" text DEFAULT '#2563eb',
	"accentColor" text,
	"fontFamily" text DEFAULT 'Helvetica',
	"clientAvatars" jsonb,
	"companyName" text,
	"companyAddress" text,
	"companyEmail" text,
	"companyPhone" text,
	"companyWebsite" text,
	"footerText" text,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_Proposal_Activity" ADD CONSTRAINT "crm_Proposal_Activity_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "public"."crm_Proposals"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Proposal_Activity" ADD CONSTRAINT "crm_Proposal_Activity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "public"."Users"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Proposal_Assets" ADD CONSTRAINT "crm_Proposal_Assets_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "public"."crm_Proposals"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Proposal_LineItems" ADD CONSTRAINT "crm_Proposal_LineItems_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "public"."crm_Proposals"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Proposal_LineItems" ADD CONSTRAINT "crm_Proposal_LineItems_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."crm_Products"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Proposal_LineItems" ADD CONSTRAINT "crm_Proposal_LineItems_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "public"."Invoice_TaxRates"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Proposals" ADD CONSTRAINT "crm_Proposals_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "public"."Users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Proposals" ADD CONSTRAINT "crm_Proposals_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "public"."crm_Accounts"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Proposals" ADD CONSTRAINT "crm_Proposals_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."crm_Contacts"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Proposals" ADD CONSTRAINT "crm_Proposals_currency_fkey" FOREIGN KEY ("currency") REFERENCES "public"."Currency"("code") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Proposals" ADD CONSTRAINT "crm_Proposals_sourceTemplateId_fkey" FOREIGN KEY ("sourceTemplateId") REFERENCES "public"."crm_Proposals"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "crm_Proposals" ADD CONSTRAINT "crm_Proposals_linkedInvoiceId_fkey" FOREIGN KEY ("linkedInvoiceId") REFERENCES "public"."Invoices"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Proposal_Settings" ADD CONSTRAINT "Proposal_Settings_defaultTaxRateId_fkey" FOREIGN KEY ("defaultTaxRateId") REFERENCES "public"."Invoice_TaxRates"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "crm_Proposal_Activity_proposalId_idx" ON "crm_Proposal_Activity" USING btree ("proposalId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Proposal_Assets_proposalId_idx" ON "crm_Proposal_Assets" USING btree ("proposalId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Proposal_LineItems_proposalId_idx" ON "crm_Proposal_LineItems" USING btree ("proposalId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Proposal_LineItems_productId_idx" ON "crm_Proposal_LineItems" USING btree ("productId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Proposal_LineItems_taxRateId_idx" ON "crm_Proposal_LineItems" USING btree ("taxRateId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Proposals_accountId_idx" ON "crm_Proposals" USING btree ("accountId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Proposals_contactId_idx" ON "crm_Proposals" USING btree ("contactId" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Proposals_createdBy_idx" ON "crm_Proposals" USING btree ("createdBy" uuid_ops);--> statement-breakpoint
CREATE INDEX "crm_Proposals_status_idx" ON "crm_Proposals" USING btree ("status" enum_ops);--> statement-breakpoint
CREATE INDEX "crm_Proposals_isTemplate_idx" ON "crm_Proposals" USING btree ("isTemplate" bool_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "crm_Proposals_shareToken_key" ON "crm_Proposals" USING btree ("shareToken" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "crm_Proposals_number_key" ON "crm_Proposals" USING btree ("number" int4_ops);
