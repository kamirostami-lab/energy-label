-- Session 5 (Build Brief 01 sections 3 and 6): Stripe Checkout and Customer Portal, webhooks and
-- the entitlements they grant. Amounts live in Stripe, on prices found by lookup key (D2); these
-- columns and tables hold what an account may export and the record of what it bought.

-- Single print-ready exports bought and not yet used.
ALTER TABLE accounts ADD COLUMN export_credits INTEGER NOT NULL DEFAULT 0;
-- The account's subscription as Stripe last reported it. accounts.plan names the plan it grants
-- (producer or printer) while the status allows exporting, and falls back to free otherwise.
ALTER TABLE accounts ADD COLUMN subscription_id TEXT;
ALTER TABLE accounts ADD COLUMN subscription_status TEXT;
ALTER TABLE accounts ADD COLUMN subscription_period_end TEXT;
ALTER TABLE accounts ADD COLUMN subscription_cancel_at_period_end INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX accounts_by_stripe_customer ON accounts (stripe_customer_id);

-- One row per paid Checkout Session: the purchase record, and the guard that grants a single
-- export once however often Stripe delivers the event.
CREATE TABLE purchases (
  checkout_session_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  product TEXT NOT NULL CHECK (product IN ('export', 'producer', 'printer')),
  -- Minor units (cents), GST included, as Stripe charged it.
  amount_total INTEGER,
  currency TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX purchases_by_account ON purchases (account_id, created_at);

-- Stripe events already applied, so a redelivered event is acknowledged without effect.
CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL
);

-- How each export was paid for: the free watermarked preview, a bought export, or a plan.
ALTER TABLE exports ADD COLUMN entitlement TEXT NOT NULL DEFAULT 'free'
  CHECK (entitlement IN ('free', 'credit', 'subscription'));
