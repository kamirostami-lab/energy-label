// D1 queries. Every query that reads an account's data takes the account id, so one account can
// never reach another's SKUs or exports.
import type { D1Database } from '@cloudflare/workers-types';

export type Role = 'producer' | 'printer' | 'designer';
export const ROLES: readonly Role[] = ['producer', 'printer', 'designer'];

export interface AccountRow {
  id: string;
  email: string;
  org_name: string | null;
  role: Role;
  /** free, or the plan an exporting subscription grants (producer, printer). */
  plan: string;
  stripe_customer_id: string | null;
  free_export_used_at: string | null;
  created_at: string;
  export_credits: number;
  subscription_id: string | null;
  subscription_status: string | null;
  subscription_period_end: string | null;
  subscription_cancel_at_period_end: number;
}

export interface SkuRow {
  id: string;
  account_id: string;
  name: string;
  producer: string | null;
  beverage_type: string | null;
  abv: number | null;
  package_ml: number | null;
  serving_ml: number | null;
  servings: number | null;
  kj_per_100ml: number | null;
  cal_per_100ml: number | null;
  package_word: string | null;
  vintage_or_batch: string | null;
  package_surface_area_cm2: number | null;
  nip_displayed: number | null;
  standardised_beverage: number | null;
  options_json: string;
  created_at: string;
  updated_at: string;
}

export interface SkuListRow extends SkuRow {
  export_count: number;
  last_export_at: string | null;
  last_rules_version: string | null;
  last_output_hash: string | null;
}

export interface ExportRow {
  id: string;
  sku_id: string;
  account_id: string;
  rules_version: string;
  inputs_json: string;
  options_json: string;
  details_json: string;
  issued_on: string;
  watermarked: number;
  svg_key: string;
  pdf_key: string;
  pdf14_key: string;
  proof_key: string;
  output_hash: string;
  created_at: string;
  /** free (the watermarked preview), credit (a bought export) or subscription. */
  entitlement: 'free' | 'credit' | 'subscription';
}

export interface PurchaseRow {
  checkout_session_id: string;
  account_id: string;
  product: 'export' | 'producer' | 'printer';
  amount_total: number | null;
  currency: string | null;
  created_at: string;
}

export interface SubscriptionState {
  plan: string;
  subscription_id: string;
  subscription_status: string;
  subscription_period_end: string | null;
  subscription_cancel_at_period_end: number;
}

// Accounts

export const accountById = (db: D1Database, id: string) =>
  db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<AccountRow>();

/** The account for an email, created on first sign-in. */
export async function accountForEmail(
  db: D1Database,
  email: string,
  newId: string,
  now: string,
): Promise<AccountRow> {
  await db
    .prepare('INSERT OR IGNORE INTO accounts (id, email, created_at) VALUES (?, ?, ?)')
    .bind(newId, email, now)
    .run();
  const account = await db
    .prepare('SELECT * FROM accounts WHERE email = ?')
    .bind(email)
    .first<AccountRow>();
  if (!account) throw new Error('account not stored');
  return account;
}

export async function updateAccount(
  db: D1Database,
  id: string,
  changes: { orgName?: string | null; role?: Role },
): Promise<void> {
  if (changes.orgName !== undefined) {
    await db
      .prepare('UPDATE accounts SET org_name = ? WHERE id = ?')
      .bind(changes.orgName, id)
      .run();
  }
  if (changes.role !== undefined) {
    await db.prepare('UPDATE accounts SET role = ? WHERE id = ?').bind(changes.role, id).run();
  }
}

/** Takes the account's free export; false when it has already been used (race-safe). */
export async function claimFreeExport(db: D1Database, id: string, now: string): Promise<boolean> {
  const result = await db
    .prepare(
      'UPDATE accounts SET free_export_used_at = ? WHERE id = ? AND free_export_used_at IS NULL',
    )
    .bind(now, id)
    .run();
  return result.meta.changes === 1;
}

export async function releaseFreeExport(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE accounts SET free_export_used_at = NULL WHERE id = ?').bind(id).run();
}

// Billing

