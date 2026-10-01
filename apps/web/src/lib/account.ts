// Account types and requests shared by the pages. The session is an HttpOnly cookie, so the page
// never sees it: it asks the API who is signed in.
import type { BeverageTypeId, StatementInputs, StatementOptions } from '@energy-panel/panel';

export interface Account {
  id: string;
  email: string;
  orgName: string | null;
  role: 'producer' | 'printer' | 'designer';
  /** free, producer or printer */
  plan: string;
  freeExportAvailable: boolean;
  /** Print-ready exports bought and not yet used. */
  exportCredits: number;
  /** What pays for the next print-ready export, if anything does. */
  printReady: 'subscription' | 'credit' | null;
  subscription: {
    status: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  /** Stripe knows this account, so there is billing to manage. */
  billingAccount: boolean;
}

export interface Product {
  id: 'export' | 'producer' | 'printer';
  name: string;
  summary: string;
  mode: 'payment' | 'subscription';
  /** Minor units (cents), GST included. */
  amount: number;
  currency: string;
  interval: string | null;
}

export interface Billing {
  /** Stripe is set up and every product on sale has a price. */
  available: boolean;
  products: Product[];
  account: Account | null;
}

export interface Sku {
  id: string;
  name: string;
  /** Names the files and appears on the proof; the account's organisation fills it by default. */
  producer: string | null;
  beverageType: BeverageTypeId | null;
  vintageOrBatch: string | null;
  inputs: StatementInputs;
  options: StatementOptions;
  createdAt: string;
  updatedAt: string;
}

export interface SkuSummary extends Sku {
  exportCount: number;
  lastExport: { createdAt: string; rulesVersion: string } | null;
}

export interface StoredExport {
  id: string;
  skuId: string;
  createdAt: string;
  issuedOn: string;
  rulesVersion: string;
  watermarked: boolean;
  /** free (the watermarked preview), credit (a bought export) or subscription (a plan). */
  entitlement: 'free' | 'credit' | 'subscription';
  outputHash: string;
  files: Array<{ kind: string; fileName: string; url: string }>;
}

/** JSON request to the API; returns the parsed body and status, never throws on 4xx. */
export async function api<T = any>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(`/api/${path}`, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const data = res.headers.get('content-type')?.includes('application/json')
    ? await res.json()
    : null;
  return { ok: res.ok, status: res.status, data: data as T };
}

/** "30 Sep 2026" */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "A$12", or "A$12.50" when there are cents. */
export function money(amount: number, currency: string): string {
  const value = amount % 100 === 0 ? String(amount / 100) : (amount / 100).toFixed(2);
  return currency === 'aud' ? `A$${value}` : `${currency.toUpperCase()} ${value}`;
}

/** "A$24 a month" or "A$12". */
export const priceLabel = (product: Product) =>
  `${money(product.amount, product.currency)}${product.interval === 'month' ? ' a month' : product.interval ? ` a ${product.interval}` : ''}`;

/** Sends the browser to Stripe Checkout; resolves with the refusal's message if there is one. */
export async function startCheckout(product: Product['id'], skuId?: string): Promise<string> {
  try {
    const res = await api<{ url?: string; message?: string }>('billing/checkout', {
      method: 'POST',
      body: { product, ...(skuId ? { skuId } : {}) },
    });
    if (res.ok && res.data?.url) {
      location.assign(res.data.url);
      return '';
    }
    return res.data?.message ?? 'Checkout could not be started. Try again.';
  } catch {
    return 'Checkout could not be started. Check your connection and try again.';
  }
}

/** Sends the browser to the Stripe Customer Portal: plan, card, invoices. */
export async function openPortal(): Promise<string> {
  try {
    const res = await api<{ url?: string; message?: string }>('billing/portal', { method: 'POST' });
    if (res.ok && res.data?.url) {
      location.assign(res.data.url);
      return '';
    }
    return res.data?.message ?? 'Billing could not be opened. Try again.';
  } catch {
    return 'Billing could not be opened. Check your connection and try again.';
  }
}

/** Takes ?checkout=complete|cancelled&product=… (Stripe's way back) off the address. */
export function takeCheckoutResult(): {
  outcome: 'complete' | 'cancelled';
  product: Product['id'] | null;
} | null {
  const url = new URL(location.href);
  const result = url.searchParams.get('checkout');
  if (result === null) return null;
  const product = url.searchParams.get('product');
  url.searchParams.delete('checkout');
  url.searchParams.delete('product');
  // The router may still be starting: the history API directly, keeping its state.
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return {
    outcome: result === 'complete' ? 'complete' : 'cancelled',
    product:
      product === 'export' || product === 'producer' || product === 'printer' ? product : null,
  };
}

/** True once the account shows what was bought: a credit, or the plan. */
export const shows = (product: Product['id'] | null) => (account: Account) =>
  product === 'producer' || product === 'printer'
    ? account.printReady === 'subscription'
    : account.printReady !== null;
