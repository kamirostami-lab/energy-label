// POST /api/preview: statement values, findings and a watermarked PNG of the panel. The preview
//   is pixels, never vector artwork, so the page cannot be copied as print-ready art (D8).
// POST /api/export: the free preview export for visitors without an account (D3): one per
//   browser, watermarked, marked by an HttpOnly cookie.
import {
  ExportBlockedError,
  ProofInputError,
  describePanel,
  planStatement,
  renderPreviewPng,
  type StatementInputs,
  type StatementOptions,
} from '@energy-panel/panel';
import type { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { AppEnv, Deps } from '../context.ts';
import { base64 } from '../crypto.ts';
import { renderExportFiles } from '../export-files.ts';
import { noStore, problem, readBody, resolveIssueDate } from '../http.ts';
import { exportRequestSchema, previewRequestSchema } from '../schema.ts';

/** Marks that this browser has used its free preview export. */
export const FREE_EXPORT_COOKIE = 'ep_free_export';
const YEAR_SECONDS = 365 * 24 * 60 * 60;
/** Density used when the screen does not say: about 2× a 96 dpi screen. */
const DEFAULT_PX_PER_MM = 7.56;
export const NAME_MAX_LENGTH = 80;

/** A problem with a name field, or null when it is usable. */
export function nameProblem(value: string, label: string) {
  if (value === '') return `Enter the ${label} name.`;
  if (value.length > NAME_MAX_LENGTH)
    return `Keep the ${label} name to ${NAME_MAX_LENGTH} characters.`;
  return null;
}

export function registerStatementRoutes(app: Hono<AppEnv>, deps: Deps) {
  const { rules } = deps;

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
      noStore,
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
      const message = nameProblem(value, label);
      if (message) {
        return problem(c, { status: 422, error: 'invalid_details', message }, { field });
      }
    }

    const issuedOn = resolveIssueDate(details.issuedOn, deps.now());
    const exportId = deps.newId();
    try {
      const files = await renderExportFiles(
        inputs as StatementInputs,
        options as StatementOptions,
        { producer, sku, ...(vintageOrBatch ? { vintageOrBatch } : {}) },
        issuedOn,
        true,
        rules,
      );
      setCookie(c, FREE_EXPORT_COOKIE, issuedOn, {
        path: '/',
        maxAge: YEAR_SECONDS,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
      });
      deps.log({ event: 'free_preview_export', exportId, files: files.length });
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
        noStore,
      );
    } catch (error) {
      const refused = exportProblem(error);
      if (refused) return problem(c, refused.problem, refused.extra);
      throw error;
    }
  });
}

/** Turns the renderer's refusals into answers; anything else is a server error. */
export function exportProblem(error: unknown) {
  if (error instanceof ExportBlockedError) {
    return {
      problem: {
        status: 422,
        error: 'blocked',
        message: 'The statement cannot be exported yet. Resolve the items marked as blocking.',
      } as const,
      extra: { findings: error.findings },
    };
  }
  if (error instanceof ProofInputError || error instanceof RangeError) {
    return {
      problem: { status: 422, error: 'invalid_details', message: error.message } as const,
      extra: {},
    };
  }
  return null;
}
