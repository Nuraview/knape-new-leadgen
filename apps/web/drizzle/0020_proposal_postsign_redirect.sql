-- Post-sign redirect: after a client signs a proposal, send them to leave a
-- recommendation (or any URL). Additive, nullable. Default to Varshith's
-- LinkedIn recommendations page.
ALTER TABLE "Proposal_Settings" ADD COLUMN IF NOT EXISTS "postSignRedirectUrl" text;

UPDATE "Proposal_Settings"
   SET "postSignRedirectUrl" = 'https://www.linkedin.com/in/iamvarshith/details/recommendations/'
 WHERE "postSignRedirectUrl" IS NULL;
