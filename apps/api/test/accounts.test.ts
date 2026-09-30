// Accounts, SKU records and stored exports against a real local D1 database and R2 bucket.
import { loadFsanzEnergyStatementRules } from '@energy-panel/rules';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE,
  createApi,
  replayExport,
  type Env,
  type MailMessage,
} from '../src/index.ts';
import type { ExportRow } from '../src/store.ts';
import { testBindings } from './env.ts';

const rules = loadFsanzEnergyStatementRules();
const fsanz = { abv: 21.1, package_ml: 720, serving_ml: 60, kj_per_100ml: 592 };
const origin = 'http://energy.test';

let env: Env;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ env, dispose } = await testBindings());
});
afterAll(async () => {
  await dispose();
});

function setup(start = '2026-09-30T02:00:00Z') {
  let clock = Date.parse(start);
  let ids = 0;
  const sent: MailMessage[] = [];
  const events: Array<Record<string, unknown>> = [];
  const app = createApi({
    rules,
    now: () => new Date(clock),
    log: (event) => events.push(event),
    newId: () => `id-${Date.now()}-${++ids}`,
    mailer: () => ({ send: async (m) => void sent.push(m) }),
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
    advance: (ms: number) => void (clock += ms),
  };
}

const json = (res: Response): Promise<any> => res.json();
const unique = () => `user${Math.random().toString(36).slice(2, 10)}@example.com`;
const skuBody = (overrides: object = {}) => ({
  name: 'Reserve Tawny',
  beverageType: 'fortified_wine',
  vintageOrBatch: 'Batch 7',
  inputs: fsanz,
  options: { width_mm: 50, package_word: 'bottle' },
  ...overrides,
});

describe('magic-link sign-in', () => {
  it('emails a single-use link that signs in and creates the account', async () => {
    const { call, sent, events } = setup();
    const email = unique();
    const res = await call('POST', 'auth/request', { email: `  ${email.toUpperCase()} ` });
    expect(res.status).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(email);
    expect(sent[0]!.subject).toBe('Your Energy Panel sign-in link');
    const link = /(http\S+#token=[\w-]+)/.exec(sent[0]!.text)![1]!;
    expect(link.startsWith(`${origin}/sign-in/confirm#token=`)).toBe(true);
    const token = link.split('#token=')[1];

    const verified = await call('POST', 'auth/verify', { token });
    expect(verified.status).toBe(200);
    expect((await json(verified)).account).toMatchObject({
      email,
      orgName: null,
      role: 'producer',
      freeExportAvailable: true,
    });
    const cookie = verified.headers.get('set-cookie')!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);

    const again = await call('POST', 'auth/verify', { token });
    expect(again.status).toBe(400);
    expect((await json(again)).error).toBe('invalid_link');
    // Logs never carry the address.
    expect(JSON.stringify(events)).not.toContain('@');
  });

  it('refuses expired links, bad addresses and too many requests', async () => {
    const { call, sent, advance } = setup();
    const email = unique();
    await call('POST', 'auth/request', { email });
    const token = /#token=([\w-]+)/.exec(sent[0]!.text)![1];
    advance(16 * 60 * 1000);
    expect((await call('POST', 'auth/verify', { token })).status).toBe(400);

    expect((await call('POST', 'auth/request', { email: 'not an email' })).status).toBe(422);
    for (let i = 0; i < 4; i++) {
      expect((await call('POST', 'auth/request', { email })).status).toBe(202);
    }
    expect((await call('POST', 'auth/request', { email })).status).toBe(429);
  });

  it('says sign-in is unavailable when no mail transport is configured', async () => {
    const app = createApi({ rules, log: () => {} });
    const res = await app.request(
      `${origin}/api/auth/request`,
      {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ email: unique() }),
      },
      env,
    );
    expect(res.status).toBe(503);
    expect((await json(res)).error).toBe('sign_in_unavailable');
  });

  it('reads and updates the account, and signs out', async () => {
    const { call, signIn } = setup();
    const cookie = await signIn(unique());
    expect((await call('GET', 'auth/me', undefined, cookie)).status).toBe(200);

    const updated = await call(
      'PATCH',
      'account',
      { orgName: '  Château Lune  ', role: 'designer' },
      cookie,
    );
    expect((await json(updated)).account).toMatchObject({
      orgName: 'Château Lune',
      role: 'designer',
    });
    expect((await call('PATCH', 'account', { role: 'owner' }, cookie)).status).toBe(422);

    expect((await call('POST', 'auth/sign-out', {}, cookie)).status).toBe(200);
    expect(await json(await call('GET', 'auth/me', undefined, cookie))).toEqual({ account: null });
  });
});

