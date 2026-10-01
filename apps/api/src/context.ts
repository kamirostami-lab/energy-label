// What every route shares: the resolved dependencies, the Hono environment and the signed-in
// account, looked up once per request from the session cookie.
import type { EnergyStatementRules } from '@energy-panel/rules';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { printReadyBy } from './billing/entitlements.ts';
import type { Stripe } from './billing/stripe.ts';
import { sha256Hex } from './crypto.ts';
import type { Env } from './env.ts';
import type { Mailer } from './mail.ts';
import { sessionAccount, type AccountRow } from './store.ts';

export const SESSION_COOKIE = 'ep_session';

export interface Deps {
  rules: EnergyStatementRules;
  now: () => Date;
  log: (event: Record<string, string | number | boolean>) => void;
  newId: () => string;
  /** Overrides the mailer chosen from the environment (tests). */
  mailer?: (env: Env) => Mailer | null;
  /** Overrides Stripe as chosen from the environment (tests). */
  stripe?: (env: Env) => Stripe | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { account: AccountRow | null | undefined };
};

export type AppContext = Context<AppEnv>;

/** The signed-in account, or null. */
export async function currentAccount(c: AppContext, deps: Deps): Promise<AccountRow | null> {
  const cached = c.get('account');
  if (cached !== undefined) return cached;
  const token = getCookie(c, SESSION_COOKIE);
  const db = c.env?.DB;
  const account =
    token && db ? await sessionAccount(db, await sha256Hex(token), deps.now().toISOString()) : null;
  c.set('account', account);
  return account;
}

export function accountJson(account: AccountRow, now: Date) {
  return {
    id: account.id,
    email: account.email,
    orgName: account.org_name,
    role: account.role,
    plan: account.plan,
    freeExportAvailable: account.free_export_used_at === null,
    /** Print-ready exports bought and not yet used. */
    exportCredits: account.export_credits,
    /** What pays for the next print-ready export: the plan, a bought export, or nothing yet. */
    printReady: printReadyBy(account, now),
    subscription: account.subscription_id
      ? {
          status: account.subscription_status,
          currentPeriodEnd: account.subscription_period_end,
          cancelAtPeriodEnd: account.subscription_cancel_at_period_end === 1,
        }
      : null,
    /** Stripe knows this account, so the Customer Portal has something to show. */
    billingAccount: account.stripe_customer_id !== null,
  };
}
