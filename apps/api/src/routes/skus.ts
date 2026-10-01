// SKU records and the exports issued from them (Build Brief 01 sections 3, 6 and 8).
//   GET  /api/skus                   the account's SKUs with their last export
//   POST /api/skus                   save a SKU (inputs and panel options, complete or not)
//   GET  /api/skus.csv               the same list as CSV
//   GET  /api/exports.csv            every export with its inputs, rules version and output hash
//   GET  /api/skus/:id               one SKU with its exports
//   PUT  /api/skus/:id               update it
//   POST /api/skus/:id/exports       export it: files to R2, a record with the output hash
//   GET  /api/exports/:id/files/:kind  download one file (svg, pdf, pdf14, proof)
// An export is a watermarked preview (one free per account, decision D3) or print-ready, paid
// for by the account's plan or by one bought export (session 5).
import { planStatement, slug, ExportBlockedError } from '@energy-panel/panel';
import type { StatementInputs, StatementOptions } from '@energy-panel/panel';
import { BEVERAGE_TYPES } from '@energy-panel/panel/settings';
import type { Hono } from 'hono';
import {
  subscriptionExporting,
  subscriptionLapsed,
  syncSubscription,
} from '../billing/entitlements.ts';
import { currentAccount, type AppContext, type AppEnv, type Deps } from '../context.ts';
import { sha256Hex } from '../crypto.ts';
import {
  FILE_KINDS,
  outputHash,
  renderExportFiles,
  type ExportDetails,
  type FileKind,
} from '../export-files.ts';
import { noStore, problem, readBody, resolveIssueDate } from '../http.ts';
import { accountExportSchema, skuBodySchema, type SkuBody } from '../schema.ts';
import {
  accountById,
  addExportCredit,
  claimFreeExport,
  exportById,
  exportsForAccount,
  exportsForSku,
  insertExport,
  insertSku,
  recordRulesVersion,
  releaseFreeExport,
  skuById,
  skusForAccount,
  updateSku,
  useExportCredit,
  type AccountRow,
  type ExportRow,
  type SkuRow,
  type SkuValues,
} from '../store.ts';
import { stripeFor } from './billing.ts';
import { exportProblem, nameProblem } from './statement.ts';

const VINTAGE_MAX_LENGTH = 40;
const KEY_COLUMN: Record<FileKind, keyof ExportRow> = {
  svg: 'svg_key',
  pdf: 'pdf_key',
  pdf14: 'pdf14_key',
  proof: 'proof_key',
};

const flag = (value: boolean | null | undefined) =>
  value === true ? 1 : value === false ? 0 : null;
const unflag = (value: number | null) => (value === null ? null : value === 1);

function skuInputs(row: SkuRow): StatementInputs {
  return {
    abv: row.abv,
    package_ml: row.package_ml,
    serving_ml: row.serving_ml,
    servings: row.servings,
    kj_per_100ml: row.kj_per_100ml,
    cal_per_100ml: row.cal_per_100ml,
    package_surface_area_cm2: row.package_surface_area_cm2,
    nip_displayed: unflag(row.nip_displayed),
    standardised_beverage: unflag(row.standardised_beverage),
  } as unknown as StatementInputs;
}