describe('SKU records', () => {
  it('saves, lists, reads and updates SKUs, private to their account', async () => {
    const { call, signIn } = setup();
    const cookie = await signIn(unique());
    expect((await call('GET', 'skus')).status).toBe(401);

    const created = await call('POST', 'skus', skuBody(), cookie);
    expect(created.status).toBe(201);
    const { sku } = await json(created);
    expect(sku).toMatchObject({
      name: 'Reserve Tawny',
      producer: null,
      beverageType: 'fortified_wine',
      vintageOrBatch: 'Batch 7',
      inputs: { abv: 21.1, package_ml: 720, kj_per_100ml: 592, nip_displayed: null },
      options: { width_mm: 50, package_word: 'bottle' },
    });

    const list = await json(await call('GET', 'skus', undefined, cookie));
    expect(list.skus).toHaveLength(1);
    expect(list.skus[0]).toMatchObject({ id: sku.id, exportCount: 0, lastExport: null });

    const updated = await call(
      'PUT',
      `skus/${sku.id}`,
      skuBody({ name: 'Reserve Tawny 20 Year' }),
      cookie,
    );
    expect((await json(updated)).sku.name).toBe('Reserve Tawny 20 Year');

    // Drafts may be incomplete; names and beverage types are checked.
    const draft = await call('POST', 'skus', skuBody({ inputs: { abv: null } }), cookie);
    expect(draft.status).toBe(201);
    expect((await call('POST', 'skus', skuBody({ name: ' ' }), cookie)).status).toBe(422);
    expect((await call('POST', 'skus', skuBody({ beverageType: 'mead' }), cookie)).status).toBe(
      422,
    );
    const longProducer = await call('POST', 'skus', skuBody({ producer: 'x'.repeat(81) }), cookie);
    expect(longProducer.status).toBe(422);
    expect((await json(longProducer)).field).toBe('producer');

    const other = await signIn(unique());
    expect((await call('GET', `skus/${sku.id}`, undefined, other)).status).toBe(404);
    expect((await call('PUT', `skus/${sku.id}`, skuBody(), other)).status).toBe(404);
    expect((await json(await call('GET', 'skus', undefined, other))).skus).toHaveLength(0);
  });

  it('downloads the list as CSV, with formulas neutralised', async () => {
    const { call, signIn } = setup();
    const cookie = await signIn(unique());
    await call('PATCH', 'account', { orgName: 'Komms-Haus' }, cookie);
    await call(
      'POST',
      'skus',
      skuBody({ name: '=HYPERLINK("x")', producer: 'Komms-Haus', vintageOrBatch: null }),
      cookie,
    );
    const res = await call('GET', 'skus.csv', undefined, cookie);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="20260930-komms-haus-energy-panel-skus.csv"',
    );
    const [header, row] = (await res.text()).trim().split('\r\n');
    expect(header!.split(',').slice(0, 6)).toEqual([
      'sku_id',
      'name',
      'producer',
      'beverage_type',
      'vintage_or_batch',
      'abv',
    ]);
    expect(row).toContain(`"'=HYPERLINK(""x"")",Komms-Haus,fortified_wine,,21.1,720,60`);
  });
});

