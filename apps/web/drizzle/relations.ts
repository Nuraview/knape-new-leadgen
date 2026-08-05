import { relations } from "drizzle-orm/relations";
import { crmProposals, crmProposalLineItems, crmProposalAssets, crmProposalActivity } from "./schema";
import { users, boards, crmIndustryType, crmAccounts, crmContacts, crmContactTypes, crmAccountsTasks, tasksComments, tasks, sections, invoices, invoiceSeries, currency, crmTargets, crmTargetContact, crmEmbeddingsAccounts, invoiceAttachments, invoiceLineItems, crmProducts, invoiceTaxRates, invoicePayments, crmOpportunities, crmEmbeddingsOpportunities, apiKeys, apiToken, crmContactEnrichment, crmEmbeddingsContacts, crmLeads, crmEmbeddingsLeads, invoiceActivity, crmTargetEnrichment, crmTargetLists, crmCampaigns, crmCampaignSteps, crmCampaignTemplates, crmCampaignSends, emailAccount, email, emailEmbedding, crmLeadSources, crmLeadStatuses, crmLeadTypes, invoiceSettings, crmActivities, crmActivityLinks, crmAuditLog, crmReportConfig, crmReportSchedule, session, documents, documentsTypes, account, crmEmbeddingsDocuments, crmDocumentChunks, crmOpportunitiesType, crmOpportunitiesSalesStages, crmContracts, exchangeRate, crmAccountProducts, crmProductCategories, crmOpportunityLineItems, crmContractLineItems, documentsToOpportunities, documentsToContacts, documentsToTasks, boardWatchers, contactsToOpportunities, documentsToCrmAccountsTasks, documentsToLeads, documentsToAccounts, accountWatchers, targetsToTargetLists, campaignToTargetLists, emailsToContacts, emailsToAccounts } from "./schema";

export const boardsRelations = relations(boards, ({one, many}) => ({
	user: one(users, {
		fields: [boards.user],
		references: [users.id]
	}),
	sections: many(sections),
	boardWatchers: many(boardWatchers),
}));

export const usersRelations = relations(users, ({many}) => ({
	boards: many(boards),
	crmAccounts: many(crmAccounts),
	crmContacts_assignedTo: many(crmContacts, {
		relationName: "crmContacts_assignedTo_users_id"
	}),
	crmContacts_createdBy: many(crmContacts, {
		relationName: "crmContacts_createdBy_users_id"
	}),
	crmAccountsTasks: many(crmAccountsTasks),
	tasksComments: many(tasksComments),
	tasks: many(tasks),
	invoices: many(invoices),
	invoiceAttachments: many(invoiceAttachments),
	invoicePayments: many(invoicePayments),
	apiKeys: many(apiKeys),
	apiTokens: many(apiToken),
	crmContactEnrichments: many(crmContactEnrichment),
	invoiceActivities: many(invoiceActivity),
	crmTargetEnrichments: many(crmTargetEnrichment),
	crmTargets: many(crmTargets),
	crmTargetLists: many(crmTargetLists),
	crmCampaignTemplates: many(crmCampaignTemplates),
	crmCampaigns: many(crmCampaigns),
	emailAccounts: many(emailAccount),
	emails: many(email),
	crmLeads: many(crmLeads),
	crmAuditLogs: many(crmAuditLog),
	crmReportConfigs: many(crmReportConfig),
	crmReportSchedules: many(crmReportSchedule),
	sessions: many(session),
	crmActivities_createdBy: many(crmActivities, {
		relationName: "crmActivities_createdBy_users_id"
	}),
	crmActivities_updatedBy: many(crmActivities, {
		relationName: "crmActivities_updatedBy_users_id"
	}),
	documents_createdByUser: many(documents, {
		relationName: "documents_createdByUser_users_id"
	}),
	documents_assignedUser: many(documents, {
		relationName: "documents_assignedUser_users_id"
	}),
	accounts: many(account),
	crmOpportunities_assignedTo: many(crmOpportunities, {
		relationName: "crmOpportunities_assignedTo_users_id"
	}),
	crmOpportunities_createdBy: many(crmOpportunities, {
		relationName: "crmOpportunities_createdBy_users_id"
	}),
	crmContracts: many(crmContracts),
	crmProducts: many(crmProducts),
	boardWatchers: many(boardWatchers),
	accountWatchers: many(accountWatchers),
}));