function skuJson(row: SkuRow) {
  return {
    id: row.id,
    name: row.name,
    producer: row.producer,
    beverageType: row.beverage_type,
    vintageOrBatch: row.vintage_or_batch,
    inputs: skuInputs(row),
    options: JSON.parse(row.options_json) as StatementOptions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function exportJson(row: ExportRow) {
  return {
    id: row.id,
    skuId: row.sku_id,
    createdAt: row.created_at,
    issuedOn: row.issued_on,
    rulesVersion: row.rules_version,
    watermarked: row.watermarked === 1,
    entitlement: row.entitlement,
    outputHash: row.output_hash,
    files: FILE_KINDS.map((kind) => ({
      kind,
      fileName: String(row[KEY_COLUMN[kind]]).split('/').pop(),
      url: `/api/exports/${row.id}/files/${kind}`,
    })),
  };
}

/** Checks a SKU body; returns the values to store or the problem to answer with. */
function skuValues(body: SkuBody): { values: SkuValues } | { message: string; field: string } {
  const name = body.name.trim();
  const nameIssue = nameProblem(name, 'product');
  if (nameIssue) return { message: nameIssue, field: 'name' };
  const producer = body.producer?.trim() || null;
  const producerIssue = producer && nameProblem(producer, 'producer');
  if (producerIssue) return { message: producerIssue, field: 'producer' };
  const vintage = body.vintageOrBatch?.trim() || null;
  if (vintage && vintage.length > VINTAGE_MAX_LENGTH) {
    return {
      message: `Keep the vintage or batch to ${VINTAGE_MAX_LENGTH} characters.`,
      field: 'vintageOrBatch',
    };
  }
  const beverage = body.beverageType ?? null;
  if (beverage !== null && !BEVERAGE_TYPES.some((t) => t.id === beverage)) {
    return { message: 'Choose one of the beverage types.', field: 'beverageType' };
  }
  const { inputs, options } = body;
  return {
    values: {
      name,
      producer,
      beverage_type: beverage,
      vintage_or_batch: vintage,
      abv: inputs.abv ?? null,
      package_ml: inputs.package_ml ?? null,
      serving_ml: inputs.serving_ml ?? null,
      servings: inputs.servings ?? null,
      kj_per_100ml: inputs.kj_per_100ml ?? null,
      cal_per_100ml: inputs.cal_per_100ml ?? null,
      package_surface_area_cm2: inputs.package_surface_area_cm2 ?? null,
      nip_displayed: flag(inputs.nip_displayed),
      standardised_beverage: flag(inputs.standardised_beverage),
      package_word: options.package_word ?? null,
      options_json: JSON.stringify(options),
    },
  };
}

/** One CSV cell. Text that a spreadsheet would read as a formula is prefixed with an apostrophe. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function registerSkuRoutes(app: Hono<AppEnv>, deps: Deps) {
  const { rules } = deps;
  const at = () => deps.now().toISOString();
  let rulesSha: Promise<string> | undefined;

  /** The account after asking Stripe about its subscription; unchanged when Stripe cannot say. */
  async function refreshSubscription(c: AppContext, account: AccountRow): Promise<AccountRow> {
    const stripe = stripeFor(c, deps);
    const db = c.env?.DB;
    if (!stripe || !db || !account.subscription_id) return account;
    try {
      await syncSubscription(await stripe.retrieveSubscription(account.subscription_id), {
        db,
        log: deps.log,
      });
      return (await accountById(db, account.id)) ?? account;
    } catch (error) {
      deps.log({ event: 'subscription_refresh_failed', name: (error as Error).name });
      return account;
    }
  }

  /** The signed-in account and database, or the problem to answer with. */
  async function signedIn(c: AppContext) {
    const account = await currentAccount(c, deps);
    const db = c.env?.DB;
    if (!account || !db) {
      return {
        refused: problem(c, {
          status: 401,
          error: 'signed_out',
          message: 'Sign in to use SKU records.',
        }),
      } as const;
    }
    return { account, db } as const;
  }

  app.get('/skus', async (c) => {
    const s = await signedIn(c);
    if ('refused' in s) return s.refused;
    const rows = await skusForAccount(s.db, s.account.id);
    return c.json(
      {
        skus: rows.map((row) => ({
          ...skuJson(row),
          exportCount: row.export_count,
          lastExport: row.last_export_at
            ? { createdAt: row.last_export_at, rulesVersion: row.last_rules_version }
            : null,
        })),
      },
      200,
      noStore,
    );
  });

  /** A CSV download named for the account: YYYYMMDD-<organisation>-energy-panel-<what>.csv. */
  function csvDownload(
    c: AppContext,
    account: AccountRow,
    what: string,
    columns: readonly string[],
    rows: Array<Record<string, unknown>>,
  ) {
    const lines = rows.map((row) => columns.map((column) => csvCell(row[column])).join(','));
    const org = account.org_name ? slug(account.org_name) : 'account';
    const fileName = `${at().slice(0, 10).replace(/-/g, '')}-${org}-energy-panel-${what}.csv`;
    return c.body(`${[columns.join(','), ...lines].join('\r\n')}\r\n`, 200, {
      ...noStore,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
  }

  app.get('/skus.csv', async (c) => {
    const s = await signedIn(c);
    if ('refused' in s) return s.refused;
    const rows = await skusForAccount(s.db, s.account.id);
    return csvDownload(
      c,
      s.account,
      'skus',
      [
        'sku_id',
        'name',
        'producer',
        'beverage_type',
        'vintage_or_batch',
        'abv',
        'package_ml',
        'serving_ml',
        'servings',
        'kj_per_100ml',
        'cal_per_100ml',
        'package_word',
        'width_mm',
        'colour',
        'energy_units',
        'exports',
        'last_export_at',
        'last_export_rules_version',
        'last_export_output_hash',
        'updated_at',
      ],
      rows.map((row) => {
        const options = JSON.parse(row.options_json) as StatementOptions;
        return {
          ...row,
          sku_id: row.id,
          width_mm: options.width_mm,
          colour: options.colour,
          energy_units: options.energy_units,
          exports: row.export_count,
          last_export_rules_version: row.last_rules_version,
          last_export_output_hash: row.last_output_hash,
        };
      }),
    );
  });

  // The export record (Build Brief 01 section 3): every export with the inputs, names and
  // options it was issued with, its rules version and output hash, newest first.
  app.get('/exports.csv', async (c) => {
    const s = await signedIn(c);
    if ('refused' in s) return s.refused;
    const rows = await exportsForAccount(s.db, s.account.id);
    return csvDownload(
      c,
      s.account,
      'exports',
      [
        'export_id',
        'sku_id',
        'issued_on',
        'created_at',
        'rules_version',
        'watermarked',
        'entitlement',
        'producer',
        'product',
        'vintage_or_batch',
        'abv',
        'package_ml',
        'serving_ml',
        'servings',
        'kj_per_100ml',
        'cal_per_100ml',
        'package_surface_area_cm2',
        'nip_displayed',
        'standardised_beverage',
        'width_mm',
        'colour',
        'energy_units',
        'package_word',
        'output_hash',
      ],
      rows.map((row) => {
        const details = JSON.parse(row.details_json) as ExportDetails;
        return {
          ...(JSON.parse(row.inputs_json) as Record<string, unknown>),
          ...(JSON.parse(row.options_json) as Record<string, unknown>),
          export_id: row.id,
          sku_id: row.sku_id,
          issued_on: row.issued_on,
          created_at: row.created_at,
          rules_version: row.rules_version,
          watermarked: row.watermarked === 1,
          entitlement: row.entitlement,
          producer: details.producer,
          product: details.sku,
          vintage_or_batch: details.vintageOrBatch,
          output_hash: row.output_hash,
        };
      }),
    );
  });

  app.post('/skus', async (c) => {
    const s = await signedIn(c);
    if ('refused' in s) return s.refused;
    const read = await readBody(c, skuBodySchema);
    if (!read.ok) return problem(c, read.problem);
    const checked = skuValues(read.body);
    if ('message' in checked) {
      return problem(
        c,
        { status: 422, error: 'invalid_sku', message: checked.message },
        { field: checked.field },
      );
    }
    const id = deps.newId();
    await insertSku(s.db, id, s.account.id, checked.values, at());
    const row = await skuById(s.db, s.account.id, id);
    return c.json({ sku: skuJson(row!) }, 201, noStore);
  });

  app.get('/skus/:id', async (c) => {
    const s = await signedIn(c);
    if ('refused' in s) return s.refused;
    const row = await skuById(s.db, s.account.id, c.req.param('id'));
    if (!row) return problem(c, { status: 404, error: 'not_found', message: 'No such SKU.' });
    const exports = await exportsForSku(s.db, s.account.id, row.id);
    return c.json({ sku: skuJson(row), exports: exports.map(exportJson) }, 200, noStore);
  });

  app.put('/skus/:id', async (c) => {
    const s = await signedIn(c);
    if ('refused' in s) return s.refused;
    const read = await readBody(c, skuBodySchema);
    if (!read.ok) return problem(c, read.problem);
    const checked = skuValues(read.body);
    if ('message' in checked) {
      return problem(
        c,
        { status: 422, error: 'invalid_sku', message: checked.message },
        { field: checked.field },
      );
    }
    const id = c.req.param('id');
    if (!(await updateSku(s.db, id, s.account.id, checked.values, at()))) {
      return problem(c, { status: 404, error: 'not_found', message: 'No such SKU.' });
    }
    const row = await skuById(s.db, s.account.id, id);
    return c.json({ sku: skuJson(row!) }, 200, noStore);
  });

  app.post('/skus/:id/exports', async (c) => {
    const s = await signedIn(c);
    if ('refused' in s) return s.refused;
    const read = await readBody(c, accountExportSchema);
    if (!read.ok) return problem(c, read.problem);
    const sku = await skuById(s.db, s.account.id, c.req.param('id'));
    if (!sku) return problem(c, { status: 404, error: 'not_found', message: 'No such SKU.' });
    // The SKU's producer, or the account's organisation for SKUs saved without one.
    const producer = sku.producer?.trim() || s.account.org_name?.trim() || '';
    if (!producer) {
      return problem(
        c,
        {
          status: 422,
          error: 'producer_required',
          message: 'Enter the producer name: it names the files and appears on the proof sheet.',
        },
        { field: 'producer' },
      );
    }
    const bucket = c.env?.EXPORTS;
    if (!bucket) {
      return problem(c, {
        status: 503,
        error: 'storage_unavailable',
        message: 'File storage is not set up yet.',
      });
    }
    // What pays for it: the free preview (D3), the account's plan, or one bought export.
    const edition = read.body.edition ?? 'preview';
    let entitlement: ExportRow['entitlement'];
    if (edition === 'preview') {
      if (!(await claimFreeExport(s.db, s.account.id, at()))) {
        return problem(c, {
          status: 403,
          error: 'free_export_used',
          message:
            'This account has used its free preview export. Buy an export or a plan for print-ready files.',
        });
      }
      entitlement = 'free';
    } else {
      let account = s.account;
      // A plan whose period ran out without news from Stripe: ask Stripe before refusing.
      if (subscriptionLapsed(account, deps.now())) account = await refreshSubscription(c, account);
      if (subscriptionExporting(account, deps.now())) {
        entitlement = 'subscription';
      } else if (await useExportCredit(s.db, account.id)) {
        entitlement = 'credit';
      } else {
        return problem(c, {
          status: 402,
          error: 'payment_required',
          message: 'Buy this export, or a plan, to export print-ready files.',
        });
      }
    }
    const handBack = () =>
      entitlement === 'free'
        ? releaseFreeExport(s.db, s.account.id)
        : entitlement === 'credit'
          ? addExportCredit(s.db, s.account.id)
          : Promise.resolve();

    try {
      const inputs = skuInputs(sku);
      const plan = planStatement(inputs, JSON.parse(sku.options_json) as StatementOptions, rules);
      if (!plan.result.exportable || !plan.result.options) {
        throw new ExportBlockedError(plan.result.warnings.filter((w) => w.severity === 'block'));
      }
      const options = plan.result.options;
      const details: ExportDetails = {
        producer,
        sku: sku.name,
        ...(sku.vintage_or_batch ? { vintageOrBatch: sku.vintage_or_batch } : {}),
      };
      const issuedOn = resolveIssueDate(read.body.issuedOn, deps.now());
      const watermark = edition === 'preview';
      const files = await renderExportFiles(inputs, options, details, issuedOn, watermark, rules);
      const exportId = deps.newId();
      const key = (fileName: string) => `exports/${s.account.id}/${exportId}/${fileName}`;
      for (const file of files) {
        await bucket.put(key(file.fileName), file.bytes, {
          httpMetadata: { contentType: file.mediaType },
          customMetadata: { exportId, kind: file.kind },
        });
      }
      const byKind = Object.fromEntries(files.map((f) => [f.kind, key(f.fileName)])) as Record<
        FileKind,
        string
      >;
      const row: ExportRow = {
        id: exportId,
        sku_id: sku.id,
        account_id: s.account.id,
        rules_version: rules.version,
        inputs_json: JSON.stringify(inputs),
        options_json: JSON.stringify(options),
        details_json: JSON.stringify(details),
        issued_on: issuedOn,
        watermarked: watermark ? 1 : 0,
        svg_key: byKind.svg,
        pdf_key: byKind.pdf,
        pdf14_key: byKind.pdf14,
        proof_key: byKind.proof,
        output_hash: await outputHash(files),
        created_at: at(),
        entitlement,
      };
      await insertExport(s.db, row);
      rulesSha ??= sha256Hex(JSON.stringify(rules.file));
      await recordRulesVersion(s.db, rules.version, await rulesSha, at());
      deps.log({ event: 'account_export', exportId, files: files.length, edition, entitlement });
      return c.json({ export: exportJson(row) }, 201, noStore);
    } catch (error) {
      await handBack();
      const refused = exportProblem(error);
      if (refused) return problem(c, refused.problem, refused.extra);
      throw error;
    }
  });

  app.get('/exports/:id/files/:kind', async (c) => {
    const s = await signedIn(c);
    if ('refused' in s) return s.refused;
    const kind = c.req.param('kind') as FileKind;
    const row = await exportById(s.db, s.account.id, c.req.param('id'));
    const bucket = c.env?.EXPORTS;
    if (!row || !FILE_KINDS.includes(kind) || !bucket) {
      return problem(c, { status: 404, error: 'not_found', message: 'No such file.' });
    }
    const key = String(row[KEY_COLUMN[kind]]);
    const object = await bucket.get(key);
    if (!object) return problem(c, { status: 404, error: 'not_found', message: 'No such file.' });
    return new Response(object.body as unknown as ReadableStream, {
      headers: {
        'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${key.split('/').pop()}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
}
