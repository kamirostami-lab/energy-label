// Sign-in email. Resend in production (RESEND_API_KEY and MAIL_FROM set); an in-memory outbox for
// local development and browser tests (MAIL_TRANSPORT=outbox); otherwise sign-in is unavailable.
import type { Env } from './env.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export function resendMailer(apiKey: string, from: string): Mailer {
  return {
    async send(message) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (!res.ok) throw new Error(`Resend responded ${res.status}`);
    },
  };
}

/** Messages sent through the outbox transport, newest last. Local development only. */
export const outbox: MailMessage[] = [];

const outboxMailer: Mailer = {
  async send(message) {
    outbox.push(message);
    if (outbox.length > 50) outbox.shift();
  },
};

export function mailerFor(env: Env): Mailer | null {
  if (env.RESEND_API_KEY && env.MAIL_FROM) return resendMailer(env.RESEND_API_KEY, env.MAIL_FROM);
  if (env.MAIL_TRANSPORT === 'outbox') return outboxMailer;
  return null;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function signInMessage(to: string, link: string, minutes: number): MailMessage {
  const lines = [
    'Sign in to Energy Panel with this link. It works once and expires in',
    `${minutes} minutes:`,
  ];
  return {
    to,
    subject: 'Your Energy Panel sign-in link',
    text: `${lines.join(' ')}\n\n${link}\n\nIf you did not ask to sign in, you can ignore this email.\n`,
    html: `<p>${lines.join(' ')}</p><p><a href="${escapeHtml(link)}">Sign in to Energy Panel</a></p><p>If you did not ask to sign in, you can ignore this email.</p>`,
  };
}