export const accountByStripeCustomer = (db: D1Database, customer: string) =>
  db
    .prepare('SELECT * FROM accounts WHERE stripe_customer_id = ?')
    .bind(customer)
    .first<AccountRow>();

/** Stores the account's Stripe customer unless it has one; returns the one it keeps. */
export async function setStripeCustomer(
  db: D1Database,
  id: string,
  customer: string,
): Promise<string> {
  await db
    .prepare(
      'UPDATE accounts SET stripe_customer_id = ? WHERE id = ? AND stripe_customer_id IS NULL',
    )
    .bind(customer, id)
    .run();
  const row = await db
    .prepare('SELECT stripe_customer_id FROM accounts WHERE id = ?')
    .bind(id)
    .first<{ stripe_customer_id: string | null }>();
  return row?.stripe_customer_id ?? customer;
}

/** Records a paid Checkout Session; false when it was recorded before (a redelivered event). */
export async function recordPurchase(db: D1Database, row: PurchaseRow): Promise<boolean> {
  const result = await db
    .prepare(
      'INSERT OR IGNORE INTO purchases (checkout_session_id, account_id, product, amount_total, currency, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(
      row.checkout_session_id,
      row.account_id,
      row.product,
      row.amount_total,
      row.currency,
      row.created_at,
    )
    .run();
  return result.meta.changes === 1;
}

export async function addExportCredit(db: D1Database, id: string): Promise<void> {
  await db
    .prepare('UPDATE accounts SET export_credits = export_credits + 1 WHERE id = ?')
    .bind(id)
    .run();
}

/** Uses one bought export; false when there is none left (race-safe). */
export async function useExportCredit(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare(
      'UPDATE accounts SET export_credits = export_credits - 1 WHERE id = ? AND export_credits > 0',
    )
    .bind(id)
    .run();
  return result.meta.changes === 1;
}

export async function updateSubscription(
  db: D1Database,
  id: string,
  state: SubscriptionState,
): Promise<void> {
  await db
    .prepare(
      'UPDATE accounts SET plan = ?, subscription_id = ?, subscription_status = ?, subscription_period_end = ?, subscription_cancel_at_period_end = ? WHERE id = ?',
    )
    .bind(
      state.plan,
      state.subscription_id,
      state.subscription_status,
      state.subscription_period_end,
      state.subscription_cancel_at_period_end,
      id,
    )
    .run();
}

export async function stripeEventSeen(db: D1Database, id: string): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM stripe_events WHERE id = ?').bind(id).first();
  return row !== null;
}

export async function recordStripeEvent(
  db: D1Database,
  id: string,
  type: string,
  now: string,
): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO stripe_events (id, type, received_at) VALUES (?, ?, ?)')
    .bind(id, type, now)
    .run();
}

// Sign-in links and sessions (hashes only)

