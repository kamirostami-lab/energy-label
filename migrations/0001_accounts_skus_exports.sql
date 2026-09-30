-- Session 4 (Build Brief 01 section 6): accounts with magic-link sign-in, SKU records and the
-- exports issued from them. Times are ISO 8601 UTC strings; ids are random UUIDs. Token and
-- session columns hold SHA-256 hashes, never the values sent to the browser.

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  org_name TEXT,
  role TEXT NOT NULL DEFAULT 'producer' CHECK (role IN ('producer', 'printer', 'designer')),
  plan TEXT NOT NULL DEFAULT 'free',
  stripe_customer_id TEXT,
  -- The one free watermarked export per account (decision D3, as applied in session 4).
  free_export_used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX login_tokens_by_email ON login_tokens (email, created_at);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX sessions_by_account ON sessions (account_id);

-- One row per product. Input columns follow the brief's model; the extra inputs the validator
-- uses are kept too, so a SKU replays exactly. options_json holds the panel options as entered.
-- producer names the files and the proof: a designer or printer exports for several producers.
CREATE TABLE skus (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  producer TEXT,
  beverage_type TEXT,
  abv REAL,
  package_ml REAL,
  serving_ml REAL,
  servings REAL,
  kj_per_100ml REAL,
  cal_per_100ml REAL,
  package_word TEXT,
  vintage_or_batch TEXT,
  package_surface_area_cm2 REAL,
  nip_displayed INTEGER,
  standardised_beverage INTEGER,
  options_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX skus_by_account ON skus (account_id, updated_at);

-- What was issued, from which inputs, under which rules version. Replaying inputs_json,
-- options_json and details_json against rules_version reproduces output_hash.
CREATE TABLE exports (
  id TEXT PRIMARY KEY,
  sku_id TEXT NOT NULL REFERENCES skus (id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  rules_version TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  options_json TEXT NOT NULL,
  details_json TEXT NOT NULL,
  issued_on TEXT NOT NULL,
  watermarked INTEGER NOT NULL,
  svg_key TEXT NOT NULL,
  pdf_key TEXT NOT NULL,
  pdf14_key TEXT NOT NULL,
  proof_key TEXT NOT NULL,
  output_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX exports_by_sku ON exports (sku_id, created_at);
CREATE INDEX exports_by_account ON exports (account_id, created_at);

CREATE TABLE rules_versions (
  version TEXT PRIMARY KEY,
  published_at TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  notes TEXT
);
