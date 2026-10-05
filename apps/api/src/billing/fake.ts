// A stand-in for Stripe in local development and the browser tests (STRIPE_TRANSPORT=fake, which
// only answers on localhost): prices at the D2 amounts, customers, Checkout Sessions paid on a
// local page, subscriptions, and a portal page that cancels or resumes them. Each step returns
// the events Stripe would send, for the same handler the real webhook uses.
import type {
  CheckoutRequest,
  Stripe,
  StripeCheckoutSession,
  StripeEvent,
  StripePrice,
  StripeSubscription,
} from './stripe.ts';

const DAY_SECONDS = 86_400;

interface FakeSession extends StripeCheckoutSession {
  price: string;
  success_url: string;
  cancel_url: string;
  expires_at: number | null;
}

export interface FakeStripe extends Stripe {
  /** Pays (or abandons) a Checkout Session; returns where to send the browser and the events. */
  complete(
    sessionId: string,
    outcome: 'pay' | 'cancel',
  ): { redirect: string; events: StripeEvent[] } | null;
  /** The customer's subscription as the portal page shows it. */
  subscriptionFor(customer: string): StripeSubscription | null;
  /** What the portal page's buttons do. */
  portal(customer: string, action: 'cancel_now' | 'cancel_at_period_end' | 'resume'): StripeEvent[];
  sessionFor(id: string): FakeSession | null;
  priceById(id: string): StripePrice | null;
}

/** A fresh stand-in with its own state; `now` gives the time in seconds. */
export function createFakeStripe(
  now: () => number = () => Math.floor(Date.now() / 1000),
): FakeStripe {
  const prices: StripePrice[] = [
    price('price_fake_export', 'energy_panel_export', 1200, null),
    price('price_fake_producer', 'energy_panel_producer_monthly', 2400, 'month'),
    price('price_fake_printer', 'energy_panel_printer_monthly', 24000, 'month'),
  ];
  const customers = new Map<string, { email: string; accountId: string }>();
  const sessions = new Map<string, FakeSession>();
  const subscriptions = new Map<string, StripeSubscription>();
  // Random, as Stripe's are: a restarted dev server keeps its database, and ids must not repeat.
  const id = (prefix: string) =>
    `${prefix}_fake_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const event = (type: string, object: { id: string; object: string }): StripeEvent => ({
    id: id('evt'),
    type,
    created: now(),
    data: { object },
  });
  const subscriptionFor = (customer: string) => {
    const all = [...subscriptions.values()].filter((s) => s.customer === customer);
    return all.find((s) => s.status !== 'canceled') ?? all.at(-1) ?? null;
  };

  return {
    async prices(lookupKeys) {
      return prices.filter((p) => p.lookup_key !== null && lookupKeys.includes(p.lookup_key));
    },
    async createCustomer(email, accountId) {
      const existing = [...customers].find(([, c]) => c.accountId === accountId);
      if (existing) return { id: existing[0] };
      const customer = id('cus');
      customers.set(customer, { email, accountId });
      return { id: customer };
    },
    async createCheckoutSession(r: CheckoutRequest) {
      const session: FakeSession = {
        id: id('cs'),
        url: null,
        mode: r.mode,
        status: 'open',
        payment_status: 'unpaid',
        client_reference_id: r.accountId,
        customer: r.customer,
        subscription: null,
        metadata: {
          account_id: r.accountId,
          product: r.product,
          ...(r.skuId ? { sku_id: r.skuId } : {}),
        },
        amount_total: prices.find((p) => p.id === r.price)?.unit_amount ?? null,
        currency: 'aud',
        price: r.price,
        success_url: r.successUrl,
        cancel_url: r.cancelUrl,
        expires_at: r.expiresAt ?? null,
      };
      session.url = `${new URL(r.successUrl).origin}/api/dev/stripe/checkout/${session.id}`;
      sessions.set(session.id, session);
      return { id: session.id, url: session.url };
    },
    async retrieveCheckoutSession(sessionId) {
      const session = sessions.get(sessionId);
      if (!session) throw new Error('No such checkout session');
      return structuredClone(session);
    },
    async retrieveSubscription(subscriptionId) {
      const subscription = subscriptions.get(subscriptionId);
      if (!subscription) throw new Error('No such subscription');
      return structuredClone(subscription);
    },
    async subscriptions(customer) {
      return [...subscriptions.values()]
        .filter((s) => s.customer === customer)
        .reverse()
        .map((s) => structuredClone(s));
    },
    async createPortalSession(customer, returnUrl) {
      const origin = new URL(returnUrl).origin;
      return {
        url: `${origin}/api/dev/stripe/portal/${customer}?return=${encodeURIComponent(returnUrl)}`,
      };
    },

    complete(sessionId, outcome) {
      const session = sessions.get(sessionId);
      if (!session || session.status !== 'open') return null;
      if (session.expires_at !== null && now() >= session.expires_at) {
        session.status = 'expired';
        return null;
      }
      if (outcome === 'cancel') {
        return { redirect: session.cancel_url, events: [] };
      }
      session.status = 'complete';
      session.payment_status = 'paid';
      const events: StripeEvent[] = [];
      if (session.mode === 'subscription') {
        const lookup = prices.find((p) => p.id === session.price)?.lookup_key ?? null;
        const subscription: StripeSubscription = {
          id: id('sub'),
          status: 'active',
          customer: session.customer!,
          metadata: session.metadata,
          cancel_at_period_end: false,
          items: {
            data: [
              {
                price: { id: session.price, lookup_key: lookup },
                current_period_end: now() + 30 * DAY_SECONDS,
              },
            ],
          },
        };
        subscriptions.set(subscription.id, subscription);
        session.subscription = subscription.id;
        events.push(
          event('customer.subscription.created', { id: subscription.id, object: 'subscription' }),
        );
      }
      events.push(
        event('checkout.session.completed', { id: session.id, object: 'checkout.session' }),
      );
      return {
        redirect: session.success_url.replace('{CHECKOUT_SESSION_ID}', session.id),
        events,
      };
    },
    subscriptionFor,
    portal(customer, action) {
      const subscription = subscriptionFor(customer);
      if (!subscription) return [];
      if (action === 'cancel_now') {
        subscription.status = 'canceled';
        return [
          event('customer.subscription.deleted', { id: subscription.id, object: 'subscription' }),
        ];
      }
      subscription.cancel_at_period_end = action === 'cancel_at_period_end';
      return [
        event('customer.subscription.updated', { id: subscription.id, object: 'subscription' }),
      ];
    },
    sessionFor: (sessionId) => sessions.get(sessionId) ?? null,
    priceById: (priceId) => prices.find((p) => p.id === priceId) ?? null,
  };
}

function price(
  id: string,
  lookupKey: string,
  amount: number,
  interval: string | null,
): StripePrice {
  return {
    id,
    lookup_key: lookupKey,
    unit_amount: amount,
    currency: 'aud',
    recurring: interval ? { interval, interval_count: 1 } : null,
    tax_behavior: 'inclusive',
    active: true,
  };
}

/** The stand-in local development shares across requests, as the mail outbox is. */
export const localFakeStripe = createFakeStripe();
