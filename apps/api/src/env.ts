// Worker bindings and variables the API reads. Secrets (RESEND_API_KEY) are set with
// `wrangler secret put` or in the Cloudflare dashboard, never in the repository.
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
}