export const crmAccountsRelations = relations(crmAccounts, ({one, many}) => ({
	crmIndustryType: one(crmIndustryType, {
		fields: [crmAccounts.industry],
		references: [crmIndustryType.id]
	}),
	user: one(users, {
		fields: [crmAccounts.assignedTo],
		references: [users.id]
	}),
	crmContacts: many(crmContacts),
	crmAccountsTasks: many(crmAccountsTasks),
	invoices: many(invoices),
	crmEmbeddingsAccounts: many(crmEmbeddingsAccounts),
	crmTargets: many(crmTargets),
	crmLeads: many(crmLeads),
	crmOpportunities: many(crmOpportunities),
	crmContracts: many(crmContracts),
	crmAccountProducts: many(crmAccountProducts),
	documentsToAccounts: many(documentsToAccounts),
	accountWatchers: many(accountWatchers),
	emailsToAccounts: many(emailsToAccounts),
}));

export const crmIndustryTypeRelations = relations(crmIndustryType, ({many}) => ({
	crmAccounts: many(crmAccounts),
}));

export const crmContactsRelations = relations(crmContacts, ({one, many}) => ({
	user_assignedTo: one(users, {
		fields: [crmContacts.assignedTo],
		references: [users.id],
		relationName: "crmContacts_assignedTo_users_id"
	}),
	user_createdBy: one(users, {
		fields: [crmContacts.createdBy],
		references: [users.id],
		relationName: "crmContacts_createdBy_users_id"
	}),
	crmAccount: one(crmAccounts, {
		fields: [crmContacts.accountsIds],
		references: [crmAccounts.id]
	}),
	crmContactType: one(crmContactTypes, {
		fields: [crmContacts.contactTypeId],
		references: [crmContactTypes.id]
	}),
	crmTargetContacts: many(crmTargetContact),
	crmContactEnrichments: many(crmContactEnrichment),
	crmEmbeddingsContacts: many(crmEmbeddingsContacts),
	crmTargets: many(crmTargets),
	documentsToContacts: many(documentsToContacts),
	contactsToOpportunities: many(contactsToOpportunities),
	emailsToContacts: many(emailsToContacts),
}));

export const crmContactTypesRelations = relations(crmContactTypes, ({many}) => ({
	crmContacts: many(crmContacts),
}));

export const crmAccountsTasksRelations = relations(crmAccountsTasks, ({one, many}) => ({
	user: one(users, {
		fields: [crmAccountsTasks.user],
		references: [users.id]
	}),
	crmAccount: one(crmAccounts, {
		fields: [crmAccountsTasks.account],
		references: [crmAccounts.id]
	}),
	tasksComments: many(tasksComments),
	documentsToCrmAccountsTasks: many(documentsToCrmAccountsTasks),
}));

export const tasksCommentsRelations = relations(tasksComments, ({one}) => ({
	crmAccountsTask: one(crmAccountsTasks, {
		fields: [tasksComments.assignedCrmAccountTask],
		references: [crmAccountsTasks.id]
	}),
	task: one(tasks, {
		fields: [tasksComments.task],
		references: [tasks.id]
	}),
	user: one(users, {
		fields: [tasksComments.user],
		references: [users.id]
	}),
}));

export const tasksRelations = relations(tasks, ({one, many}) => ({
	tasksComments: many(tasksComments),
	user: one(users, {
		fields: [tasks.user],
		references: [users.id]
	}),
	section: one(sections, {
		fields: [tasks.section],
		references: [sections.id]
	}),
	documentsToTasks: many(documentsToTasks),
}));

export const sectionsRelations = relations(sections, ({one, many}) => ({
	board: one(boards, {
		fields: [sections.board],
		references: [boards.id]
	}),
	tasks: many(tasks),
}));

export const invoicesRelations = relations(invoices, ({one, many}) => ({
	user: one(users, {
		fields: [invoices.createdBy],
		references: [users.id]
	}),
	invoiceSery: one(invoiceSeries, {
		fields: [invoices.seriesId],
		references: [invoiceSeries.id]
	}),
	crmAccount: one(crmAccounts, {
		fields: [invoices.accountId],
		references: [crmAccounts.id]
	}),
	currency: one(currency, {
		fields: [invoices.currency],
		references: [currency.code]
	}),
	invoice: one(invoices, {
		fields: [invoices.originalInvoiceId],
		references: [invoices.id],
		relationName: "invoices_originalInvoiceId_invoices_id"
	}),
	invoices: many(invoices, {
		relationName: "invoices_originalInvoiceId_invoices_id"
	}),
	invoiceAttachments: many(invoiceAttachments),
	invoiceLineItems: many(invoiceLineItems),
	invoicePayments: many(invoicePayments),
	invoiceActivities: many(invoiceActivity),
}));

