// Energy Panel API (Hono). For now it runs inside the web app's Worker under /api: one deployment,
// one origin. Routes:
//   POST /api/preview  statement values, findings and a watermarked PNG of the panel
//   POST /api/export   the free preview export (decision D3): one per visitor, watermarked
// The preview is pixels, never vector artwork, so the page cannot be copied as print-ready art.
// Logs carry event names and the export id only, never input values (Build Brief 01 section 11).
import {
  ExportBlockedError,
  ProofInputError,
  buildProofSheet,
  describePanel,
  exportArtwork,
  planStatement,
  renderPreviewPng,
  type ArtworkFormat,
  type ExportedFile,
  type StatementInputs,
  type StatementOptions,
} from '@energy-panel/panel';
import { loadFsanzEnergyStatementRules, type EnergyStatementRules } from '@energy-panel/rules';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie } from 'hono/cookie';
import type { z } from 'zod';
import { exportRequestSchema, previewRequestSchema } from './schema.ts';

export { generatorConfig, type GeneratorConfig } from './config.ts';

/** Marks that this browser has used its free preview export. */
export const FREE_EXPORT_COOKIE = 'ep_free_export';
const YEAR_SECONDS = 365 * 24 * 60 * 60;
/** Density used when the screen does not say: about 2× a 96 dpi screen. */
const DEFAULT_PX_PER_MM = 7.56;
const NAME_MAX_LENGTH = 80;

export interface ApiDependencies {
  rules?: EnergyStatementRules;
  now?: () => Date;
  log?: (event: Record<string, string | number | boolean>) => void;
  newId?: () => string;
}

const json = { 'Cache-Control': 'no-store' } as const;

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x2000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x2000));
  }
  return btoa(binary);
}

/** The visitor's date when it is within a day of the server's (time zones), else the server's. */
export function resolveIssueDate(requested: string | undefined, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  if (requested === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(requested)) return today;
  const day = Date.parse(`${requested}T00:00:00Z`);
  if (Number.isNaN(day) || new Date(day).toISOString().slice(0, 10) !== requested) return today;
  return Math.abs(day - Date.parse(`${today}T00:00:00Z`)) <= 86_400_000 ? requested : today;
}

type Problem = { status: 400 | 403 | 413 | 415 | 422; error: string; message: string };

const problem = (c: Context, p: Problem, extra: Record<string, unknown> = {}) =>
  c.json({ error: p.error, message: p.message, ...extra }, p.status, json);

