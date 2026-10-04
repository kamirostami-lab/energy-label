import { describe, expect, it } from 'vitest';
import { FREE_EXPORT_COOKIE, createApi, generatorConfig, resolveIssueDate } from '../src/index.ts';
import { loadFsanzEnergyStatementRules } from '@energy-panel/rules';

const rules = loadFsanzEnergyStatementRules();
const fsanz = { abv: 21.1, package_ml: 720, serving_ml: 60, kj_per_100ml: 592 };
const details = { producer: 'Komms-Haus', sku: 'FSANZ example', issuedOn: '2026-09-30' };

function setup() {
  const events: Array<Record<string, unknown>> = [];
  const app = createApi({
    rules,
    now: () => new Date('2026-09-30T02:00:00Z'),
    log: (event) => events.push(event),
    newId: () => 'export-1',
  });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(`http://energy.test/api/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://energy.test', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { app, events, post };
}

const decode = (base64: string) => Buffer.from(base64, 'base64');
// Response bodies are checked field by field below.
const json = (res: Response): Promise<any> => res.json();

describe('POST /api/preview', () => {
  it('returns the statement and a watermarked PNG, never the vector artwork', async () => {
    const { post } = setup();
    const res = await post('preview', { inputs: fsanz, options: { width_mm: 50 }, pxPerMm: 8 });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await json(res);
    expect(body.statement.exportable).toBe(true);
    expect(body.statement).not.toHaveProperty('svg');
    expect(JSON.stringify(body)).not.toContain('<svg');
    expect(body.statement.values.display.energyPerServingKj).toBe('355');
    expect(body.statement.description).toContain('Energy, Average quantity per serving: 355 kJ.');
    expect(body.preview).toMatchObject({ widthPx: 400, pxPerMm: 8, widthMm: 50 });
    expect(decode(body.preview.png).subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(body.freeExport).toEqual({ available: true });
  });

  it('previews a blocked statement when it can be laid out, and explains the block', async () => {
    const { post } = setup();
    const low = await json(
      await post('preview', { inputs: { ...fsanz, abv: 0.3 }, options: { width_mm: 50 } }),
    );
    expect(low.statement.exportable).toBe(false);
    expect(low.statement.warnings.map((w: { code: string }) => w.code)).toContain(
      'STANDARDISED_BEVERAGE_UNCONFIRMED',
    );
    expect(low.preview).not.toBeNull();

    const missing = await json(
      await post('preview', {
        inputs: { ...fsanz, kj_per_100ml: null, abv: null },
        options: { width_mm: 50 },
      }),
    );
    expect(missing.preview).toBeNull();
    expect(missing.statement.warnings.map((w: { code: string }) => w.code)).toEqual(
      expect.arrayContaining(['KJ_MISSING', 'INPUT_INVALID']),
    );
  });

  it('rejects malformed, cross-site and oversized requests', async () => {
    const { post } = setup();
    expect((await post('preview', '{not json')).status).toBe(400);
    const shape = await post('preview', { inputs: { ...fsanz, abv: '21' }, options: {} });
    expect(shape.status).toBe(400);
    expect((await json(shape)).message).toContain('inputs.abv');
    expect((await post('preview', { inputs: fsanz, options: {}, extra: 1 })).status).toBe(400);
    expect(
      (await post('preview', { inputs: fsanz, options: {} }, { 'content-type': 'text/plain' }))
        .status,
    ).toBe(415);
    expect(
      (await post('preview', { inputs: fsanz, options: {} }, { origin: 'https://evil.test' }))
        .status,
    ).toBe(403);
    expect(
      (await post('preview', { inputs: fsanz, options: { package_word: 'x'.repeat(20_000) } }))
        .status,
    ).toBe(413);
  });
});

describe('POST /api/export (free preview export, decision D3)', () => {
  it('returns a watermarked PNG and proof, never vector artwork, and marks the browser', async () => {
    const { post, events } = setup();
    const res = await post('export', { inputs: fsanz, options: { width_mm: 50 }, details });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.exportId).toBe('export-1');
    expect(body.files.map((f: { fileName: string; mediaType: string }) => f.mediaType)).toEqual([
      'image/png',
      'application/pdf',
    ]);
    expect(body.files.map((f: { fileName: string }) => f.fileName)).toEqual([
      '20260930-komms-haus-fsanz-example-energy-panel-50mm-preview.png',
      '20260930-komms-haus-fsanz-example-energy-panel-50mm-proof-preview.pdf',
    ]);
    const [png, proof] = body.files.map((f: { base64: string }) => decode(f.base64));
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    // The proof's panels are images: no vector panel to lift the mark off.
    expect(proof.toString('latin1').match(/\/Subtype \/Image/g)).toHaveLength(2);
    expect(proof.length).toBe(body.files[1].size);

    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`${FREE_EXPORT_COOKIE}=2026-09-30`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    // Logs name the event and the export id, never an input value.
    expect(events).toEqual([{ event: 'free_preview_export', exportId: 'export-1', files: 2 }]);
  });

  it('limits free exports per IP address, whatever the cookie says', async () => {
    const { app } = setup();
    const keys: string[] = [];
    const limiter = {
      limit: async ({ key }: { key: string }) => {
        keys.push(key);
        return { success: keys.length <= 1 };
      },
    };
    const send = (host: string) =>
      app.request(
        `http://${host}/api/export`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: `http://${host}`,
            'cf-connecting-ip': '203.0.113.7',
          },
          body: JSON.stringify({ inputs: fsanz, options: { width_mm: 50 }, details }),
        },
        { FREE_EXPORT_LIMIT: limiter },
      );
    expect((await send('energy.test')).status).toBe(200);
    const refused = await send('energy.test');
    expect(refused.status).toBe(429);
    expect((await json(refused)).error).toBe('rate_limited');
    expect(keys).toEqual(['203.0.113.7', '203.0.113.7']);
    // Local development and the browser tests are not limited.
    expect((await send('127.0.0.1:8787')).status).toBe(200);
    expect(keys).toHaveLength(2);
  });

  it('allows one free export per browser', async () => {
    const { post } = setup();
    const res = await post(
      'export',
      { inputs: fsanz, options: { width_mm: 50 }, details },
      { cookie: `${FREE_EXPORT_COOKIE}=2026-09-01` },
    );
    expect(res.status).toBe(403);
    expect((await json(res)).error).toBe('free_export_used');
    const preview = await post(
      'preview',
      { inputs: fsanz, options: { width_mm: 50 } },
      { cookie: `${FREE_EXPORT_COOKIE}=2026-09-01` },
    );
    expect((await json(preview)).freeExport).toEqual({ available: false });
  });

  it('refuses blocked statements and missing names without using the free export', async () => {
    const { post } = setup();
    const blocked = await post('export', {
      inputs: { ...fsanz, kj_per_100ml: null },
      options: { width_mm: 50 },
      details,
    });
    expect(blocked.status).toBe(422);
    const body = await json(blocked);
    expect(body.error).toBe('blocked');
    expect(body.findings.map((f: { code: string }) => f.code)).toContain('KJ_MISSING');
    expect(blocked.headers.get('set-cookie')).toBeNull();

    const unnamed = await post('export', {
      inputs: fsanz,
      options: { width_mm: 50 },
      details: { ...details, producer: '  ' },
    });
    expect(unnamed.status).toBe(422);
    expect(await json(unnamed)).toMatchObject({ error: 'invalid_details', field: 'producer' });

    const unsettable = await post('export', {
      inputs: fsanz,
      options: { width_mm: 50 },
      details: { ...details, producer: '酒造' },
    });
    expect(unsettable.status).toBe(422);
    expect((await json(unsettable)).error).toBe('invalid_details');
  });
});