export const invoiceSeriesRelations = relations(invoiceSeries, ({many}) => ({
	invoices: many(invoices),
	invoiceSettings: many(invoiceSettings),
}));

export const currencyRelations = relations(currency, ({many}) => ({
	invoices: many(invoices),
	crmOpportunities: many(crmOpportunities),
	crmContracts: many(crmContracts),
	exchangeRates_fromCurrency: many(exchangeRate, {
		relationName: "exchangeRate_fromCurrency_currency_code"
	}),
	exchangeRates_toCurrency: many(exchangeRate, {
		relationName: "exchangeRate_toCurrency_currency_code"
	}),
	crmAccountProducts: many(crmAccountProducts),
	crmProducts: many(crmProducts),
}));

export const crmTargetContactRelations = relations(crmTargetContact, ({one}) => ({
	crmTarget: one(crmTargets, {
		fields: [crmTargetContact.targetId],
		references: [crmTargets.id]
	}),
	crmContact: one(crmContacts, {
		fields: [crmTargetContact.contactId],
		references: [crmContacts.id]
	}),
}));

export const crmTargetsRelations = relations(crmTargets, ({one, many}) => ({
	crmTargetContacts: many(crmTargetContact),
	crmTargetEnrichments: many(crmTargetEnrichment),
	user: one(users, {
		fields: [crmTargets.createdBy],
		references: [users.id]
	}),
	crmAccount: one(crmAccounts, {
		fields: [crmTargets.convertedAccountId],
		references: [crmAccounts.id]
	}),
	crmContact: one(crmContacts, {
		fields: [crmTargets.convertedContactId],
		references: [crmContacts.id]
	}),
	crmCampaignSends: many(crmCampaignSends),
	targetsToTargetLists: many(targetsToTargetLists),
}));

export const crmEmbeddingsAccountsRelations = relations(crmEmbeddingsAccounts, ({one}) => ({
	crmAccount: one(crmAccounts, {
		fields: [crmEmbeddingsAccounts.accountId],
		references: [crmAccounts.id]
	}),
}));

export const invoiceAttachmentsRelations = relations(invoiceAttachments, ({one}) => ({
	invoice: one(invoices, {
		fields: [invoiceAttachments.invoiceId],
		references: [invoices.id]
	}),
	user: one(users, {
		fields: [invoiceAttachments.uploadedBy],
		references: [users.id]
	}),
}));

export const invoiceLineItemsRelations = relations(invoiceLineItems, ({one}) => ({
	invoice: one(invoices, {
		fields: [invoiceLineItems.invoiceId],
		references: [invoices.id]
	}),
	crmProduct: one(crmProducts, {
		fields: [invoiceLineItems.productId],
		references: [crmProducts.id]
	}),
	invoiceTaxRate: one(invoiceTaxRates, {
		fields: [invoiceLineItems.taxRateId],
		references: [invoiceTaxRates.id]
	}),
}));

export const crmProductsRelations = relations(crmProducts, ({one, many}) => ({
	invoiceLineItems: many(invoiceLineItems),
	crmAccountProducts: many(crmAccountProducts),
	crmProductCategory: one(crmProductCategories, {
		fields: [crmProducts.categoryId],
		references: [crmProductCategories.id]
	}),
	currency: one(currency, {
		fields: [crmProducts.currency],
		references: [currency.code]
	}),
	user: one(users, {
		fields: [crmProducts.createdBy],
		references: [users.id]
	}),
	crmOpportunityLineItems: many(crmOpportunityLineItems),
	crmContractLineItems: many(crmContractLineItems),
}));

export const invoiceTaxRatesRelations = relations(invoiceTaxRates, ({many}) => ({
	invoiceLineItems: many(invoiceLineItems),
	invoiceSettings: many(invoiceSettings),
}));

