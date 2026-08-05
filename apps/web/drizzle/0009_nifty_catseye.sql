DROP INDEX "crm_Leads_upwork_job_id_unique";--> statement-breakpoint
CREATE INDEX "crm_Leads_upwork_job_id_unique" ON "crm_Leads" USING btree ("upwork_job_id") WHERE upwork_job_id IS NOT NULL;