// A real D1 database and R2 bucket for the tests: Wrangler's local platform (the same one the
// adapter uses in development), read from apps/web/wrangler.jsonc, in memory, with the
// repository's migrations applied.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env.ts';

export async function testBindings() {
  const proxy = await getPlatformProxy<Env>({
    configPath: fileURLToPath(new URL('../../web/wrangler.jsonc', import.meta.url)),
    persist: false,
  });
  const env = proxy.env;
  const dir = new URL('../../../migrations/', import.meta.url);
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    const statements = readFileSync(new URL(file, dir), 'utf8')
      .replace(/--.*$/gm, '')
      .split(/;\s*$/m)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const statement of statements) await env.DB!.prepare(statement).run();
  }
  return { env, dispose: () => proxy.dispose() };
}
