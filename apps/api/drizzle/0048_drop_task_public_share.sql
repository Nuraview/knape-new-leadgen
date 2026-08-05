-- Remove the anonymous card-share tokens.
--
-- A card link was a bearer token: /public-task/<token> was served ahead of the
-- auth middleware, so anyone on the internet holding (or forwarded) the URL
-- could read the card. Cards are internal — client names, descriptions, team
-- comments — and everywhere else access follows project_member.
--
-- Card links are now GET /task/:id/card, authorised per request. Dropping the
-- columns is also the revocation: every token already handed out stops
-- resolving, which is the point.
ALTER TABLE "task" DROP COLUMN IF EXISTS "public_share_id";
--> statement-breakpoint
ALTER TABLE "task" DROP COLUMN IF EXISTS "public_shared_at";
