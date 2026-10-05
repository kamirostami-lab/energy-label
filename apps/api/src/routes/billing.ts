// Plans and payments (Build Brief 01 sections 3, 6 and 8; decision D2).
//   GET  /api/billing            what is on sale at Stripe's prices, and the account's standing
//   POST /api/billing/checkout   a Stripe Checkout Session for an export or a plan → { url }
//   POST /api/billing/portal     a Stripe Customer Portal session: plan, card, invoices → { url }
//   POST /api/stripe/webhook     Stripe's events: payments and subscription changes
// With STRIPE_TRANSPORT=fake on localhost, /api/dev/stripe/* serves the stand-in's checkout and
// portal pages. Logs carry event names and product ids only.
import type { Hono } from 'hono';
import { z } from 'zod';
import {
  applyStripeEvent,
  subscriptionExporting,
  syncSubscription,
} from '../billing/entitlements.ts';
import { localFakeStripe, type FakeStripe } from '../billing/fake.ts';
import {
  EXPORTING_STATUSES,
  ON_SALE,
  PRODUCTS,
  productById,
  type Product,
} from '../billing/products.ts';
import {
  stripeApi,
  verifyStripeSignature,
  type Stripe,
  type StripeEvent,
  type StripePrice,
} from '../billing/stripe.ts';
import {
  accountJson,
  currentAccount,
  type AppContext,
  type AppEnv,
  type Deps,
} from '../context.ts';
import { isLocalhost, noStore, problem, readBody } from '../http.ts';
import { recordStripeEvent, setStripeCustomer, skuById, stripeEventSeen } from '../store.ts';

const PRICE_CACHE_MS = 10 * 60_000;
/**
 * How long a plan's Checkout Session takes payment. Stripe's minimum is 30 minutes; one more keeps
 * a skewed clock from being refused. A short life narrows the window for paying for two plans.
 */
const SUBSCRIPTION_CHECKOUT_SECONDS = 31 * 60;
const priceCache = new WeakMap<Stripe, { at: number; prices: Map<string, StripePrice> }>();
const apiClients = new Map<string, Stripe>();

const checkoutSchema = z
  .object({ product: z.string().max(32), skuId: z.string().max(100).optional() })
  .strict();

/** Stripe for this request: the API with a key, the local stand-in, or null (unavailable). */
export function stripeFor(c: AppContext, deps: Deps): Stripe | null {
  const env = c.env ?? {};
  if (deps.stripe) return deps.stripe(env);
  if (env.STRIPE_SECRET_KEY) {
    let client = apiClients.get(env.STRIPE_SECRET_KEY);
    if (!client) apiClients.set(env.STRIPE_SECRET_KEY, (client = stripeApi(env.STRIPE_SECRET_KEY)));
    return client;
  }
  if (env.STRIPE_TRANSPORT === 'fake' && isLocalhost(c.req.url)) return localFakeStripe;
  return null;
}

/** Prices by lookup key, from Stripe, kept for ten minutes. */
async function pricesFor(stripe: Stripe, now: number): Promise<Map<string, StripePrice>> {
  const cached = priceCache.get(stripe);
  if (cached && now - cached.at < PRICE_CACHE_MS) return cached.prices;
  const list = await stripe.prices(PRODUCTS.map((p) => p.lookupKey));
  const prices = new Map<string, StripePrice>();
  for (const price of list) if (price.lookup_key) prices.set(price.lookup_key, price);
  priceCache.set(stripe, { at: now, prices });
  return prices;
}

