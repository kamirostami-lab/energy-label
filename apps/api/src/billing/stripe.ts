// Stripe through its REST API and the Workers runtime's fetch: the six calls billing needs, pinned
// to one API version, and webhook signature checks with Web Crypto. No SDK: it would add a large
// bundle to the Worker for six requests. Object types list only the fields read here, as the
// pinned version shapes them (a subscription's period sits on its items since 2025-03-31).
import type { ProductId } from './products.ts';

export const STRIPE_API_VERSION = '2026-09-30.endive';
/** Stripe's own default: older signed events are refused, so a captured one cannot be replayed. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface StripePrice {
  id: string;
  lookup_key: string | null;
  unit_amount: number | null;
  currency: string;
  recurring: { interval: string; interval_count: number } | null;
  tax_behavior: string | null;
  active: boolean;
}

export interface StripeCheckoutSession {
  id: string;
  url: string | null;
  mode: string;
  status: string | null;
  payment_status: string;
  client_reference_id: string | null;
  customer: string | null;
  subscription: string | null;
  metadata: Record<string, string> | null;
  amount_total: number | null;
  currency: string | null;
}

export interface StripeSubscription {
  id: string;
  status: string;
  customer: string;
  metadata: Record<string, string> | null;
  cancel_at_period_end: boolean;
  items: {
    data: Array<{ price: { id: string; lookup_key: string | null }; current_period_end: number }>;
  };
}

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: { id: string; object?: string } };
}

export interface CheckoutRequest {
  mode: 'payment' | 'subscription';
  price: string;
  customer: string;
  accountId: string;
  product: ProductId;
  skuId?: string;
  successUrl: string;
  cancelUrl: string;
  /** A Stripe tax rate for GST (inclusive, 10%), so receipts and invoices show it. */
  taxRate?: string;
}

/** What billing needs from Stripe: the real API, or the local stand-in (./fake.ts). */
export interface Stripe {
  /** Active prices with these lookup keys. */
  prices(lookupKeys: readonly string[]): Promise<StripePrice[]>;
  createCustomer(email: string, accountId: string): Promise<{ id: string }>;
  createCheckoutSession(request: CheckoutRequest): Promise<{ id: string; url: string }>;
  retrieveCheckoutSession(id: string): Promise<StripeCheckoutSession>;
  retrieveSubscription(id: string): Promise<StripeSubscription>;
  createPortalSession(customer: string, returnUrl: string): Promise<{ url: string }>;
}

export class StripeApiError extends Error {
  readonly status: number;
  readonly type: string | undefined;

  constructor(status: number, type: string | undefined) {
    // Stripe's message is left out: it can quote request values.
    super(`Stripe responded ${status}${type ? ` (${type})` : ''}`);
    this.name = 'StripeApiError';
    this.status = status;
    this.type = type;
  }
}

/** Stripe's form encoding: nested objects and arrays as a[b][0][c]=v. */
export function formEncode(params: Record<string, unknown>): string {
  const pairs: string[] = [];
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => add(`${key}[${i}]`, item));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) add(`${key}[${k}]`, v);
    } else {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  };
  for (const [key, value] of Object.entries(params)) add(key, value);
  return pairs.join('&');
}

/** The Stripe API with a secret or restricted key. `fetcher` is replaceable for tests. */
export function stripeApi(secretKey: string, fetcher: typeof fetch = fetch): Stripe {
  async function call<T>(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, unknown> = {},
    idempotencyKey?: string,
  ): Promise<T> {
    const query = formEncode(params);
    const res = await fetcher(
      `https://api.stripe.com/v1/${path}${method === 'GET' && query ? `?${query}` : ''}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${secretKey}`,
          'Stripe-Version': STRIPE_API_VERSION,
          ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        ...(method === 'POST' ? { body: query } : {}),
      },
    );
    const body = (await res.json().catch(() => null)) as { error?: { type?: string } } | null;
    if (!res.ok) throw new StripeApiError(res.status, body?.error?.type);
    return body as T;
  }

  return {
    async prices(lookupKeys) {
      const list = await call<{ data: StripePrice[] }>('GET', 'prices', {
        active: true,
        limit: 100,
        lookup_keys: [...lookupKeys],
      });
      return list.data;
    },
    createCustomer: (email, accountId) =>
      // One customer per account even if two first purchases start at once.
      call(
        'POST',
        'customers',
        { email, metadata: { account_id: accountId } },
        `customer-${accountId}`,
      ),
    async createCheckoutSession(r) {
      const metadata = { account_id: r.accountId, product: r.product, sku_id: r.skuId };
      const session = await call<StripeCheckoutSession>('POST', 'checkout/sessions', {
        mode: r.mode,
        customer: r.customer,
        client_reference_id: r.accountId,
        line_items: [
          { price: r.price, quantity: 1, tax_rates: r.taxRate ? [r.taxRate] : undefined },
        ],
        success_url: r.successUrl,
        cancel_url: r.cancelUrl,
        metadata,
        ...(r.mode === 'payment'
          ? {
              // A tax invoice for the purchase; subscriptions get one with every payment anyway.
              invoice_creation: { enabled: true },
              payment_intent_data: { metadata },
            }
          : { subscription_data: { metadata } }),
      });
      if (!session.url) throw new StripeApiError(502, 'missing_url');
      return { id: session.id, url: session.url };
    },
    retrieveCheckoutSession: (id) => call('GET', `checkout/sessions/${encodeURIComponent(id)}`),
    retrieveSubscription: (id) => call('GET', `subscriptions/${encodeURIComponent(id)}`),
    createPortalSession: (customer, returnUrl) =>
      call('POST', 'billing_portal/sessions', { customer, return_url: returnUrl }),
  };
}

const encoder = new TextEncoder();

function hexBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/**
 * Checks a `Stripe-Signature` header (`t=<seconds>,v1=<hex>[,v1=…]`): an HMAC-SHA256 with the
 * endpoint's signing secret over `<t>.<raw body>`, made within the tolerance of `nowSeconds`.
 * Web Crypto's verify compares in constant time.
 */
export async function verifyStripeSignature(
  payload: string,
  header: string | null | undefined,
  secret: string,
  nowSeconds: number,
  toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS,
): Promise<boolean> {
  if (!header || !secret) return false;
  let timestamp = Number.NaN;
  const signatures: Uint8Array<ArrayBuffer>[] = [];
  for (const part of header.split(',')) {
    const at = part.indexOf('=');
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === 't' && /^\d+$/.test(value)) timestamp = Number(value);
    if (key === 'v1') {
      const bytes = hexBytes(value);
      if (bytes) signatures.push(bytes);
    }
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signed = encoder.encode(`${timestamp}.${payload}`);
  for (const signature of signatures) {
    if (await crypto.subtle.verify('HMAC', key, signature, signed)) return true;
  }
  return false;
}

/** The header Stripe would send for `payload`: for the tests and the local stand-in. */
export async function signStripePayload(
  payload: string,
  secret: string,
  timestamp: number,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${payload}`)),
  );
  return `t=${timestamp},v1=${[...mac].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
