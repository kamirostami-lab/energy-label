// Worker bindings and variables the API reads. Secrets (RESEND_API_KEY, STRIPE_SECRET_KEY,
// STRIPE_WEBHOOK_SECRET) are set with `wrangler secret put` or in the Cloudflare dashboard, never
// in the repository.
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

export interface Env {
  /** Accounts, SKUs and export records. */
  DB?: D1Database;
  /** Exported files. */
  EXPORTS?: R2Bucket;
  /** Resend API key for sign-in emails (a Wrangler secret). */
  RESEND_API_KEY?: string;
  /** Sender for sign-in emails, e.g. "Energy Panel <sign-in@example.com>". */
  MAIL_FROM?: string;
  /**
   * "outbox" keeps sign-in emails in memory instead of sending them, for local development and
   * the browser tests. It only answers on localhost.
   */
  MAIL_TRANSPORT?: string;
  /** Stripe secret or restricted key (a Wrangler secret). Without it, payments are unavailable. */
  STRIPE_SECRET_KEY?: string;
  /** Signing secret of the Stripe webhook endpoint for /api/stripe/webhook (a Wrangler secret). */
  STRIPE_WEBHOOK_SECRET?: string;
  /** Stripe tax rate for GST (10%, inclusive), so receipts and invoices show the GST part. */
  STRIPE_TAX_RATE_GST?: string;
  /**
   * "fake" puts a local stand-in in Stripe's place, with checkout and portal pages, for local
   * development and the browser tests. It only answers on localhost.
   */
  STRIPE_TRANSPORT?: string;
}