export const invoicePaymentsRelations = relations(invoicePayments, ({one}) => ({
	invoice: one(invoices, {
		fields: [invoicePayments.invoiceId],
		references: [invoices.id]
	}),
	user: one(users, {
		fields: [invoicePayments.createdBy],
		references: [users.id]
	}),
}));

export const crmEmbeddingsOpportunitiesRelations = relations(crmEmbeddingsOpportunities, ({one}) => ({
	crmOpportunity: one(crmOpportunities, {
		fields: [crmEmbeddingsOpportunities.opportunityId],
		references: [crmOpportunities.id]
	}),
}));

export const crmOpportunitiesRelations = relations(crmOpportunities, ({one, many}) => ({
	crmEmbeddingsOpportunities: many(crmEmbeddingsOpportunities),
	crmOpportunitiesType: one(crmOpportunitiesType, {
		fields: [crmOpportunities.type],
		references: [crmOpportunitiesType.id]
	}),
	crmOpportunitiesSalesStage: one(crmOpportunitiesSalesStages, {
		fields: [crmOpportunities.salesStage],
		references: [crmOpportunitiesSalesStages.id]
	}),
	user_assignedTo: one(users, {
		fields: [crmOpportunities.assignedTo],
		references: [users.id],
		relationName: "crmOpportunities_assignedTo_users_id"
	}),
	user_createdBy: one(users, {
		fields: [crmOpportunities.createdBy],
		references: [users.id],
		relationName: "crmOpportunities_createdBy_users_id"
	}),
	crmAccount: one(crmAccounts, {
		fields: [crmOpportunities.account],
		references: [crmAccounts.id]
	}),
	crmCampaign: one(crmCampaigns, {
		fields: [crmOpportunities.campaign],
		references: [crmCampaigns.id]
	}),
	currency: one(currency, {
		fields: [crmOpportunities.currency],
		references: [currency.code]
	}),
	crmOpportunityLineItems: many(crmOpportunityLineItems),
	documentsToOpportunities: many(documentsToOpportunities),
	contactsToOpportunities: many(contactsToOpportunities),
}));

export const apiKeysRelations = relations(apiKeys, ({one}) => ({
	user: one(users, {
		fields: [apiKeys.userId],
		references: [users.id]
	}),
}));

export const apiTokenRelations = relations(apiToken, ({one}) => ({
	user: one(users, {
		fields: [apiToken.userId],
		references: [users.id]
	}),
}));

export const crmContactEnrichmentRelations = relations(crmContactEnrichment, ({one}) => ({
	crmContact: one(crmContacts, {
		fields: [crmContactEnrichment.contactId],
		references: [crmContacts.id]
	}),
	user: one(users, {
		fields: [crmContactEnrichment.triggeredBy],
		references: [users.id]
	}),
}));

export const crmEmbeddingsContactsRelations = relations(crmEmbeddingsContacts, ({one}) => ({
	crmContact: one(crmContacts, {
		fields: [crmEmbeddingsContacts.contactId],
		references: [crmContacts.id]
	}),
}));

export const crmEmbeddingsLeadsRelations = relations(crmEmbeddingsLeads, ({one}) => ({
	crmLead: one(crmLeads, {
		fields: [crmEmbeddingsLeads.leadId],
		references: [crmLeads.id]
	}),
}));

export const crmLeadsRelations = relations(crmLeads, ({one, many}) => ({
	crmEmbeddingsLeads: many(crmEmbeddingsLeads),
	user: one(users, {
		fields: [crmLeads.assignedTo],
		references: [users.id]
	}),
	crmAccount: one(crmAccounts, {
		fields: [crmLeads.accountsIds],
		references: [crmAccounts.id]
	}),
	crmLeadSource: one(crmLeadSources, {
		fields: [crmLeads.leadSourceId],
		references: [crmLeadSources.id]
	}),
	crmLeadStatus: one(crmLeadStatuses, {
		fields: [crmLeads.leadStatusId],
		references: [crmLeadStatuses.id]
	}),
	crmLeadType: one(crmLeadTypes, {
		fields: [crmLeads.leadTypeId],
		references: [crmLeadTypes.id]
	}),
	documentsToLeads: many(documentsToLeads),
}));

export const invoiceActivityRelations = relations(invoiceActivity, ({one}) => ({
	invoice: one(invoices, {
		fields: [invoiceActivity.invoiceId],
		references: [invoices.id]
	}),
	user: one(users, {
		fields: [invoiceActivity.actorId],
		references: [users.id]
	}),
}));

