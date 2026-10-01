// Magic-link sign-in (Build Brief 01 section 5: email magic link via Resend, no passwords).
//   POST /api/auth/request   email → a single-use link, valid 15 minutes
//   POST /api/auth/verify    token from the link → session cookie (30 days)
//   GET  /api/auth/me        the signed-in account, or null for visitors
//   POST /api/auth/sign-out  ends the session
//   PATCH /api/account       organisation name and role
// The link carries its token in the URL fragment, which never reaches a server or its logs, and
// the confirm page posts it, so email scanners that open links cannot use them up. Only hashes
// of tokens and session ids are stored. Logs never include email addresses.
import type { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { SESSION_COOKIE, accountJson, currentAccount, type AppEnv, type Deps } from '../context.ts';
import { randomToken, sha256Hex } from '../crypto.ts';
import { isLocalhost, noStore, problem, readBody } from '../http.ts';
import { mailerFor, outbox, signInMessage } from '../mail.ts';
import {
  ROLES,
  accountById,
  accountForEmail,
  deleteSession,
  recentLoginTokens,
  storeLoginToken,
  storeSession,
  updateAccount,
  useLoginToken,
} from '../store.ts';

const LINK_MINUTES = 15;
const SESSION_DAYS = 30;
const LINKS_PER_HOUR = 5;
export const ORG_NAME_MAX_LENGTH = 80;

const requestSchema = z.object({ email: z.string().max(320) }).strict();
const verifySchema = z.object({ token: z.string().min(20).max(200) }).strict();
const accountSchema = z
  .object({ orgName: z.string().max(200).nullish(), role: z.string().max(20).optional() })
  .strict();

/** Lower-cased; one @, a dot in the domain, no spaces. Delivery is the real check. */
export function normaliseEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function registerAuthRoutes(app: Hono<AppEnv>, deps: Deps) {
  const at = (offsetMs = 0) => new Date(deps.now().getTime() + offsetMs).toISOString();

  app.post('/auth/request', async (c) => {
    const read = await readBody(c, requestSchema);
    if (!read.ok) return problem(c, read.problem);
    const email = normaliseEmail(read.body.email);
    if (!email) {
      return problem(c, {
        status: 422,
        error: 'invalid_email',
        message: 'Enter a valid email address.',
      });
    }
    const db = c.env?.DB;
    const mailer = deps.mailer ? deps.mailer(c.env ?? {}) : mailerFor(c.env ?? {});
    if (!db || !mailer) {
      return problem(c, {
        status: 503,
        error: 'sign_in_unavailable',
        message: 'Sign-in is not available yet.',
      });
    }
    if ((await recentLoginTokens(db, email, at(-60 * 60 * 1000))) >= LINKS_PER_HOUR) {
      return problem(c, {
        status: 429,
        error: 'too_many_links',
        message:
          'Too many sign-in links have been requested for this address. Try again in an hour.',
      });
    }
    const token = randomToken();
    await storeLoginToken(db, await sha256Hex(token), email, at(LINK_MINUTES * 60 * 1000), at());
    const link = `${new URL(c.req.url).origin}/sign-in/confirm#token=${token}`;
    try {
      await mailer.send(signInMessage(email, link, LINK_MINUTES));
    } catch {
      deps.log({ event: 'sign_in_link_failed' });
      return problem(c, {
        status: 502,
        error: 'mail_failed',
        message: 'The sign-in email could not be sent. Try again in a minute.',
      });
    }
    deps.log({ event: 'sign_in_link_sent' });
    return c.json(
      { ok: true, message: 'Check your email for a sign-in link.', expiresInMinutes: LINK_MINUTES },
      202,
      noStore,
    );
  });

  app.post('/auth/verify', async (c) => {
    const read = await readBody(c, verifySchema);
    if (!read.ok) return problem(c, read.problem);
    const db = c.env?.DB;
    if (!db) {
      return problem(c, {
        status: 503,
        error: 'sign_in_unavailable',
        message: 'Sign-in is not available yet.',
      });
    }
    const email = await useLoginToken(db, await sha256Hex(read.body.token), at());
    if (!email) {
      return problem(c, {
        status: 400,
        error: 'invalid_link',
        message: 'This sign-in link has expired or has already been used. Ask for a new one.',
      });
    }
    const account = await accountForEmail(db, email, deps.newId(), at());
    const session = randomToken();
    await storeSession(
      db,
      await sha256Hex(session),
      account.id,
      at(SESSION_DAYS * 86_400_000),
      at(),
    );
    setCookie(c, SESSION_COOKIE, session, {
      path: '/',
      maxAge: SESSION_DAYS * 86_400,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    });
    deps.log({ event: 'signed_in' });
    return c.json({ account: accountJson(account, deps.now()) }, 200, noStore);
  });

  // Every page asks on load, so a visitor is an answer, not an error.
  app.get('/auth/me', async (c) => {
    const account = await currentAccount(c, deps);
    return c.json({ account: account ? accountJson(account, deps.now()) : null }, 200, noStore);
  });

  app.post('/auth/sign-out', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token && c.env?.DB) await deleteSession(c.env.DB, await sha256Hex(token));
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
    return c.json({ ok: true }, 200, noStore);
  });

  app.patch('/account', async (c) => {
    const account = await currentAccount(c, deps);
    if (!account || !c.env?.DB) {
      return problem(c, {
        status: 401,
        error: 'signed_out',
        message: 'Sign in to change your account.',
      });
    }
    const read = await readBody(c, accountSchema);
    if (!read.ok) return problem(c, read.problem);
    const orgName = read.body.orgName?.trim();
    if (orgName !== undefined && orgName.length > ORG_NAME_MAX_LENGTH) {
      return problem(
        c,
        {
          status: 422,
          error: 'invalid_account',
          message: `Keep the organisation name to ${ORG_NAME_MAX_LENGTH} characters.`,
        },
        { field: 'orgName' },
      );
    }
    const role = read.body.role;
    if (role !== undefined && !ROLES.includes(role as (typeof ROLES)[number])) {
      return problem(
        c,
        { status: 422, error: 'invalid_account', message: 'Choose producer, printer or designer.' },
        { field: 'role' },
      );
    }
    await updateAccount(c.env.DB, account.id, {
      ...(orgName !== undefined ? { orgName: orgName || null } : {}),
      ...(role !== undefined ? { role: role as (typeof ROLES)[number] } : {}),
    });
    const updated = await accountById(c.env.DB, account.id);
    return c.json({ account: accountJson(updated!, deps.now()) }, 200, noStore);
  });

  // Local development and browser tests only: the outbox transport's messages for one address.
  app.get('/dev/outbox', (c) => {
    if (c.env?.MAIL_TRANSPORT !== 'outbox' || !isLocalhost(c.req.url)) {
      return c.json({ error: 'not_found', message: 'Not found.' }, 404, noStore);
    }
    const to = (c.req.query('to') ?? '').toLowerCase();
    return c.json({ messages: outbox.filter((m) => m.to === to) }, 200, noStore);
  });
}
