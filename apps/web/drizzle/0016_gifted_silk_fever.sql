ALTER TABLE "crm_Proposal_Assets" ADD COLUMN "category" text DEFAULT 'GENERAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_Proposal_Assets" ADD COLUMN "featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_Proposal_Assets" ADD COLUMN "externalUrl" text;--> statement-breakpoint
ALTER TABLE "crm_Proposals" ADD COLUMN "clientEmail" text;--> statement-breakpoint
ALTER TABLE "crm_Proposals" ADD COLUMN "clientAddress" text;--> statement-breakpoint
ALTER TABLE "crm_Proposals" ADD COLUMN "theme" text DEFAULT 'creative';--> statement-breakpoint
ALTER TABLE "crm_Proposals" ADD COLUMN "videoUrl" text;--> statement-breakpoint
ALTER TABLE "crm_Proposals" ADD COLUMN "scheduleCallUrl" text;--> statement-breakpoint
ALTER TABLE "crm_Proposals" ADD COLUMN "paymentMethod" text;--> statement-breakpoint
ALTER TABLE "crm_Proposals" ADD COLUMN "processingFee" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "crm_Proposals" ADD COLUMN "paypalCaptureId" text;--> statement-breakpoint
ALTER TABLE "Proposal_Settings" ADD COLUMN "bankName" text;--> statement-breakpoint
ALTER TABLE "Proposal_Settings" ADD COLUMN "bankAccountName" text;--> statement-breakpoint
ALTER TABLE "Proposal_Settings" ADD COLUMN "bankAccountNumber" text;--> statement-breakpoint
ALTER TABLE "Proposal_Settings" ADD COLUMN "bankIban" text;--> statement-breakpoint
ALTER TABLE "Proposal_Settings" ADD COLUMN "bankSwift" text;--> statement-breakpoint
ALTER TABLE "Proposal_Settings" ADD COLUMN "bankRouting" text;--> statement-breakpoint
ALTER TABLE "Proposal_Settings" ADD COLUMN "bankInstructions" text;--> statement-breakpoint
ALTER TABLE "Proposal_Settings" ADD COLUMN "scheduleCallUrl" text;--> statement-breakpoint
ALTER TABLE "Proposal_Settings" ADD COLUMN "stripeFeePercent" numeric(5, 2) DEFAULT '3.5';