/** Parses a JSON body against a schema; the error names what was wrong without echoing values. */
async function readBody<T extends z.ZodType>(
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

/** Rejects cross-site requests: a browser sends Origin with every POST. */
function crossSite(c: Context): boolean {
  const origin = c.req.header('origin');
  if (origin === undefined) return false;
  try {
    return new URL(origin).host !== new URL(c.req.url).host;
  } catch {
    return true;
  }
}

export function createApi(deps: ApiDependencies = {}) {
  const rules = deps.rules ?? loadFsanzEnergyStatementRules();
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? ((event) => console.log(JSON.stringify(event)));
  const newId = deps.newId ?? (() => crypto.randomUUID());

  const app = new Hono().basePath('/api');

  app.use(
    '*',
    bodyLimit({
      maxSize: 16 * 1024,
      onError: (c) =>
        problem(c, { status: 413, error: 'too_large', message: 'The request is too large.' }),
    }),
  );
  app.use('*', async (c, next) => {
    if (c.req.method !== 'GET' && crossSite(c)) {
      return problem(c, { status: 403, error: 'cross_site', message: 'Cross-site request.' });
    }
    await next();
  });

  app.post('/preview', async (c) => {
    const read = await readBody(c, previewRequestSchema);
    if (!read.ok) return problem(c, read.problem);
    const { inputs, options, pxPerMm } = read.body;
    const plan = planStatement(inputs as StatementInputs, options as StatementOptions, rules);
    const { svg: _vector, ...statement } = plan.result; // the artwork itself never leaves here
    const preview =
      plan.layout && plan.result.options
        ? renderPreviewPng(plan.layout, plan.result.options.colour, pxPerMm ?? DEFAULT_PX_PER_MM)
        : null;
    return c.json(
      {
        statement: {
          ...statement,
          description: plan.content ? describePanel(plan.content) : null,
        },
        preview: preview && {
          png: base64(preview.png),
          widthPx: preview.widthPx,
          heightPx: preview.heightPx,
          pxPerMm: preview.pxPerMm,
          widthMm: plan.layout!.width,
          heightMm: plan.layout!.height,
        },
        freeExport: { available: getCookie(c, FREE_EXPORT_COOKIE) === undefined },
      },
      200,
      json,
    );
  });

  app.post('/export', async (c) => {
    if (getCookie(c, FREE_EXPORT_COOKIE) !== undefined) {
      return problem(c, {
        status: 403,
        error: 'free_export_used',
        message:
          'This browser has used its free preview export. Paid exports open when checkout is available.',
      });
    }
    const read = await readBody(c, exportRequestSchema);
    if (!read.ok) return problem(c, read.problem);
    const { inputs, options, details } = read.body;
    const producer = details.producer.trim();
    const sku = details.sku.trim();
    const vintageOrBatch = details.vintageOrBatch?.trim() || undefined;
    for (const [field, value, label] of [
      ['producer', producer, 'producer'],
      ['sku', sku, 'product'],
    ] as const) {
      if (value === '' || value.length > NAME_MAX_LENGTH) {
        return problem(
          c,
          {
            status: 422,
            error: 'invalid_details',
            message:
              value === ''
                ? `Enter the ${label} name.`
                : `Keep the ${label} name to ${NAME_MAX_LENGTH} characters.`,
          },
          { field },
        );
      }
    }

    const issuedOn = resolveIssueDate(details.issuedOn, now());
    const exportId = newId();
    const statementInputs = inputs as StatementInputs;
    const statementOptions = options as StatementOptions;
    const request = { issuedOn, org: producer, sku, watermark: true };
    try {
      const files: ExportedFile[] = [];
      for (const format of ['svg', 'pdf', 'pdf14'] as ArtworkFormat[]) {
        files.push(
          await exportArtwork(statementInputs, statementOptions, rules, { format, ...request }),
        );
      }
      files.push(
        await buildProofSheet(
          statementInputs,
          statementOptions,
          rules,
          { producer, sku, issuedOn, ...(vintageOrBatch ? { vintageOrBatch } : {}) },
          { watermark: true },
        ),
      );
      setCookie(c, FREE_EXPORT_COOKIE, issuedOn, {
        path: '/',
        maxAge: YEAR_SECONDS,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      });
      log({ event: 'free_preview_export', exportId, files: files.length });
      return c.json(
        {
          exportId,
          issuedOn,
          rulesVersion: rules.version,
          files: files.map((f) => ({
            fileName: f.fileName,
            mediaType: f.mediaType,
            size: f.bytes.length,
            base64: base64(f.bytes),
          })),
        },
        200,
        json,
      );
    } catch (error) {
      if (error instanceof ExportBlockedError) {
        return problem(
          c,
          {
            status: 422,
            error: 'blocked',
            message: 'The statement cannot be exported yet. Resolve the items marked as blocking.',
          },
          { findings: error.findings },
        );
      }
      if (error instanceof ProofInputError || error instanceof RangeError) {
        return problem(c, { status: 422, error: 'invalid_details', message: error.message });
      }
      throw error;
    }
  });

  app.notFound((c) => c.json({ error: 'not_found', message: 'Not found.' }, 404, json));
  app.onError((error, c) => {
    // The error name only: messages can quote input values.
    log({ event: 'api_error', name: error.name });
    return c.json({ error: 'internal', message: 'Something went wrong. Try again.' }, 500, json);
  });

  return app;
}

export type Api = ReturnType<typeof createApi>;
