-- Orders, customers and the customer portal.
--
-- Lives in the CRM database (CRM_DATABASE_URL) beside crm_Leads and Invoices,
-- not in the app database: this is business data, and it belongs where the rest
-- of the commercial record already is.
--
-- Applied with `bun run --filter @nuraview/api db:crm-apply`. The CRM schema is
-- introspected rather than migrated (see crm-schema.ts), so it gets plain SQL
-- instead of a Drizzle migration — every statement is IF NOT EXISTS so the file
-- is safe to re-run.

CREATE TABLE IF NOT EXISTS "nv_customers" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The identity the portal logs in with, so it has to be unique. Lower-cased
  -- on write: a customer who ordered as Dan@ and signs up as dan@ is the same
  -- person, and letting those diverge means an order nobody can reach.
  "email"         text NOT NULL UNIQUE,
  "name"          text,
  "organization"  text,
  "phone"         text,
  -- Set once the customer completes portal signup. Null means invited, not yet
  -- claimed.
  "portal_user_id" text,
  -- Where this customer came from: a landing-page form submission, a manual
  -- entry, or a paid invoice.
  "source"        text NOT NULL DEFAULT 'manual',
  -- The cockpit's sample_leads.id when the customer came from a website form.
  "inbound_lead_id" integer,
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "nv_customers_inbound_idx"
  ON "nv_customers" ("inbound_lead_id");

CREATE TABLE IF NOT EXISTS "nv_orders" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Human-facing reference. What Dan reads out on the phone.
  "order_number"   text NOT NULL UNIQUE,
  "customer_id"    uuid NOT NULL REFERENCES "nv_customers"("id") ON DELETE CASCADE,
  -- VK, 2026-08-03: "status, dispatched, waiting for dispatched, payment paid".
  "status"         text NOT NULL DEFAULT 'pending_payment',
  "amount_cents"   integer NOT NULL DEFAULT 0,
  "currency"       text NOT NULL DEFAULT 'USD',
  "notes"          text,
  "tracking_number" text,
  "placed_at"      timestamptz NOT NULL DEFAULT now(),
  "paid_at"        timestamptz,
  "dispatched_at"  timestamptz,
  "delivered_at"   timestamptz,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "nv_orders_customer_idx"
  ON "nv_orders" ("customer_id");
CREATE INDEX IF NOT EXISTS "nv_orders_status_idx"
  ON "nv_orders" ("status");

CREATE TABLE IF NOT EXISTS "nv_order_items" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "order_id"        uuid NOT NULL REFERENCES "nv_orders"("id") ON DELETE CASCADE,
  "product_name"    text NOT NULL,
  "sku"             text,
  "quantity"        integer NOT NULL DEFAULT 1,
  "unit_amount_cents" integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS "nv_order_items_order_idx"
  ON "nv_order_items" ("order_id");

-- Digital content a purchase unlocks: worksheets, webinar and Zoom links,
-- decks, infographics. VK: "whoever purchases the planner, they also get access
-- to multiple things like worksheets, like zoom meeting links and webinars".
--
-- Scoped to an order OR to a customer. Order-scoped is the per-purchase
-- material; customer-scoped is the library everything they own grants.
CREATE TABLE IF NOT EXISTS "nv_customer_assets" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id" uuid REFERENCES "nv_customers"("id") ON DELETE CASCADE,
  "order_id"    uuid REFERENCES "nv_orders"("id") ON DELETE CASCADE,
  "kind"        text NOT NULL DEFAULT 'worksheet',
  "title"       text NOT NULL,
  "url"         text,
  "released_at" timestamptz NOT NULL DEFAULT now(),
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "nv_customer_assets_scope"
    CHECK ("customer_id" IS NOT NULL OR "order_id" IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS "nv_customer_assets_customer_idx"
  ON "nv_customer_assets" ("customer_id");
CREATE INDEX IF NOT EXISTS "nv_customer_assets_order_idx"
  ON "nv_customer_assets" ("order_id");

-- The portal invitation. VK: "a unique link would be generated and sent as an
-- email where a person can log in or sign up with his own email. We don't have
-- to provide him any access."
--
-- A grant is the ONLY way to get an account on this instance — public
-- registration stays off — so it is deliberately single-purpose, expiring, and
-- records when it was used rather than being deleted, so "did he ever open it?"
-- is answerable.
CREATE TABLE IF NOT EXISTS "nv_portal_grants" (
  "token"       text PRIMARY KEY,
  "customer_id" uuid NOT NULL REFERENCES "nv_customers"("id") ON DELETE CASCADE,
  "email"       text NOT NULL,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "expires_at"  timestamptz NOT NULL,
  "claimed_at"  timestamptz,
  "last_used_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "nv_portal_grants_customer_idx"
  ON "nv_portal_grants" ("customer_id");