function productJson(product: Product, price: StripePrice) {
  return {
    id: product.id,
    name: product.name,
    summary: product.summary,
    mode: product.mode,
    /** Minor units (cents), GST included (D2). */
    amount: price.unit_amount,
    currency: price.currency,
    interval: price.recurring?.interval ?? null,
  };
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A minimal page for the stand-in's checkout and portal (local development only). */
function devPage(title: string, body: string) {
  return `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · Energy Panel</title><link rel="icon" href="/favicon.svg"><style>body{font:16px/1.5 system-ui,sans-serif;max-width:36rem;margin:2rem auto;padding:0 1rem}button{font:inherit;padding:.5rem 1rem;margin:0 .5rem .5rem 0}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>This page stands in for Stripe in local development. No payment is taken.</p>${body}</main></body></html>`;
}

const money = (amount: number | null, currency: string | null) =>
  amount === null
    ? ''
    : `${currency === 'aud' ? 'A$' : `${(currency ?? '').toUpperCase()} `}${(amount / 100).toFixed(2)}`;

export function registerBillingRoutes(app: Hono<AppEnv>, deps: Deps) {
  app.get('/billing', async (c) => {
    const account = await currentAccount(c, deps);
    const stripe = stripeFor(c, deps);
    let prices: Map<string, StripePrice> | null = null;
    if (stripe) {
      try {
        prices = await pricesFor(stripe, deps.now().getTime());
      } catch (error) {
        deps.log({ event: 'stripe_prices_failed', name: (error as Error).name });
      }
    }
    const onSale = PRODUCTS.filter((p) => ON_SALE.includes(p.id));
    const available = prices !== null && onSale.every((p) => prices.has(p.lookupKey));
    return c.json(
      {
        available,
        products: available ? onSale.map((p) => productJson(p, prices!.get(p.lookupKey)!)) : [],
        account: account ? accountJson(account, deps.now()) : null,
      },
      200,
      noStore,
    );
  });

  app.post('/billing/checkout', async (c) => {
    const account = await currentAccount(c, deps);
    const db = c.env?.DB;
    if (!account || !db) {
      return problem(c, {
        status: 401,
        error: 'signed_out',
        message: 'Sign in to buy exports or a plan.',
      });
    }
    const read = await readBody(c, checkoutSchema);
    if (!read.ok) return problem(c, read.problem);
    const product = productById(read.body.product);
    if (!product || !ON_SALE.includes(product.id)) {
      return problem(c, { status: 404, error: 'not_on_sale', message: 'That is not on sale.' });
    }
    const stripe = stripeFor(c, deps);
    const price = stripe
      ? (await pricesFor(stripe, deps.now().getTime()).catch(() => null))?.get(product.lookupKey)
      : undefined;
    if (!stripe || !price) {
      return problem(c, {
        status: 503,
        error: 'billing_unavailable',
        message: 'Payments are not available yet.',
      });
    }
    const alreadySubscribed = () =>
      problem(c, {
        status: 409,
        error: 'already_subscribed',
        message: 'Your plan is already active. Change or cancel it under Manage billing.',
      });
    if (product.mode === 'subscription' && subscriptionExporting(account, deps.now())) {
      return alreadySubscribed();
    }
    const skuId = read.body.skuId;
    if (skuId && !(await skuById(db, account.id, skuId))) {
      return problem(c, { status: 404, error: 'not_found', message: 'No such SKU.' });
    }
    try {
      const customer =
        account.stripe_customer_id ??
        (await setStripeCustomer(
          db,
          account.id,
          (await stripe.createCustomer(account.email, account.id)).id,
        ));
      // A plan bought in another tab may not have reached us by webhook yet: ask Stripe first.
      if (product.mode === 'subscription' && account.stripe_customer_id) {
        const live = (await stripe.subscriptions(customer)).find((s) =>
          EXPORTING_STATUSES.includes(s.status),
        );
        if (live) {
          await syncSubscription(live, { db, log: deps.log });
          return alreadySubscribed();
        }
      }
      // Back to the SKU being exported, or to the plans page.
      const origin = new URL(c.req.url).origin;
      const back = skuId ? `${origin}/?sku=${encodeURIComponent(skuId)}&` : `${origin}/billing?`;
      const taxRate = c.env?.STRIPE_TAX_RATE_GST;
      const session = await stripe.createCheckoutSession({
        mode: product.mode,
        price: price.id,
        customer,
        accountId: account.id,
        product: product.id,
        ...(skuId ? { skuId } : {}),
        successUrl: `${back}checkout=complete&product=${product.id}`,
        cancelUrl: `${back}checkout=cancelled&product=${product.id}`,
        ...(taxRate ? { taxRate } : {}),
        ...(product.mode === 'subscription'
          ? {
              expiresAt: Math.floor(deps.now().getTime() / 1000) + SUBSCRIPTION_CHECKOUT_SECONDS,
            }
          : {}),
      });
      deps.log({ event: 'checkout_started', product: product.id });
      return c.json({ url: session.url }, 200, noStore);
    } catch (error) {
      deps.log({ event: 'checkout_failed', name: (error as Error).name });
      return problem(c, {
        status: 502,
        error: 'billing_failed',
        message: 'Checkout could not be started. Try again in a minute.',
      });
    }
  });

  app.post('/billing/portal', async (c) => {
    const account = await currentAccount(c, deps);
    if (!account) {
      return problem(c, {
        status: 401,
        error: 'signed_out',
        message: 'Sign in to manage billing.',
      });
    }
    const stripe = stripeFor(c, deps);
    if (!stripe) {
      return problem(c, {
        status: 503,
        error: 'billing_unavailable',
        message: 'Payments are not available yet.',
      });
    }
    if (!account.stripe_customer_id) {
      return problem(c, {
        status: 409,
        error: 'no_billing_account',
        message: 'There is nothing to manage yet: buy an export or a plan first.',
      });
    }
    try {
      const portal = await stripe.createPortalSession(
        account.stripe_customer_id,
        `${new URL(c.req.url).origin}/billing`,
      );
      return c.json({ url: portal.url }, 200, noStore);
    } catch (error) {
      deps.log({ event: 'portal_failed', name: (error as Error).name });
      return problem(c, {
        status: 502,
        error: 'billing_failed',
        message: 'Billing could not be opened. Try again in a minute.',
      });
    }
  });

  // Stripe signs every event; the raw body is checked before anything is read from it.
  app.post('/stripe/webhook', async (c) => {
    const secret = c.env?.STRIPE_WEBHOOK_SECRET;
    const db = c.env?.DB;
    const stripe = stripeFor(c, deps);
    if (!secret || !db || !stripe) {
      return problem(c, {
        status: 503,
        error: 'billing_unavailable',
        message: 'Payments are not set up.',
      });
    }
    const payload = await c.req.text();
    const now = deps.now();
    const signature = c.req.header('stripe-signature');
    if (
      !(await verifyStripeSignature(payload, signature, secret, Math.floor(now.getTime() / 1000)))
    ) {
      deps.log({ event: 'stripe_bad_signature' });
      return problem(c, { status: 400, error: 'bad_signature', message: 'Invalid signature.' });
    }
    let event: StripeEvent;
    try {
      event = JSON.parse(payload) as StripeEvent;
    } catch {
      return problem(c, { status: 400, error: 'bad_json', message: 'Invalid JSON.' });
    }
    if (typeof event?.id !== 'string' || typeof event.data?.object?.id !== 'string') {
      return problem(c, { status: 400, error: 'bad_event', message: 'Not a Stripe event.' });
    }
    if (await stripeEventSeen(db, event.id)) return c.json({ received: true }, 200, noStore);
    const outcome = await applyStripeEvent(event, { db, stripe, now, log: deps.log });
    await recordStripeEvent(db, event.id, event.type, now.toISOString());
    deps.log({ event: 'stripe_event', type: event.type, outcome });
    return c.json({ received: true }, 200, noStore);
  });

  // The stand-in's pages: local development and the browser tests only.
  function fakeFor(c: AppContext): FakeStripe | null {
    if (c.env?.STRIPE_TRANSPORT !== 'fake' || !isLocalhost(c.req.url)) return null;
    const stripe = stripeFor(c, deps);
    return stripe && 'complete' in stripe ? (stripe as FakeStripe) : null;
  }

  async function applyFakeEvents(c: AppContext, fake: FakeStripe, events: StripeEvent[]) {
    const db = c.env!.DB!;
    for (const event of events) {
      await applyStripeEvent(event, { db, stripe: fake, now: deps.now(), log: deps.log });
      await recordStripeEvent(db, event.id, event.type, deps.now().toISOString());
    }
  }

  const notFound = (c: AppContext) => c.json({ error: 'not_found', message: 'Not found.' }, 404);

  app.get('/dev/stripe/checkout/:id', (c) => {
    const fake = fakeFor(c);
    const session = fake?.sessionFor(c.req.param('id'));
    if (!fake || !session) return notFound(c);
    const name = productById(session.metadata?.product ?? '')?.name ?? 'Purchase';
    const amount = money(session.amount_total, session.currency);
    const body =
      session.status === 'open'
        ? `<p>${escapeHtml(name)}: ${escapeHtml(amount)}${session.mode === 'subscription' ? ' a month' : ''}, GST included.</p><form method="post"><button name="action" value="pay">Pay ${escapeHtml(amount)} (test)</button><button name="action" value="cancel">Cancel</button></form>`
        : '<p>This checkout is closed.</p>';
    return c.html(devPage('Test checkout', body));
  });

  app.post('/dev/stripe/checkout/:id', async (c) => {
    const fake = fakeFor(c);
    if (!fake || !c.env?.DB) return notFound(c);
    const form = await c.req.parseBody();
    const result = fake.complete(c.req.param('id'), form.action === 'pay' ? 'pay' : 'cancel');
    if (!result) return notFound(c);
    await applyFakeEvents(c, fake, result.events);
    return c.redirect(result.redirect, 303);
  });

  /** The return link, only back to this site. */
  const returnTo = (c: AppContext) => {
    const origin = new URL(c.req.url).origin;
    const back = c.req.query('return') ?? '';
    return back.startsWith(`${origin}/`) ? back : `${origin}/billing`;
  };

  app.get('/dev/stripe/portal/:customer', (c) => {
    const fake = fakeFor(c);
    if (!fake) return notFound(c);
    const subscription = fake.subscriptionFor(c.req.param('customer'));
    const plan = subscription
      ? `<p>Subscription: ${escapeHtml(subscription.status)}${subscription.cancel_at_period_end ? ', cancels at the end of the period' : ''}.</p><form method="post"><button name="action" value="cancel_at_period_end">Cancel at period end</button><button name="action" value="resume">Keep the plan</button><button name="action" value="cancel_now">Cancel now</button></form>`
      : '<p>No subscription.</p>';
    return c.html(
      devPage(
        'Test billing portal',
        `${plan}<p><a href="${escapeHtml(returnTo(c))}">Return to Energy Panel</a></p>`,
      ),
    );
  });

  app.post('/dev/stripe/portal/:customer', async (c) => {
    const fake = fakeFor(c);
    if (!fake || !c.env?.DB) return notFound(c);
    const form = await c.req.parseBody();
    const action =
      form.action === 'cancel_now' || form.action === 'resume'
        ? form.action
        : 'cancel_at_period_end';
    await applyFakeEvents(c, fake, fake.portal(c.req.param('customer'), action));
    const page = new URL(c.req.url);
    page.search = `?return=${encodeURIComponent(returnTo(c))}`;
    return c.redirect(page.toString(), 303);
  });
}