describe('account exports', () => {
  it('stores the free export in R2 with a record that replays to its output hash', async () => {
    const { call, signIn, events } = setup();
    const cookie = await signIn(unique());
    const { sku } = await json(await call('POST', 'skus', skuBody(), cookie));

    // No producer on the SKU and no organisation on the account: nothing to name the files by.
    const noProducer = await call('POST', `skus/${sku.id}/exports`, {}, cookie);
    expect(noProducer.status).toBe(422);
    expect(await json(noProducer)).toMatchObject({ error: 'producer_required', field: 'producer' });

    // The account's organisation stands in for a SKU saved without a producer.
    await call('PATCH', 'account', { orgName: 'Komms-Haus' }, cookie);
    const res = await call('POST', `skus/${sku.id}/exports`, { issuedOn: '2026-09-30' }, cookie);
    expect(res.status).toBe(201);
    const exported = (await json(res)).export;
    expect(exported).toMatchObject({ rulesVersion: rules.version, watermarked: true });
    expect(exported.files.map((f: { fileName: string }) => f.fileName)).toEqual([
      '20260930-komms-haus-reserve-tawny-energy-panel-50mm-preview.svg',
      '20260930-komms-haus-reserve-tawny-energy-panel-50mm-preview.pdf',
      '20260930-komms-haus-reserve-tawny-energy-panel-50mm-pdf14-preview.pdf',
      '20260930-komms-haus-reserve-tawny-energy-panel-50mm-proof-preview.pdf',
    ]);
    expect(events.at(-1)).toEqual({
      event: 'account_export',
      exportId: exported.id,
      files: 4,
    });

    const pdf = await call('GET', `exports/${exported.id}/files/pdf`, undefined, cookie);
    expect(pdf.headers.get('content-disposition')).toBe(
      `attachment; filename="${exported.files[1].fileName}"`,
    );
    expect(
      Buffer.from(await pdf.arrayBuffer())
        .subarray(0, 8)
        .toString('latin1'),
    ).toBe('%PDF-1.6');
    const other = await signIn(unique());
    expect((await call('GET', `exports/${exported.id}/files/pdf`, undefined, other)).status).toBe(
      404,
    );

    const detail = await json(await call('GET', `skus/${sku.id}`, undefined, cookie));
    expect(detail.exports).toHaveLength(1);
    const list = await json(await call('GET', 'skus', undefined, cookie));
    expect(list.skus[0]).toMatchObject({
      exportCount: 1,
      lastExport: { rulesVersion: rules.version },
    });

    // The export record as CSV: what was issued, from which values, under which rules.
    const csv = await call('GET', 'exports.csv', undefined, cookie);
    expect(csv.headers.get('content-disposition')).toBe(
      'attachment; filename="20260930-komms-haus-energy-panel-exports.csv"',
    );
    const [header, row] = (await csv.text()).trim().split('\r\n');
    expect(header).toBe(
      'export_id,sku_id,issued_on,created_at,rules_version,watermarked,producer,product,' +
        'vintage_or_batch,abv,package_ml,serving_ml,servings,kj_per_100ml,cal_per_100ml,' +
        'package_surface_area_cm2,nip_displayed,standardised_beverage,width_mm,colour,' +
        'energy_units,package_word,output_hash',
    );
    expect(row).toBe(
      `${exported.id},${sku.id},2026-09-30,2026-09-30T02:00:00.000Z,${rules.version},true,` +
        `Komms-Haus,Reserve Tawny,Batch 7,21.1,720,60,,592,,,,,50,black,kj,bottle,${exported.outputHash}`,
    );

    // Reproducibility (Build Brief 01 section 9): the stored record replays to the same hash.
    const record = await env
      .DB!.prepare('SELECT * FROM exports WHERE id = ?')
      .bind(exported.id)
      .first<ExportRow>();
    const replay = await replayExport(record!, rules);
    expect(replay).toEqual({
      matches: true,
      expected: exported.outputHash,
      actual: exported.outputHash,
    });
    const tampered = { ...record!, inputs_json: JSON.stringify({ ...fsanz, kj_per_100ml: 593 }) };
    expect((await replayExport(tampered, rules)).matches).toBe(false);

    const second = await call('POST', `skus/${sku.id}/exports`, {}, cookie);
    expect(second.status).toBe(403);
    expect((await json(second)).error).toBe('free_export_used');
  });

  it('keeps the free export when a statement is blocked or storage is missing', async () => {
    const { call, signIn } = setup();
    const cookie = await signIn(unique());
    await call('PATCH', 'account', { orgName: 'Komms-Haus' }, cookie);
    const { sku } = await json(
      await call('POST', 'skus', skuBody({ inputs: { ...fsanz, kj_per_100ml: null } }), cookie),
    );
    const blocked = await call('POST', `skus/${sku.id}/exports`, {}, cookie);
    expect(blocked.status).toBe(422);
    expect((await json(blocked)).findings.map((f: { code: string }) => f.code)).toContain(
      'KJ_MISSING',
    );

    const unstored = await call('POST', `skus/${sku.id}/exports`, {}, cookie, {
      ...env,
      EXPORTS: undefined,
    } as Env);
    expect(unstored.status).toBe(503);

    // A designer exporting for a client: the SKU's producer names the files, not the account.
    await call('PUT', `skus/${sku.id}`, skuBody({ producer: 'Château Lune' }), cookie);
    const done = await call('POST', `skus/${sku.id}/exports`, {}, cookie);
    expect(done.status).toBe(201);
    expect((await json(done)).export.files[0].fileName).toBe(
      '20260930-chateau-lune-reserve-tawny-energy-panel-50mm-preview.svg',
    );
    const me = await json(await call('GET', 'auth/me', undefined, cookie));
    expect(me.account.freeExportAvailable).toBe(false);
  });
});
