// Request and response helpers shared by the routes.
import type { Context } from 'hono';
import type { z } from 'zod';

export const noStore = { 'Cache-Control': 'no-store' } as const;

export type Problem = {
  status: 400 | 401 | 402 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 502 | 503;
  error: string;
  message: string;
};

export const problem = (c: Context, p: Problem, extra: Record<string, unknown> = {}) =>
  c.json({ error: p.error, message: p.message, ...extra }, p.status, noStore);

/** Parses a JSON body against a schema; the error names what was wrong without echoing values. */
export async function readBody<T extends z.ZodType>(
  c: Context,
  schema: T,
): Promise<{ ok: true; body: z.infer<T> } | { ok: false; problem: Problem }> {
  if (!(c.req.header('content-type') ?? '').startsWith('application/json')) {
    return {
      ok: false,
      problem: { status: 415, error: 'unsupported_media_type', message: 'Send JSON.' },
    };
  }
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, problem: { status: 400, error: 'bad_json', message: 'Invalid JSON.' } };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join('.') || '(body)'))];
    return {
      ok: false,
      problem: {
        status: 400,
        error: 'bad_request',
        message: `Unexpected request shape: ${fields.join(', ')}.`,
      },
    };
  }
  return { ok: true, body: parsed.data };
}

/** Local development and the browser tests: where the stand-ins (mail outbox, fake Stripe) answer. */
export const isLocalhost = (url: string) =>
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);

/** Rejects cross-site requests: a browser sends Origin with every POST. */
export function crossSite(c: Context): boolean {
  const origin = c.req.header('origin');
  if (origin === undefined) return false;
  try {
    return new URL(origin).host !== new URL(c.req.url).host;
  } catch {
    return true;
  }
}

/** The visitor's date when it is within a day of the server's (time zones), else the server's. */
export function resolveIssueDate(requested: string | undefined, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  if (requested === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(requested)) return today;
  const day = Date.parse(`${requested}T00:00:00Z`);
  if (Number.isNaN(day) || new Date(day).toISOString().slice(0, 10) !== requested) return today;
  return Math.abs(day - Date.parse(`${today}T00:00:00Z`)) <= 86_400_000 ? requested : today;
}
