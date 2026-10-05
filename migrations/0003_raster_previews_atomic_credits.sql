-- Repository audit fixes, 5 October 2026.
--
-- Free preview exports are pixels only from now on: the panel as a PNG and a proof sheet whose
-- panels are images, so the PREVIEW mark cannot be deleted from vector artwork. An export's SVG,
-- PDF and PDF 1.4 keys become optional and a PNG key is added. SQLite cannot relax NOT NULL in
-- place, so the table is rebuilt with its rows and indexes; no other table references exports.
CREATE TABLE exports_new (
  id TEXT PRIMARY KEY,
  sku_id TEXT NOT NULL REFERENCES skus (id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  rules_version TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  options_json TEXT NOT NULL,
  details_json TEXT NOT NULL,
  issued_on TEXT NOT NULL,
  watermarked INTEGER NOT NULL,
  -- Print-ready exports always have these; previews issued before this migration have them too.
  svg_key TEXT,
  pdf_key TEXT,
  pdf14_key TEXT,
  -- Previews issued from this migration on: the panel image with the mark burned in.
  png_key TEXT,
  proof_key TEXT NOT NULL,
  output_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  entitlement TEXT NOT NULL DEFAULT 'free'
    CHECK (entitlement IN ('free', 'credit', 'subscription')),
  CHECK (watermarked = 1 OR (svg_key IS NOT NULL AND pdf_key IS NOT NULL AND pdf14_key IS NOT NULL))
);
INSERT INTO exports_new (
  id, sku_id, account_id, rules_version, inputs_json, options_json, details_json, issued_on,
  watermarked, svg_key, pdf_key, pdf14_key, proof_key, output_hash, created_at, entitlement
)
SELECT
  id, sku_id, account_id, rules_version, inputs_json, options_json, details_json, issued_on,
  watermarked, svg_key, pdf_key, pdf14_key, proof_key, output_hash, created_at, entitlement
FROM exports;
DROP TABLE exports;
ALTER TABLE exports_new RENAME TO exports;
CREATE INDEX exports_by_sku ON exports (sku_id, created_at);
CREATE INDEX exports_by_account ON exports (account_id, created_at);

-- A bought export's credit is granted in the same batch that records the purchase, and only
-- once: credited_at marks it. Purchases recorded before this migration were credited then.
ALTER TABLE purchases ADD COLUMN credited_at TEXT;
UPDATE purchases SET credited_at = created_at WHERE product = 'export';
