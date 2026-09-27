import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scan } from './check-secrets.mjs';

// Fake credentials are assembled at runtime so this file never matches its own patterns.
const fake = (...parts) => parts.join('');

test('blocks secret files by name', () => {
  for (const path of [
    '.dev.vars',
    'apps/api/.dev.vars',
    '.env',
    '.env.production',
    'certs/site.pem',
    'id_ed25519',
  ]) {
    assert.equal(scan([{ path, content: '' }]).length, 1, path);
  }
});

test('allows templates and public keys', () => {
  for (const path of ['.dev.vars.example', '.env.sample', 'id_ed25519.pub']) {
    assert.deepEqual(scan([{ path, content: '' }]), [], path);
  }
});

test('flags credential-shaped content with its line number', () => {
  const cases = [
    fake('sk_', 'live_', 'a1B2c3D4e5F6g7H8i9J0'),
    fake('rk_', 'test_', 'a1B2c3D4e5F6g7H8i9J0'),
    fake('whsec_', 'a1B2c3D4e5F6g7H8i9J0'),
    fake('re_', 'abc12345_', 'a1B2c3D4e5F6g7H8'),
    fake('ghp_', 'a'.repeat(36)),
    fake('AKIA', 'ABCDEFGHIJKLMNOP'),
    fake('-----BEGIN ', 'RSA PRIVATE KEY-----'),
    fake('RESEND_API_KEY', '=', 'a1B2c3D4e5F6g7H8i9J0'),
  ];
  for (const secret of cases) {
    const [problem] = scan([
      { path: 'src/config.ts', content: `const a = 1;\nconst key = "${secret}";\n` },
    ]);
    assert.match(problem ?? '', /^src\/config\.ts:2: looks like/, secret);
  }
});

test('ignores ordinary code, publishable keys and binary files', () => {
  const files = [
    {
      path: 'src/a.ts',
      content: 'const pk = "pk_live_abcdefghijklmnop"; // publishable, not secret\n',
    },
    { path: 'src/b.ts', content: 'const risk_level = 3;\nconst desk_live_count = 2;\n' },
    { path: 'fonts/a.otf', content: `OTTO\0${fake('sk_', 'live_', 'a1B2c3D4e5F6g7H8i9J0')}` },
  ];
  assert.deepEqual(scan(files), []);
});
