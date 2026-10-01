// What an account may export, and how Stripe's events change it. Events are applied by fetching
// the object they name from Stripe, so a late or repeated event acts on the current state, in the
// pinned API version's shape, and never on a stale copy.
import type { D1Database } from '@cloudflare/workers-types';
import {
  accountById,
  accountByStripeCustomer,
  addExportCredit,
  recordPurchase,
  updateSubscription,
  type AccountRow,
} from '../store.ts';
import { EXPORTING_STATUSES, planFor, productById, productByLookupKey } from './products.ts';
import type { Stripe, StripeCheckoutSession, StripeEvent, StripeSubscription } from './stripe.ts';

/**
 * How long past its period end a subscription still counts without news from Stripe. Renewals
 * arrive as events within minutes; this only covers a delayed delivery.
 */
const PERIOD_GRACE_MS = 2 * 86_400_000;

export interface BillingContext {
  db: D1Database;
  stripe: Stripe;
  now: Date;
  log: (event: Record<string, string | number | boolean>) => void;
}

/** True while the account's subscription allows print-ready exports. */
export function subscriptionExporting(account: AccountRow, now: Date): boolean {
  if (account.plan === 'free' || !account.subscription_status) return false;
  if (!EXPORTING_STATUSES.includes(account.subscription_status)) return false;
  const end = account.subscription_period_end ? Date.parse(account.subscription_period_end) : NaN;
  return Number.isNaN(end) || now.getTime() < end + PERIOD_GRACE_MS;
}

/** What would pay for a print-ready export now: the plan, a bought export, or nothing. */
export function printReadyBy(account: AccountRow, now: Date): 'subscription' | 'credit' | null {
  if (subscriptionExporting(account, now)) return 'subscription';
  return account.export_credits > 0 ? 'credit' : null;
}

/** True when the account looks subscribed but its period has run out: worth asking Stripe. */
export function subscriptionLapsed(account: AccountRow, now: Date): boolean {
  return (
    account.plan !== 'free' &&
    account.subscription_id !== null &&
    !subscriptionExporting(account, now)
  );
}

/** Applies one webhook event. Returns what happened, for the log and the tests. */
export async function applyStripeEvent(event: StripeEvent, ctx: BillingContext): Promise<string> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return applyCheckout(await ctx.stripe.retrieveCheckoutSession(event.data.object.id), ctx);
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
    case 'customer.subscription.paused':
    case 'customer.subscription.resumed':
      return syncSubscription(await ctx.stripe.retrieveSubscription(event.data.object.id), ctx);
    default:
      return 'ignored';
  }
}

async function applyCheckout(session: StripeCheckoutSession, ctx: BillingContext) {
  // Bank debits complete later, with checkout.session.async_payment_succeeded.
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    return 'awaiting_payment';
  }
  const account = session.client_reference_id
    ? await accountById(ctx.db, session.client_reference_id)
    : null;
  if (!account || (account.stripe_customer_id && account.stripe_customer_id !== session.customer)) {
    ctx.log({ event: 'stripe_unmatched', object: 'checkout.session' });
    return 'unmatched';
  }
  const product = productById(session.metadata?.product ?? '');
  if (!product) {
    ctx.log({ event: 'stripe_unknown_product', object: 'checkout.session' });
    return 'unknown_product';
  }
  const recorded = await recordPurchase(ctx.db, {
    checkout_session_id: session.id,
    account_id: account.id,
    product: product.id,
    amount_total: session.amount_total,
    currency: session.currency,
    created_at: ctx.now.toISOString(),
  });
  if (!recorded) return 'duplicate';
  ctx.log({ event: 'purchase', product: product.id });
  if (product.mode === 'payment') {
    await addExportCredit(ctx.db, account.id);
    return 'export_credit';
  }
  if (session.subscription) {
    return syncSubscription(await ctx.stripe.retrieveSubscription(session.subscription), ctx);
  }
  return 'subscribed';
}

/** Brings the account's plan into line with a subscription as Stripe has it now. */
export async function syncSubscription(
  subscription: StripeSubscription,
  ctx: Pick<BillingContext, 'db' | 'log'>,
): Promise<string> {
  const account =
    (await accountByStripeCustomer(ctx.db, subscription.customer)) ??
    (subscription.metadata?.account_id
      ? await accountById(ctx.db, subscription.metadata.account_id)
      : null);
  if (!account) {
    ctx.log({ event: 'stripe_unmatched', object: 'subscription' });
    return 'unmatched';
  }
  const item = subscription.items.data[0];
  const product = productByLookupKey(item?.price.lookup_key);
  const exporting = EXPORTING_STATUSES.includes(subscription.status);
  // News about an older subscription never undoes the current one.
  if (account.subscription_id && account.subscription_id !== subscription.id && !exporting) {
    return 'stale';
  }
  if (exporting && !product) ctx.log({ event: 'stripe_unknown_price', object: 'subscription' });
  await updateSubscription(ctx.db, account.id, {
    plan: exporting ? planFor(product) : 'free',
    subscription_id: subscription.id,
    subscription_status: subscription.status,
    subscription_period_end: item ? new Date(item.current_period_end * 1000).toISOString() : null,
    subscription_cancel_at_period_end: subscription.cancel_at_period_end ? 1 : 0,
  });
  return exporting ? `plan_${planFor(product)}` : 'plan_free';
}
