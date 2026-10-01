// The API under test: fixed clock and ids, captured logs and mail, and an optional Stripe
// stand-in, against the bindings from ./env.ts.
import { loadFsanzEnergyStatementRules } from '@energy-panel/rules';
import { expect } from 'vitest';
import {
  SESSION_COOKIE,
  createApi,
  type Env,
  type MailMessage,
  type Stripe,
} from '../src/index.ts';

export const rules = loadFsanzEnergyStatementRules();
export const fsanz = { abv: 21.1, package_ml: 720, serving_ml: 60, kj_per_100ml: 592 };
export const origin = 'http://energy.test';

export const json = (res: Response): Promise<any> => res.json();
export const unique = () => `user${Math.random().toString(36).slice(2, 10)}@example.com`;
export const skuBody = (overrides: object = {}) => ({
  name: 'Reserve Tawny',
  beverageType: 'fortified_wine',
  vintageOrBatch: 'Batch 7',
  inputs: fsanz,
  options: { width_mm: 50, package_word: 'bottle' },
  ...overrides,
});

export interface HarnessOptions {
  start?: string;
  /** Stripe for every request; leave out for "payments not set up". */
  stripe?: Stripe;
}

export function setup(env: Env, options: HarnessOptions = {}) {
  let clock = Date.parse(options.start ?? '2026-09-30T02:00:00Z');
  let ids = 0;
  const sent: MailMessage[] = [];
  const events: Array<Record<string, unknown>> = [];
  const app = createApi({
    rules,
    now: () => new Date(clock),
    log: (event) => events.push(event),
    newId: () => `id-${Date.now()}-${++ids}`,
    mailer: () => ({ send: async (m) => void sent.push(m) }),
    stripe: () => options.stripe ?? null,
  });
  const call = (method: string, path: string, body?: unknown, cookie?: string, bindings = env) =>
    app.request(
      `${origin}/api/${path}`,
      {
        method,
        headers: {
          origin,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      bindings,
    );
  /** Requests a link for `email`, follows it, and returns the session cookie. */
  async function signIn(email: string) {
    expect((await call('POST', 'auth/request', { email })).status).toBe(202);
    const token = /#token=([\w-]+)/.exec(sent.at(-1)!.text)![1];
    const res = await call('POST', 'auth/verify', { token });
    expect(res.status).toBe(200);
    const value = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(res.headers.get('set-cookie')!)![1];
    return `${SESSION_COOKIE}=${value}`;
  }
  return {
    app,
    call,
    signIn,
    sent,
    events,
    /** The clock, in seconds, for the Stripe stand-in and webhook signatures. */
    seconds: () => Math.floor(clock / 1000),
    advance: (ms: number) => void (clock += ms),
  };
}
