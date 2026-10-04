// Payments through the Stripe stand-in, against a real local D1 database and R2 bucket: Checkout,
// the signed webhook, bought exports and the Producer plan, the portal, and print-ready exports.
// The Stripe client and the signature check are tested apart, against a stub fetch and an
// independent HMAC.
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StripeApiError, formEncode, type StripeEvent } from '../src/billing/stripe.ts';
import {
  STRIPE_API_VERSION,
  createFakeStripe,
  signStripePayload,
  stripeApi,
  verifyStripeSignature,
  type Env,
} from '../src/index.ts';
import { testBindings } from './env.ts';
import { json, origin, setup, skuBody, unique } from './harness.ts';

const SECRET = 'test-signing-secret';
const DAY = 86_400;

let env: Env;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ env, dispose } = await testBindings());
});
afterAll(async () => {
  await dispose();
});

describe('Stripe client', () => {
  type Sent = { url: string; init: RequestInit };
  function stub(response: () => Response = () => Response.json({ id: 'x', url: 'https://u' })) {
    const sent: Sent[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return response();
    }) as unknown as typeof fetch;
    return { stripe: stripeApi('sk_test_x', fetcher), sent };
  }
  const form = (init: RequestInit) => Object.fromEntries(new URLSearchParams(String(init.body)));

  it('form-encodes nested parameters as Stripe expects', () => {
    expect(
      formEncode({
        mode: 'payment',
        line_items: [{ price: 'price_1', quantity: 1, tax_rates: ['txr_1'] }],
        metadata: { note: 'a b', skipped: undefined },
      }),
    ).toBe(
      'mode=payment&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1' +
        '&line_items%5B0%5D%5Btax_rates%5D%5B0%5D=txr_1&metadata%5Bnote%5D=a%20b',
    );
  });

  it('pins the API version and asks Checkout for a tax invoice on a single export', async () => {
    const { stripe, sent } = stub();
    await stripe.createCheckoutSession({
      mode: 'payment',
      price: 'price_e',
      customer: 'cus_1',
      accountId: 'acc_1',
      product: 'export',
      skuId: 'sku_1',
      successUrl: 'https://e.test/?sku=sku_1&checkout=complete',
      cancelUrl: 'https://e.test/?sku=sku_1&checkout=cancelled',
      taxRate: 'txr_gst',
    });
    const { url, init } = sent[0]!;
    expect(STRIPE_API_VERSION).toBe('2026-09-30.endive');
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer sk_test_x',
      'Stripe-Version': STRIPE_API_VERSION,
      'Content-Type': 'application/x-www-form-urlencoded',
    });
    expect(form(init)).toEqual({
      mode: 'payment',
      customer: 'cus_1',
      client_reference_id: 'acc_1',
      'line_items[0][price]': 'price_e',
      'line_items[0][quantity]': '1',
      'line_items[0][tax_rates][0]': 'txr_gst',
      success_url: 'https://e.test/?sku=sku_1&checkout=complete',
      cancel_url: 'https://e.test/?sku=sku_1&checkout=cancelled',
      'metadata[account_id]': 'acc_1',
      'metadata[product]': 'export',
      'metadata[sku_id]': 'sku_1',
      'invoice_creation[enabled]': 'true',
      'payment_intent_data[metadata][account_id]': 'acc_1',
      'payment_intent_data[metadata][product]': 'export',
      'payment_intent_data[metadata][sku_id]': 'sku_1',
    });
  });

  it('puts a plan’s metadata on its subscription', async () => {
    const { stripe, sent } = stub();
    await stripe.createCheckoutSession({
      mode: 'subscription',
      price: 'price_p',
      customer: 'cus_1',
      accountId: 'acc_1',
      product: 'producer',
      successUrl: 'https://e.test/billing?checkout=complete',
      cancelUrl: 'https://e.test/billing?checkout=cancelled',
    });
    const body = form(sent[0]!.init);
    expect(body).toMatchObject({
      mode: 'subscription',
      'subscription_data[metadata][account_id]': 'acc_1',
      'subscription_data[metadata][product]': 'producer',
    });
    expect(Object.keys(body).some((k) => k.startsWith('invoice_creation'))).toBe(false);
    expect(Object.keys(body).some((k) => k.includes('tax_rates'))).toBe(false);
  });

  it('finds prices by lookup key, keeps one customer per account, and hides Stripe’s wording', async () => {
    const prices = stub(() => Response.json({ data: [] }));
    await prices.stripe.prices(['energy_panel_export', 'energy_panel_producer_monthly']);
    expect(prices.sent[0]!.init.method).toBe('GET');
    expect(prices.sent[0]!.url).toBe(
      'https://api.stripe.com/v1/prices?active=true&limit=100' +
        '&lookup_keys%5B0%5D=energy_panel_export&lookup_keys%5B1%5D=energy_panel_producer_monthly',
    );

    const customer = stub();
    await customer.stripe.createCustomer('a@example.com', 'acc_1');
    expect(customer.sent[0]!.init.headers).toMatchObject({ 'Idempotency-Key': 'customer-acc_1' });
    expect(form(customer.sent[0]!.init)).toEqual({
      email: 'a@example.com',
      'metadata[account_id]': 'acc_1',
    });

    const refused = stub(() =>
      Response.json(
        { error: { type: 'invalid_request_error', message: 'No such customer: a@example.com' } },
        { status: 400 },
      ),
    );
    const error = await refused.stripe.retrieveSubscription('sub_1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StripeApiError);
    expect(error).toMatchObject({ status: 400, type: 'invalid_request_error' });
    expect(String((error as Error).message)).not.toContain('@');
  });
});