export const crmTargetEnrichmentRelations = relations(crmTargetEnrichment, ({one}) => ({
	crmTarget: one(crmTargets, {
		fields: [crmTargetEnrichment.targetId],
		references: [crmTargets.id]
	}),
	user: one(users, {
		fields: [crmTargetEnrichment.triggeredBy],
		references: [users.id]
	}),
}));

export const crmTargetListsRelations = relations(crmTargetLists, ({one, many}) => ({
	user: one(users, {
		fields: [crmTargetLists.createdBy],
		references: [users.id]
	}),
	targetsToTargetLists: many(targetsToTargetLists),
	campaignToTargetLists: many(campaignToTargetLists),
}));

export const crmCampaignStepsRelations = relations(crmCampaignSteps, ({one, many}) => ({
	crmCampaign: one(crmCampaigns, {
		fields: [crmCampaignSteps.campaignId],
		references: [crmCampaigns.id]
	}),
	crmCampaignTemplate: one(crmCampaignTemplates, {
		fields: [crmCampaignSteps.templateId],
		references: [crmCampaignTemplates.id]
	}),
	crmCampaignSends: many(crmCampaignSends),
}));

export const crmCampaignsRelations = relations(crmCampaigns, ({one, many}) => ({
	crmCampaignSteps: many(crmCampaignSteps),
	crmCampaignSends: many(crmCampaignSends),
	crmCampaignTemplate: one(crmCampaignTemplates, {
		fields: [crmCampaigns.templateId],
		references: [crmCampaignTemplates.id]
	}),
	user: one(users, {
		fields: [crmCampaigns.createdBy],
		references: [users.id]
	}),
	crmOpportunities: many(crmOpportunities),
	campaignToTargetLists: many(campaignToTargetLists),
}));

export const crmCampaignTemplatesRelations = relations(crmCampaignTemplates, ({one, many}) => ({
	crmCampaignSteps: many(crmCampaignSteps),
	user: one(users, {
		fields: [crmCampaignTemplates.createdBy],
		references: [users.id]
	}),
	crmCampaigns: many(crmCampaigns),
}));

export const crmCampaignSendsRelations = relations(crmCampaignSends, ({one}) => ({
	crmCampaign: one(crmCampaigns, {
		fields: [crmCampaignSends.campaignId],
		references: [crmCampaigns.id]
	}),
	crmCampaignStep: one(crmCampaignSteps, {
		fields: [crmCampaignSends.stepId],
		references: [crmCampaignSteps.id]
	}),
	crmTarget: one(crmTargets, {
		fields: [crmCampaignSends.targetId],
		references: [crmTargets.id]
	}),
}));

export const emailAccountRelations = relations(emailAccount, ({one, many}) => ({
	user: one(users, {
		fields: [emailAccount.userId],
		references: [users.id]
	}),
	emails: many(email),
}));

export const emailRelations = relations(email, ({one, many}) => ({
	emailAccount: one(emailAccount, {
		fields: [email.emailAccountId],
		references: [emailAccount.id]
	}),
	user: one(users, {
		fields: [email.userId],
		references: [users.id]
	}),
	emailEmbeddings: many(emailEmbedding),
	emailsToContacts: many(emailsToContacts),
	emailsToAccounts: many(emailsToAccounts),
}));

export const emailEmbeddingRelations = relations(emailEmbedding, ({one}) => ({
	email: one(email, {
		fields: [emailEmbedding.emailId],
		references: [email.id]
	}),
}));

export const crmLeadSourcesRelations = relations(crmLeadSources, ({many}) => ({
	crmLeads: many(crmLeads),
}));

export const crmLeadStatusesRelations = relations(crmLeadStatuses, ({many}) => ({
	crmLeads: many(crmLeads),
}));

export const crmLeadTypesRelations = relations(crmLeadTypes, ({many}) => ({
	crmLeads: many(crmLeads),
}));

export const invoiceSettingsRelations = relations(invoiceSettings, ({one}) => ({
	invoiceSery: one(invoiceSeries, {
		fields: [invoiceSettings.defaultSeriesId],
		references: [invoiceSeries.id]
	}),
	invoiceTaxRate: one(invoiceTaxRates, {
		fields: [invoiceSettings.defaultTaxRateId],
		references: [invoiceTaxRates.id]
	}),
}));