describe('helpers', () => {
  it("uses the visitor's date within a day of the server's, otherwise the server's", () => {
    const now = new Date('2026-09-30T23:30:00Z');
    expect(resolveIssueDate('2026-10-01', now)).toBe('2026-10-01');
    expect(resolveIssueDate('2026-09-29', now)).toBe('2026-09-29');
    expect(resolveIssueDate('2026-10-05', now)).toBe('2026-09-30');
    expect(resolveIssueDate('2026-02-30', now)).toBe('2026-09-30');
    expect(resolveIssueDate(undefined, now)).toBe('2026-09-30');
  });

  it('gives the generator the rules it needs', () => {
    const config = generatorConfig(rules);
    expect(config.rulesVersion).toBe(rules.version);
    expect(config.minAbvPercent).toBe(0.5);
    expect(config.packageWords.default).toBe('package');
    expect(config.calculatorUrl).toMatch(/^https:\/\/www\.foodstandards\.gov\.au\//);
    expect(config.beverageTypes.map((t) => t.id)).toContain('wine');
  });

  it('answers unknown routes with JSON', async () => {
    const { app } = setup();
    const res = await app.request('http://energy.test/api/nope');
    expect(res.status).toBe(404);
    expect(await json(res)).toMatchObject({ error: 'not_found' });
  });
});