export async function storeLoginToken(
  db: D1Database,
  tokenHash: string,
  email: string,
  expiresAt: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO login_tokens (token_hash, email, expires_at, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(tokenHash, email, expiresAt, now)
    .run();
}

export async function recentLoginTokens(
  db: D1Database,
  email: string,
  since: string,
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM login_tokens WHERE email = ? AND created_at > ?')
    .bind(email, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Marks a sign-in link used and returns its email, or null if unknown, used or expired. */
export async function useLoginToken(
  db: D1Database,
  tokenHash: string,
  now: string,
): Promise<string | null> {
  const result = await db
    .prepare(
      'UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
    )
    .bind(now, tokenHash, now)
    .run();
  if (result.meta.changes !== 1) return null;
  const row = await db
    .prepare('SELECT email FROM login_tokens WHERE token_hash = ?')
    .bind(tokenHash)
    .first<{ email: string }>();
  return row?.email ?? null;
}

export async function storeSession(
  db: D1Database,
  idHash: string,
  accountId: string,
  expiresAt: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO sessions (id_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    )
    .bind(idHash, accountId, expiresAt, now)
    .run();
}

export const sessionAccount = (db: D1Database, idHash: string, now: string) =>
  db
    .prepare(
      'SELECT accounts.* FROM sessions JOIN accounts ON accounts.id = sessions.account_id WHERE sessions.id_hash = ? AND sessions.expires_at > ?',
    )
    .bind(idHash, now)
    .first<AccountRow>();

export async function deleteSession(db: D1Database, idHash: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id_hash = ?').bind(idHash).run();
}

// SKUs

const LAST_EXPORT = `
  (SELECT COUNT(*) FROM exports e WHERE e.sku_id = skus.id) AS export_count,
  (SELECT e.created_at FROM exports e WHERE e.sku_id = skus.id ORDER BY e.created_at DESC LIMIT 1) AS last_export_at,
  (SELECT e.rules_version FROM exports e WHERE e.sku_id = skus.id ORDER BY e.created_at DESC LIMIT 1) AS last_rules_version,
  (SELECT e.output_hash FROM exports e WHERE e.sku_id = skus.id ORDER BY e.created_at DESC LIMIT 1) AS last_output_hash`;

export async function skusForAccount(db: D1Database, accountId: string): Promise<SkuListRow[]> {
  const { results } = await db
    .prepare(
      `SELECT skus.*, ${LAST_EXPORT} FROM skus WHERE account_id = ? ORDER BY updated_at DESC, name`,
    )
    .bind(accountId)
    .all<SkuListRow>();
  return results;
}

export const skuById = (db: D1Database, accountId: string, id: string) =>
  db
    .prepare('SELECT * FROM skus WHERE id = ? AND account_id = ?')
    .bind(id, accountId)
    .first<SkuRow>();

const SKU_COLUMNS = [
  'name',
  'producer',
  'beverage_type',
  'abv',
  'package_ml',
  'serving_ml',
  'servings',
  'kj_per_100ml',
  'cal_per_100ml',
  'package_word',
  'vintage_or_batch',
  'package_surface_area_cm2',
  'nip_displayed',
  'standardised_beverage',
  'options_json',
] as const;

export type SkuValues = Pick<SkuRow, (typeof SKU_COLUMNS)[number]>;

export async function insertSku(
  db: D1Database,
  id: string,
  accountId: string,
  values: SkuValues,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO skus (id, account_id, ${SKU_COLUMNS.join(', ')}, created_at, updated_at) VALUES (?, ?, ${SKU_COLUMNS.map(() => '?').join(', ')}, ?, ?)`,
    )
    .bind(id, accountId, ...SKU_COLUMNS.map((c) => values[c]), now, now)
    .run();
}

export async function updateSku(
  db: D1Database,
  id: string,
  accountId: string,
  values: SkuValues,
  now: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE skus SET ${SKU_COLUMNS.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND account_id = ?`,
    )
    .bind(...SKU_COLUMNS.map((c) => values[c]), now, id, accountId)
    .run();
  return result.meta.changes === 1;
}

// Exports

export async function exportsForSku(
  db: D1Database,
  accountId: string,
  skuId: string,
): Promise<ExportRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM exports WHERE sku_id = ? AND account_id = ? ORDER BY created_at DESC')
    .bind(skuId, accountId)
    .all<ExportRow>();
  return results;
}

export async function exportsForAccount(db: D1Database, accountId: string): Promise<ExportRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM exports WHERE account_id = ? ORDER BY created_at DESC')
    .bind(accountId)
    .all<ExportRow>();
  return results;
}

export const exportById = (db: D1Database, accountId: string, id: string) =>
  db
    .prepare('SELECT * FROM exports WHERE id = ? AND account_id = ?')
    .bind(id, accountId)
    .first<ExportRow>();

export async function insertExport(db: D1Database, row: ExportRow): Promise<void> {
  const columns = Object.keys(row) as Array<keyof ExportRow>;
  await db
    .prepare(
      `INSERT INTO exports (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    )
    .bind(...columns.map((c) => row[c]))
    .run();
}

export async function recordRulesVersion(
  db: D1Database,
  version: string,
  sha256: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      'INSERT OR IGNORE INTO rules_versions (version, published_at, sha256, notes) VALUES (?, ?, ?, ?)',
    )
    .bind(version, now, sha256, 'First export issued under this version')
    .run();
}
