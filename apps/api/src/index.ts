// Energy Panel API (Hono). It runs inside the web app's Worker under /api: one deployment, one
// origin (decision D9). Routes live in ./routes:
//   statement.ts  POST /preview, POST /export (visitors' free preview export)
//   auth.ts       magic-link sign-in, account profile
//   skus.ts       SKU records, account exports to R2, CSV, downloads
//   billing.ts    plans and prices, Stripe Checkout and Customer Portal, the Stripe webhook
// Logs carry event names and ids only, never input values or email addresses (brief section 11).
import { loadFsanzEnergyStatementRules, type EnergyStatementRules } from '@energy-panel/rules';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { AppEnv, Deps } from './context.ts';
import type { Env } from './env.ts';
import { crossSite, noStore, problem } from './http.ts';
import type { Stripe } from './billing/stripe.ts';
import type { Mailer } from './mail.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerBillingRoutes } from './routes/billing.ts';
import { registerSkuRoutes } from './routes/skus.ts';
import { registerStatementRoutes } from './routes/statement.ts';

export { generatorConfig, type GeneratorConfig } from './config.ts';
export { SESSION_COOKIE } from './context.ts';
export type { Env } from './env.ts';
export { outputHash, renderExportFiles, replayExport } from './export-files.ts';
export { resolveIssueDate } from './http.ts';
export { outbox, type MailMessage, type Mailer } from './mail.ts';
export { createFakeStripe, type FakeStripe } from './billing/fake.ts';
export { PRODUCTS, type ProductId } from './billing/products.ts';
export {
  STRIPE_API_VERSION,
  signStripePayload,
  stripeApi,
  verifyStripeSignature,
  type Stripe,
} from './billing/stripe.ts';
export { normaliseEmail } from './routes/auth.ts';
export { FREE_EXPORT_COOKIE } from './routes/statement.ts';

export interface ApiDependencies {
  rules?: EnergyStatementRules;
  now?: () => Date;
  log?: (event: Record<string, string | number | boolean>) => void;
  newId?: () => string;
  mailer?: (env: Env) => Mailer | null;
  stripe?: (env: Env) => Stripe | null;
}

export function createApi(dependencies: ApiDependencies = {}) {
  const deps: Deps = {
    rules: dependencies.rules ?? loadFsanzEnergyStatementRules(),
    now: dependencies.now ?? (() => new Date()),
    log: dependencies.log ?? ((event) => console.log(JSON.stringify(event))),
    newId: dependencies.newId ?? (() => crypto.randomUUID()),
    ...(dependencies.mailer ? { mailer: dependencies.mailer } : {}),
    ...(dependencies.stripe ? { stripe: dependencies.stripe } : {}),
  };

  const app = new Hono<AppEnv>().basePath('/api');

  const tooLarge = (c: Context) =>
    problem(c, { status: 413, error: 'too_large', message: 'The request is too large.' });
  const requestLimit = bodyLimit({ maxSize: 16 * 1024, onError: tooLarge });
  // Stripe's events can be larger than anything the pages send.
  const webhookLimit = bodyLimit({ maxSize: 512 * 1024, onError: tooLarge });
  app.use('*', (c, next) =>
    c.req.path === '/api/stripe/webhook' ? webhookLimit(c, next) : requestLimit(c, next),
  );
  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && crossSite(c)) {
      return problem(c, { status: 403, error: 'cross_site', message: 'Cross-site request.' });
    }
    await next();
  });

  registerStatementRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerSkuRoutes(app, deps);
  registerBillingRoutes(app, deps);

  app.notFound((c) => c.json({ error: 'not_found', message: 'Not found.' }, 404, noStore));
  app.onError((error, c) => {
    // The error name only: messages can quote input values.
    deps.log({ event: 'api_error', name: error.name });
    return c.json({ error: 'internal', message: 'Something went wrong. Try again.' }, 500, noStore);
  });

  return app;
}

export type Api = ReturnType<typeof createApi>;
