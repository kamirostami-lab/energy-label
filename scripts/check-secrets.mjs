#!/usr/bin/env node
// Keeps secrets out of the repository (Build Brief 01, section 11). Secrets live in Wrangler
// secrets and the Cloudflare dashboard only.
//   node scripts/check-secrets.mjs --staged   pre-commit hook: files staged for commit
//   node scripts/check-secrets.mjs --all      CI: every tracked file
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** File names that must never be committed, whatever they contain. */
export const BLOCKED_FILES = [
  /(^|\/)\.dev\.vars(\.[^/]+)?$/,
  /(^|\/)\.env(\.[^/]+)?$/,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/,
];
/** Templates are fine: .dev.vars.example, .env.sample and the like. */
const TEMPLATE = /\.(example|sample|template)$/;

/** Content that looks like a live credential. */
export const KEY_PATTERNS = [
  ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ['Stripe secret or restricted key', /\b[rs]k_(?:live|test)_[0-9A-Za-z]{10,}/],
  ['Stripe webhook signing secret', /\bwhsec_[0-9A-Za-z]{16,}/],
  ['Resend API key', /\bre_[0-9A-Za-z]{6,}_[0-9A-Za-z]{12,}/],
  ['GitHub token', /\b(?:gh[oprsu]_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{40,})/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}/],
  ['Slack token', /\bxox[abopsr]-[0-9A-Za-z-]{10,}/],
  ['Anthropic API key', /\bsk-ant-[0-9A-Za-z_-]{20,}/],
  [
    'credential assigned to a known secret name',
    /\b(?:CLOUDFLARE_API_TOKEN|CLOUDFLARE_API_KEY|CF_API_TOKEN|STRIPE_SECRET_KEY|STRIPE_WEBHOOK_SECRET|RESEND_API_KEY)\s*[:=]\s*["']?[0-9A-Za-z_-]{16,}/,
  ],
];

/** Returns one problem per offending file: blocked name, or first matching key pattern. */
export function scan(files) {
  const problems = [];
  for (const { path, content } of files) {
    if (!TEMPLATE.test(path) && BLOCKED_FILES.some((pattern) => pattern.test(path))) {
      problems.push(`${path}: file type must never be committed`);
      continue;
    }
    if (content.includes('\0')) continue; // binary (fonts, images)
    const lines = content.split('\n');
    for (const [label, pattern] of KEY_PATTERNS) {
      const index = lines.findIndex((line) => pattern.test(line));
      if (index !== -1) {
        problems.push(`${path}:${index + 1}: looks like a ${label}`);
        break;
      }
    }
  }
  return problems;
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function collect(mode) {
  if (mode === '--staged') {
    return git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
      .split('\0')
      .filter(Boolean)
      .map((path) => ({ path, content: git(['show', `:${path}`]) }));
  }
  return git(['ls-files', '-z'])
    .split('\0')
    .filter(Boolean)
    .map((path) => ({ path, content: readFileSync(path, 'latin1') }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const mode = process.argv[2];
  if (mode !== '--staged' && mode !== '--all') {
    console.error('usage: check-secrets.mjs --staged | --all');
    process.exit(2);
  }
  const problems = scan(collect(mode));
  if (problems.length > 0) {
    console.error(
      'Secrets check failed. Secrets belong in Wrangler secrets or the Cloudflare dashboard:',
    );
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
}