export const crmActivityLinksRelations = relations(crmActivityLinks, ({one}) => ({
	crmActivity: one(crmActivities, {
		fields: [crmActivityLinks.activityId],
		references: [crmActivities.id]
	}),
}));

export const crmActivitiesRelations = relations(crmActivities, ({one, many}) => ({
	crmActivityLinks: many(crmActivityLinks),
	user_createdBy: one(users, {
		fields: [crmActivities.createdBy],
		references: [users.id],
		relationName: "crmActivities_createdBy_users_id"
	}),
	user_updatedBy: one(users, {
		fields: [crmActivities.updatedBy],
		references: [users.id],
		relationName: "crmActivities_updatedBy_users_id"
	}),
}));

export const crmAuditLogRelations = relations(crmAuditLog, ({one}) => ({
	user: one(users, {
		fields: [crmAuditLog.userId],
		references: [users.id]
	}),
}));

export const crmReportConfigRelations = relations(crmReportConfig, ({one, many}) => ({
	user: one(users, {
		fields: [crmReportConfig.createdBy],
		references: [users.id]
	}),
	crmReportSchedules: many(crmReportSchedule),
}));

export const crmReportScheduleRelations = relations(crmReportSchedule, ({one}) => ({
	crmReportConfig: one(crmReportConfig, {
		fields: [crmReportSchedule.reportConfigId],
		references: [crmReportConfig.id]
	}),
	user: one(users, {
		fields: [crmReportSchedule.createdBy],
		references: [users.id]
	}),
}));

export const sessionRelations = relations(session, ({one}) => ({
	user: one(users, {
		fields: [session.userId],
		references: [users.id]
	}),
}));

export const documentsRelations = relations(documents, ({one, many}) => ({
	user_createdByUser: one(users, {
		fields: [documents.createdByUser],
		references: [users.id],
		relationName: "documents_createdByUser_users_id"
	}),
	user_assignedUser: one(users, {
		fields: [documents.assignedUser],
		references: [users.id],
		relationName: "documents_assignedUser_users_id"
	}),
	documentsType: one(documentsTypes, {
		fields: [documents.documentType],
		references: [documentsTypes.id]
	}),
	document: one(documents, {
		fields: [documents.parentDocumentId],
		references: [documents.id],
		relationName: "documents_parentDocumentId_documents_id"
	}),
	documents: many(documents, {
		relationName: "documents_parentDocumentId_documents_id"
	}),
	crmEmbeddingsDocuments: many(crmEmbeddingsDocuments),
	crmDocumentChunks: many(crmDocumentChunks),
	documentsToOpportunities: many(documentsToOpportunities),
	documentsToContacts: many(documentsToContacts),
	documentsToTasks: many(documentsToTasks),
	documentsToCrmAccountsTasks: many(documentsToCrmAccountsTasks),
	documentsToLeads: many(documentsToLeads),
	documentsToAccounts: many(documentsToAccounts),
}));

export const documentsTypesRelations = relations(documentsTypes, ({many}) => ({
	documents: many(documents),
}));

export const accountRelations = relations(account, ({one}) => ({
	user: one(users, {
		fields: [account.userId],
		references: [users.id]
	}),
}));

export const crmEmbeddingsDocumentsRelations = relations(crmEmbeddingsDocuments, ({one}) => ({
	document: one(documents, {
		fields: [crmEmbeddingsDocuments.documentId],
		references: [documents.id]
	}),
}));

export const crmDocumentChunksRelations = relations(crmDocumentChunks, ({one}) => ({
	document: one(documents, {
		fields: [crmDocumentChunks.documentId],
		references: [documents.id]
	}),
}));

export const crmOpportunitiesTypeRelations = relations(crmOpportunitiesType, ({many}) => ({
	crmOpportunities: many(crmOpportunities),
}));

export const crmOpportunitiesSalesStagesRelations = relations(crmOpportunitiesSalesStages, ({many}) => ({
	crmOpportunities: many(crmOpportunities),
}));

export const crmContractsRelations = relations(crmContracts, ({one, many}) => ({
	crmAccount: one(crmAccounts, {
		fields: [crmContracts.account],
		references: [crmAccounts.id]
	}),
	user: one(users, {
		fields: [crmContracts.assignedTo],
		references: [users.id]
	}),
	currency: one(currency, {
		fields: [crmContracts.currency],
		references: [currency.code]
	}),
	crmContractLineItems: many(crmContractLineItems),
}));