describe('webhook signatures', () => {
  const payload = JSON.stringify({ id: 'evt_1', type: 'x', data: { object: { id: 'cs_1' } } });
  const reference = (t: number, secret = SECRET, body = payload) =>
    createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const t = 1_790_000_000;

  it('accepts Stripe’s scheme, also during a secret change', async () => {
    expect(await signStripePayload(payload, SECRET, t)).toBe(`t=${t},v1=${reference(t)}`);
    expect(await verifyStripeSignature(payload, `t=${t},v1=${reference(t)}`, SECRET, t)).toBe(true);
    expect(
      await verifyStripeSignature(
        payload,
        `t=${t},v1=${reference(t, 'old-secret')},v1=${reference(t)},v0=ignored`,
        SECRET,
        t + 299,
      ),
    ).toBe(true);
  });

  it('refuses the wrong secret, a changed body, old or future times and broken headers', async () => {
    const header = `t=${t},v1=${reference(t)}`;
    expect(
      await verifyStripeSignature(payload, `t=${t},v1=${reference(t, 'other')}`, SECRET, t),
    ).toBe(false);
    expect(await verifyStripeSignature(`${payload} `, header, SECRET, t)).toBe(false);
    expect(await verifyStripeSignature(payload, header, SECRET, t + 301)).toBe(false);
    expect(await verifyStripeSignature(payload, header, SECRET, t - 301)).toBe(false);
    expect(await verifyStripeSignature(payload, `v1=${reference(t)}`, SECRET, t)).toBe(false);
    expect(await verifyStripeSignature(payload, `t=${t},v1=zz`, SECRET, t)).toBe(false);
    expect(await verifyStripeSignature(payload, undefined, SECRET, t)).toBe(false);
    expect(await verifyStripeSignature(payload, header, '', t)).toBe(false);
  });
});

