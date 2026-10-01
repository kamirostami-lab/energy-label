// What can be bought, and what each purchase allows (Build Brief 01 section 3; decision D2:
// A$12 an export, A$24 a month for the Producer plan, A$240 a month for the Printer plan, GST
// included). The amounts live in Stripe on prices found by these lookup keys, so a price change
// happens in Stripe, not here.

export type ProductId = 'export' | 'producer' | 'printer';
export type Plan = 'free' | 'producer' | 'printer';

export interface Product {
  id: ProductId;
  name: string;
  lookupKey: string;
  /** Stripe Checkout mode: a one-off payment or a subscription. */
  mode: 'payment' | 'subscription';
  /** What it allows, for the plans page. */
  summary: string;
}

export const PRODUCTS: readonly Product[] = [
  {
    id: 'export',
    name: 'One print-ready export',
    lookupKey: 'energy_panel_export',
    mode: 'payment',
    summary: 'One export of one SKU: SVG, PDF, PDF 1.4 and the proof sheet, without the watermark.',
  },
  {
    id: 'producer',
    name: 'Producer plan',
    lookupKey: 'energy_panel_producer_monthly',
    mode: 'subscription',
    summary: 'Unlimited print-ready exports while the plan is active. Cancel any time.',
  },
  {
    id: 'printer',
    name: 'Printer plan',
    lookupKey: 'energy_panel_printer_monthly',
    mode: 'subscription',
    summary: 'Unlimited print-ready exports, with printer branding and job history.',
  },
];

/** On sale now. The Printer plan opens with its features in session 6 (Kami, 1 October 2026). */
export const ON_SALE: readonly ProductId[] = ['export', 'producer'];

/**
 * Subscription statuses that allow print-ready exports. A past-due subscription keeps them while
 * Stripe retries the payment; unpaid, cancelled, paused and incomplete ones do not.
 */
export const EXPORTING_STATUSES: readonly string[] = ['active', 'trialing', 'past_due'];

export const productById = (id: string) => PRODUCTS.find((p) => p.id === id);
export const productByLookupKey = (key: string | null | undefined) =>
  PRODUCTS.find((p) => p.lookupKey === key);

/** The plan a subscription product grants. */
export const planFor = (product: Product | undefined): Plan =>
  product?.id === 'producer' || product?.id === 'printer' ? product.id : 'free';