export const exchangeRateRelations = relations(exchangeRate, ({one}) => ({
	currency_fromCurrency: one(currency, {
		fields: [exchangeRate.fromCurrency],
		references: [currency.code],
		relationName: "exchangeRate_fromCurrency_currency_code"
	}),
	currency_toCurrency: one(currency, {
		fields: [exchangeRate.toCurrency],
		references: [currency.code],
		relationName: "exchangeRate_toCurrency_currency_code"
	}),
}));

export const crmAccountProductsRelations = relations(crmAccountProducts, ({one}) => ({
	crmAccount: one(crmAccounts, {
		fields: [crmAccountProducts.accountId],
		references: [crmAccounts.id]
	}),
	crmProduct: one(crmProducts, {
		fields: [crmAccountProducts.productId],
		references: [crmProducts.id]
	}),
	currency: one(currency, {
		fields: [crmAccountProducts.currency],
		references: [currency.code]
	}),
}));

export const crmProductCategoriesRelations = relations(crmProductCategories, ({many}) => ({
	crmProducts: many(crmProducts),
}));

export const crmOpportunityLineItemsRelations = relations(crmOpportunityLineItems, ({one}) => ({
	crmOpportunity: one(crmOpportunities, {
		fields: [crmOpportunityLineItems.opportunityId],
		references: [crmOpportunities.id]
	}),
	crmProduct: one(crmProducts, {
		fields: [crmOpportunityLineItems.productId],
		references: [crmProducts.id]
	}),
}));

export const crmContractLineItemsRelations = relations(crmContractLineItems, ({one}) => ({
	crmContract: one(crmContracts, {
		fields: [crmContractLineItems.contractId],
		references: [crmContracts.id]
	}),
	crmProduct: one(crmProducts, {
		fields: [crmContractLineItems.productId],
		references: [crmProducts.id]
	}),
}));

export const documentsToOpportunitiesRelations = relations(documentsToOpportunities, ({one}) => ({
	document: one(documents, {
		fields: [documentsToOpportunities.documentId],
		references: [documents.id]
	}),
	crmOpportunity: one(crmOpportunities, {
		fields: [documentsToOpportunities.opportunityId],
		references: [crmOpportunities.id]
	}),
}));

export const documentsToContactsRelations = relations(documentsToContacts, ({one}) => ({
	document: one(documents, {
		fields: [documentsToContacts.documentId],
		references: [documents.id]
	}),
	crmContact: one(crmContacts, {
		fields: [documentsToContacts.contactId],
		references: [crmContacts.id]
	}),
}));

export const documentsToTasksRelations = relations(documentsToTasks, ({one}) => ({
	document: one(documents, {
		fields: [documentsToTasks.documentId],
		references: [documents.id]
	}),
	task: one(tasks, {
		fields: [documentsToTasks.taskId],
		references: [tasks.id]
	}),
}));

export const boardWatchersRelations = relations(boardWatchers, ({one}) => ({
	board: one(boards, {
		fields: [boardWatchers.boardId],
		references: [boards.id]
	}),
	user: one(users, {
		fields: [boardWatchers.userId],
		references: [users.id]
	}),
}));

export const contactsToOpportunitiesRelations = relations(contactsToOpportunities, ({one}) => ({
	crmContact: one(crmContacts, {
		fields: [contactsToOpportunities.contactId],
		references: [crmContacts.id]
	}),
	crmOpportunity: one(crmOpportunities, {
		fields: [contactsToOpportunities.opportunityId],
		references: [crmOpportunities.id]
	}),
}));

export const documentsToCrmAccountsTasksRelations = relations(documentsToCrmAccountsTasks, ({one}) => ({
	document: one(documents, {
		fields: [documentsToCrmAccountsTasks.documentId],
		references: [documents.id]
	}),
	crmAccountsTask: one(crmAccountsTasks, {
		fields: [documentsToCrmAccountsTasks.crmAccountsTaskId],
		references: [crmAccountsTasks.id]
	}),
}));

export const documentsToLeadsRelations = relations(documentsToLeads, ({one}) => ({
	document: one(documents, {
		fields: [documentsToLeads.documentId],
		references: [documents.id]
	}),
	crmLead: one(crmLeads, {
		fields: [documentsToLeads.leadId],
		references: [crmLeads.id]
	}),
}));