/** The API with the Stripe stand-in on the harness clock, and Stripe's side of each step. */
function billing() {
  let clock = () => 0;
  const fake = createFakeStripe(() => clock());
  const h = setup(env, { stripe: fake });
  clock = h.seconds;
  const bindings = { ...env, STRIPE_WEBHOOK_SECRET: SECRET } as Env;
  const call = (method: string, path: string, body?: unknown, cookie?: string) =>
    h.call(method, path, body, cookie, bindings);

  /** Delivers an event as Stripe would: signed, to the webhook. */
  async function deliver(event: StripeEvent, secret = SECRET, overrides: Partial<Env> = {}) {
    const payload = JSON.stringify(event);
    return h.app.request(
      `${origin}/api/stripe/webhook`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'stripe-signature': await signStripePayload(payload, secret, h.seconds()),
        },
        body: payload,
      },
      { ...bindings, ...overrides },
    );
  }
  // Unique across tests: they share one database, and a repeated id is a redelivery.
  const event = (type: string, id: string): StripeEvent => ({
    id: `evt_test_${crypto.randomUUID()}`,
    type,
    created: h.seconds(),
    data: { object: { id } },
  });
  /** Pays the Checkout Session behind a checkout URL, delivering Stripe's events. */
  async function pay(url: string) {
    const result = fake.complete(url.split('/').pop()!, 'pay')!;
    for (const e of result.events) expect((await deliver(e)).status).toBe(200);
    return result;
  }
  /** Signs in with an organisation and one SKU of the FSANZ example. */
  async function producerWithSku() {
    const email = unique();
    const cookie = await h.signIn(email);
    await call('PATCH', 'account', { orgName: 'Komms-Haus' }, cookie);
    const { sku } = await json(await call('POST', 'skus', skuBody(), cookie));
    return { email, cookie, sku };
  }
  const me = async (cookie: string) =>
    (await json(await call('GET', 'auth/me', undefined, cookie))).account;
  async function checkout(cookie: string, body: object): Promise<string> {
    const res = await call('POST', 'billing/checkout', body, cookie);
    const answer = await json(res);
    if (!answer.url) throw new Error(`checkout answered ${res.status}: ${JSON.stringify(answer)}`);
    return answer.url;
  }
  return { ...h, fake, call, deliver, event, pay, producerWithSku, me, checkout };
}

describe('billing', () => {
  it('lists what is on sale at Stripe’s prices, and nothing without Stripe', async () => {
    const b = billing();
    const res = await json(await b.call('GET', 'billing'));
    expect(res.available).toBe(true);
    expect(res.account).toBeNull();
    expect(res.products).toEqual([
      expect.objectContaining({
        id: 'export',
        mode: 'payment',
        amount: 1200,
        currency: 'aud',
        interval: null,
      }),
      expect.objectContaining({
        id: 'producer',
        mode: 'subscription',
        amount: 2400,
        interval: 'month',
      }),
    ]);

    const none = await json(await setup(env).call('GET', 'billing'));
    expect(none).toEqual({ available: false, products: [], account: null });
  });

  it('sells one export that pays for one print-ready export, once', async () => {
    const b = billing();
    const { cookie, sku } = await b.producerWithSku();
    const before = await b.call('POST', `skus/${sku.id}/exports`, { edition: 'print' }, cookie);
    expect(before.status).toBe(402);
    expect((await json(before)).error).toBe('payment_required');

    const url = await b.checkout(cookie, { product: 'export', skuId: sku.id });
    expect(url).toMatch(new RegExp(`^${origin}/api/dev/stripe/checkout/cs_fake_\\w+$`));
    const session = b.fake.sessionFor(url.split('/').pop()!)!;
    expect(session).toMatchObject({
      mode: 'payment',
      success_url: `${origin}/?sku=${sku.id}&checkout=complete&product=export`,
      cancel_url: `${origin}/?sku=${sku.id}&checkout=cancelled&product=export`,
      metadata: { product: 'export', sku_id: sku.id },
    });
    expect(await b.me(cookie)).toMatchObject({
      billingAccount: true,
      exportCredits: 0,
      printReady: null,
    });

    const { redirect, events } = await b.pay(url);
    expect(redirect).toBe(`${origin}/?sku=${sku.id}&checkout=complete&product=export`);
    expect(await b.me(cookie)).toMatchObject({ exportCredits: 1, printReady: 'credit' });

    // Stripe delivers at least once: the same event again, or another for the same payment.
    expect((await b.deliver(events.at(-1)!)).status).toBe(200);
    await b.deliver(b.event('checkout.session.async_payment_succeeded', session.id));
    expect((await b.me(cookie)).exportCredits).toBe(1);
    const purchase = await env
      .DB!.prepare(
        'SELECT product, amount_total, currency, credited_at FROM purchases WHERE checkout_session_id = ?',
      )
      .bind(session.id)
      .first();
    expect(purchase).toEqual({
      product: 'export',
      amount_total: 1200,
      currency: 'aud',
      credited_at: '2026-09-30T02:00:00.000Z',
    });

    const res = await b.call(
      'POST',
      `skus/${sku.id}/exports`,
      { edition: 'print', issuedOn: '2026-09-30' },
      cookie,
    );
    expect(res.status).toBe(201);
    const exported = (await json(res)).export;
    expect(exported).toMatchObject({ watermarked: false, entitlement: 'credit' });
    expect(exported.files.map((f: { fileName: string }) => f.fileName)).toEqual([
      '20260930-komms-haus-reserve-tawny-energy-panel-50mm.svg',
      '20260930-komms-haus-reserve-tawny-energy-panel-50mm.pdf',
      '20260930-komms-haus-reserve-tawny-energy-panel-50mm-pdf14.pdf',
      '20260930-komms-haus-reserve-tawny-energy-panel-50mm-proof.pdf',
    ]);
    expect(await b.me(cookie)).toMatchObject({ exportCredits: 0, printReady: null });
    expect(
      (await b.call('POST', `skus/${sku.id}/exports`, { edition: 'print' }, cookie)).status,
    ).toBe(402);
    expect(JSON.stringify(b.events)).not.toContain('@');
  });

  it('keeps a bought export when the export fails', async () => {
    const b = billing();
    const { cookie, sku } = await b.producerWithSku();
    await b.pay(await b.checkout(cookie, { product: 'export' }));
    await b.call('PUT', `skus/${sku.id}`, skuBody({ inputs: { abv: 21.1 } }), cookie);
    const blocked = await b.call('POST', `skus/${sku.id}/exports`, { edition: 'print' }, cookie);
    expect(blocked.status).toBe(422);
    expect((await b.me(cookie)).exportCredits).toBe(1);
  });

  it('records a purchase and its credit together, so Stripe’s retry after a failure grants it', async () => {
    const b = billing();
    const { cookie } = await b.producerWithSku();
    const url = await b.checkout(cookie, { product: 'export' });
    const { events } = b.fake.complete(url.split('/').pop()!, 'pay')!;
    const completed = events.at(-1)!;
    // The database fails as the purchase is written: nothing is kept, and Stripe will retry.
    let failed = false;
    const flaky = new Proxy(env.DB!, {
      get(target, prop) {
        if (prop === 'batch' && !failed) {
          failed = true;
          return async () => {
            throw new Error('D1 unavailable');
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    expect((await b.deliver(completed, SECRET, { DB: flaky })).status).toBe(500);
    expect((await b.me(cookie)).exportCredits).toBe(0);
    expect((await b.deliver(completed)).status).toBe(200);
    expect((await b.me(cookie)).exportCredits).toBe(1);
    expect((await b.deliver(completed)).status).toBe(200);
    expect((await b.me(cookie)).exportCredits).toBe(1);
  });

  it('lets only one of two exports at once use the last bought export', async () => {
    const b = billing();
    const { cookie, sku } = await b.producerWithSku();
    await b.pay(await b.checkout(cookie, { product: 'export' }));
    const account = await b.me(cookie);
    const statuses = await Promise.all(
      [0, 1].map(async () => {
        const res = await b.call('POST', `skus/${sku.id}/exports`, { edition: 'print' }, cookie);
        return res.status;
      }),
    );
    expect(statuses.sort()).toEqual([201, 402]);
    expect((await b.me(cookie)).exportCredits).toBe(0);
    const detail = await json(await b.call('GET', `skus/${sku.id}`, undefined, cookie));
    expect(detail.exports).toHaveLength(1);
    // The refused export's files were removed: storage holds the recorded export's four.
    const stored = await env.EXPORTS!.list({ prefix: `exports/${account.id}/` });
    expect(stored.objects.map((o) => o.key.split('/')[2])).toEqual(
      Array(4).fill(detail.exports[0].id),
    );
  });

  it('asks Stripe for a live plan before a plan’s checkout, and expires plan checkouts', async () => {
    const b = billing();
    const { cookie } = await b.producerWithSku();
    const url = await b.checkout(cookie, { product: 'producer' });
    expect(b.fake.sessionFor(url.split('/').pop()!)!.expires_at).toBe(b.seconds() + 31 * 60);
    // Paid in another tab; its webhook has not arrived yet.
    expect(b.fake.complete(url.split('/').pop()!, 'pay')).not.toBeNull();
    expect((await b.me(cookie)).plan).toBe('free');
    const again = await b.call('POST', 'billing/checkout', { product: 'producer' }, cookie);
    expect(again.status).toBe(409);
    expect((await json(again)).error).toBe('already_subscribed');
    expect(await b.me(cookie)).toMatchObject({ plan: 'producer', printReady: 'subscription' });
    // A single export's checkout keeps Stripe's default lifetime.
    const one = await b.checkout(cookie, { product: 'export' });
    expect(b.fake.sessionFor(one.split('/').pop()!)!.expires_at).toBeNull();
  });

  it('exports without limit on the Producer plan, and follows its changes', async () => {
    const b = billing();
    const { cookie, sku } = await b.producerWithSku();
    const url = await b.checkout(cookie, { product: 'producer' });
    expect(b.fake.sessionFor(url.split('/').pop()!)!.success_url).toBe(
      `${origin}/billing?checkout=complete&product=producer`,
    );
    await b.pay(url);
    expect(await b.me(cookie)).toMatchObject({
      plan: 'producer',
      printReady: 'subscription',
      exportCredits: 0,
      subscription: {
        status: 'active',
        cancelAtPeriodEnd: false,
        currentPeriodEnd: new Date((b.seconds() + 30 * DAY) * 1000).toISOString(),
      },
    });
    for (let i = 0; i < 2; i++) {
      const res = await b.call('POST', `skus/${sku.id}/exports`, { edition: 'print' }, cookie);
      expect(res.status).toBe(201);
      expect((await json(res)).export.entitlement).toBe('subscription');
    }
    const again = await b.call('POST', 'billing/checkout', { product: 'producer' }, cookie);
    expect(again.status).toBe(409);
    const printer = await b.call('POST', 'billing/checkout', { product: 'printer' }, cookie);
    expect((await json(printer)).error).toBe('not_on_sale');

    const portal = await json(await b.call('POST', 'billing/portal', undefined, cookie));
    expect(portal.url).toMatch(
      new RegExp(
        `^${origin}/api/dev/stripe/portal/cus_fake_\\w+\\?return=${encodeURIComponent(`${origin}/billing`)}$`,
      ),
    );
    const customer = portal.url.split('/').pop().split('?')[0];
    for (const e of b.fake.portal(customer, 'cancel_at_period_end')) await b.deliver(e);
    expect(await b.me(cookie)).toMatchObject({
      plan: 'producer',
      subscription: { cancelAtPeriodEnd: true },
    });
    for (const e of b.fake.portal(customer, 'cancel_now')) await b.deliver(e);
    expect(await b.me(cookie)).toMatchObject({
      plan: 'free',
      printReady: null,
      subscription: { status: 'canceled' },
    });
    expect(
      (await b.call('POST', `skus/${sku.id}/exports`, { edition: 'print' }, cookie)).status,
    ).toBe(402);
  });

  it('ignores late news about an earlier subscription', async () => {
    const b = billing();
    const { cookie } = await b.producerWithSku();
    await b.pay(await b.checkout(cookie, { product: 'producer' }));
    const portal = await json(await b.call('POST', 'billing/portal', undefined, cookie));
    const customer = portal.url.split('/').pop().split('?')[0];
    const first = b.fake.subscriptionFor(customer)!.id;
    for (const e of b.fake.portal(customer, 'cancel_now')) await b.deliver(e);
    await b.pay(await b.checkout(cookie, { product: 'producer' }));
    expect((await b.me(cookie)).plan).toBe('producer');

    expect((await b.deliver(b.event('customer.subscription.updated', first))).status).toBe(200);
    expect((await b.me(cookie)).plan).toBe('producer');
    expect(b.events.at(-1)).toMatchObject({ event: 'stripe_event', outcome: 'stale' });
  });

  it('asks Stripe when a plan’s period has run out without news', async () => {
    const b = billing();
    const { email, cookie: first, sku } = await b.producerWithSku();
    await b.pay(await b.checkout(first, { product: 'producer' }));
    b.advance(33 * DAY * 1000);
    const cookie = await b.signIn(email); // sessions last 30 days
    expect((await b.me(cookie)).printReady).toBeNull();

    // Stripe renewed it, but the event never arrived.
    const portal = await json(await b.call('POST', 'billing/portal', undefined, cookie));
    const renewed = b.fake.subscriptionFor(portal.url.split('/').pop().split('?')[0])!;
    renewed.items.data[0]!.current_period_end = b.seconds() + 27 * DAY;
    const res = await b.call('POST', `skus/${sku.id}/exports`, { edition: 'print' }, cookie);
    expect(res.status).toBe(201);
    expect(await b.me(cookie)).toMatchObject({ printReady: 'subscription' });
  });

  it('waits for bank payments, and refuses unsigned or unknown events', async () => {
    const b = billing();
    const { cookie } = await b.producerWithSku();
    const url = await b.checkout(cookie, { product: 'export' });
    const session = b.fake.sessionFor(url.split('/').pop()!)!;
    session.status = 'complete'; // paid by bank debit: complete, but not yet paid
    await b.deliver(b.event('checkout.session.completed', session.id));
    expect((await b.me(cookie)).exportCredits).toBe(0);
    session.payment_status = 'paid';
    await b.deliver(b.event('checkout.session.async_payment_succeeded', session.id));
    expect((await b.me(cookie)).exportCredits).toBe(1);

    const forged = await b.deliver(
      b.event('checkout.session.completed', session.id),
      'not-the-secret',
    );
    expect(forged.status).toBe(400);
    const unsigned = await b.app.request(
      `${origin}/api/stripe/webhook`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      { ...env, STRIPE_WEBHOOK_SECRET: SECRET } as Env,
    );
    expect(unsigned.status).toBe(400);
    expect((await b.deliver(b.event('invoice.paid', 'in_1'))).status).toBe(200);
    expect(b.events.at(-1)).toMatchObject({ outcome: 'ignored' });

    // A payment for an account that does not exist changes nothing.
    const stray = await b.fake.createCheckoutSession({
      mode: 'payment',
      price: 'price_fake_export',
      customer: 'cus_nobody',
      accountId: 'nobody',
      product: 'export',
      successUrl: `${origin}/billing?checkout=complete`,
      cancelUrl: `${origin}/billing`,
    });
    for (const e of b.fake.complete(stray.id, 'pay')!.events) await b.deliver(e);
    expect(b.events.some((e) => e.event === 'stripe_unmatched')).toBe(true);
  });

  it('says payments are unavailable without Stripe, and portal needs a purchase', async () => {
    const plain = setup(env);
    const cookie = await plain.signIn(unique());
    expect(
      (await plain.call('POST', 'billing/checkout', { product: 'export' }, cookie)).status,
    ).toBe(503);
    expect((await plain.call('POST', 'billing/portal', undefined, cookie)).status).toBe(503);
    expect((await plain.call('POST', 'stripe/webhook', {})).status).toBe(503);
    expect((await plain.call('POST', 'billing/checkout', { product: 'export' })).status).toBe(401);

    const b = billing();
    const fresh = await b.signIn(unique());
    const portal = await b.call('POST', 'billing/portal', undefined, fresh);
    expect(portal.status).toBe(409);
    expect((await json(portal)).error).toBe('no_billing_account');
    expect((await b.call('POST', 'billing/checkout', { product: 'mug' }, fresh)).status).toBe(404);
  });
});