export const documentsToAccountsRelations = relations(documentsToAccounts, ({one}) => ({
	document: one(documents, {
		fields: [documentsToAccounts.documentId],
		references: [documents.id]
	}),
	crmAccount: one(crmAccounts, {
		fields: [documentsToAccounts.accountId],
		references: [crmAccounts.id]
	}),
}));

export const accountWatchersRelations = relations(accountWatchers, ({one}) => ({
	crmAccount: one(crmAccounts, {
		fields: [accountWatchers.accountId],
		references: [crmAccounts.id]
	}),
	user: one(users, {
		fields: [accountWatchers.userId],
		references: [users.id]
	}),
}));

export const targetsToTargetListsRelations = relations(targetsToTargetLists, ({one}) => ({
	crmTarget: one(crmTargets, {
		fields: [targetsToTargetLists.targetId],
		references: [crmTargets.id]
	}),
	crmTargetList: one(crmTargetLists, {
		fields: [targetsToTargetLists.targetListId],
		references: [crmTargetLists.id]
	}),
}));

export const campaignToTargetListsRelations = relations(campaignToTargetLists, ({one}) => ({
	crmCampaign: one(crmCampaigns, {
		fields: [campaignToTargetLists.campaignId],
		references: [crmCampaigns.id]
	}),
	crmTargetList: one(crmTargetLists, {
		fields: [campaignToTargetLists.targetListId],
		references: [crmTargetLists.id]
	}),
}));

export const emailsToContactsRelations = relations(emailsToContacts, ({one}) => ({
	email: one(email, {
		fields: [emailsToContacts.emailId],
		references: [email.id]
	}),
	crmContact: one(crmContacts, {
		fields: [emailsToContacts.contactId],
		references: [crmContacts.id]
	}),
}));

export const emailsToAccountsRelations = relations(emailsToAccounts, ({one}) => ({
	email: one(email, {
		fields: [emailsToAccounts.emailId],
		references: [email.id]
	}),
	crmAccount: one(crmAccounts, {
		fields: [emailsToAccounts.accountId],
		references: [crmAccounts.id]
	}),
}));

export const crmProposalsRelations = relations(crmProposals, ({one, many}) => ({
	createdByUser: one(users, {
		fields: [crmProposals.createdBy],
		references: [users.id]
	}),
	account: one(crmAccounts, {
		fields: [crmProposals.accountId],
		references: [crmAccounts.id]
	}),
	contact: one(crmContacts, {
		fields: [crmProposals.contactId],
		references: [crmContacts.id]
	}),
	currency: one(currency, {
		fields: [crmProposals.currency],
		references: [currency.code]
	}),
	sourceTemplate: one(crmProposals, {
		fields: [crmProposals.sourceTemplateId],
		references: [crmProposals.id],
		relationName: "crmProposals_sourceTemplateId_crmProposals_id"
	}),
	derivedProposals: many(crmProposals, {
		relationName: "crmProposals_sourceTemplateId_crmProposals_id"
	}),
	linkedInvoice: one(invoices, {
		fields: [crmProposals.linkedInvoiceId],
		references: [invoices.id]
	}),
	lineItems: many(crmProposalLineItems),
	assets: many(crmProposalAssets),
	activity: many(crmProposalActivity),
}));

export const crmProposalLineItemsRelations = relations(crmProposalLineItems, ({one}) => ({
	proposal: one(crmProposals, {
		fields: [crmProposalLineItems.proposalId],
		references: [crmProposals.id]
	}),
	product: one(crmProducts, {
		fields: [crmProposalLineItems.productId],
		references: [crmProducts.id]
	}),
	taxRate: one(invoiceTaxRates, {
		fields: [crmProposalLineItems.taxRateId],
		references: [invoiceTaxRates.id]
	}),
}));

export const crmProposalAssetsRelations = relations(crmProposalAssets, ({one}) => ({
	proposal: one(crmProposals, {
		fields: [crmProposalAssets.proposalId],
		references: [crmProposals.id]
	}),
}));

export const crmProposalActivityRelations = relations(crmProposalActivity, ({one}) => ({
	proposal: one(crmProposals, {
		fields: [crmProposalActivity.proposalId],
		references: [crmProposals.id]
	}),
	actor: one(users, {
		fields: [crmProposalActivity.actorId],
		references: [users.id]
	}),
}));