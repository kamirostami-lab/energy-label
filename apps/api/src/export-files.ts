// The files of one export, their combined hash, and replay: re-rendering a stored export record
// must reproduce its output hash (Build Brief 01 section 9, reproducibility).
import {
  buildProofSheet,
  exportArtwork,
  exportPreviewImage,
  type ArtworkFormat,
  type ExportedFile,
  type StatementInputs,
  type StatementOptions,
} from '@energy-panel/panel';
import type { EnergyStatementRules } from '@energy-panel/rules';
import { sha256Hex } from './crypto.ts';

export interface ExportDetails {
  producer: string;
  sku: string;
  vintageOrBatch?: string;
}

export type FileKind = 'svg' | 'pdf' | 'pdf14' | 'png' | 'proof';
export const FILE_KINDS: readonly FileKind[] = ['svg', 'pdf', 'pdf14', 'png', 'proof'];

export interface ExportFile extends ExportedFile {
  kind: FileKind;
}

/**
 * Print-ready: SVG, PDF (X-4 rules), PDF 1.4 and the A4 proof, in that order. A watermarked
 * preview (decision D3) is pixels only: the panel as a PNG and the proof with image panels, so
 * there is no vector artwork to delete the PREVIEW mark from.
 */
export async function renderExportFiles(
  inputs: StatementInputs,
  options: StatementOptions,
  details: ExportDetails,
  issuedOn: string,
  watermark: boolean,
  rules: EnergyStatementRules,
): Promise<ExportFile[]> {
  const request = { issuedOn, org: details.producer, sku: details.sku };
  const files: ExportFile[] = [];
  if (watermark) {
    files.push({ kind: 'png', ...exportPreviewImage(inputs, options, rules, request) });
  } else {
    for (const format of ['svg', 'pdf', 'pdf14'] as ArtworkFormat[]) {
      const file = await exportArtwork(inputs, options, rules, { format, ...request });
      files.push({ kind: format, ...file });
    }
  }
  const proof = await buildProofSheet(
    inputs,
    options,
    rules,
    {
      producer: details.producer,
      sku: details.sku,
      issuedOn,
      ...(details.vintageOrBatch ? { vintageOrBatch: details.vintageOrBatch } : {}),
    },
    { watermark },
  );
  files.push({ kind: 'proof', ...proof });
  return files;
}

/** SHA-256 over each file's name and SHA-256, in order: any changed byte or name changes it. */
export async function outputHash(files: readonly ExportedFile[]): Promise<string> {
  const lines = await Promise.all(
    files.map(async (f) => `${f.fileName}\n${await sha256Hex(f.bytes)}`),
  );
  return sha256Hex(lines.join('\n'));
}

export interface ReplaySource {
  rules_version: string;
  inputs_json: string;
  options_json: string;
  details_json: string;
  issued_on: string;
  watermarked: number;
  output_hash: string;
}

export class RulesVersionUnavailableError extends Error {
  constructor(version: string) {
    super(`Rules version ${version} is not bundled with this build`);
    this.name = 'RulesVersionUnavailableError';
  }
}

/** Re-renders a stored export and compares hashes. Only this build's rules version can replay. */
export async function replayExport(
  record: ReplaySource,
  rules: EnergyStatementRules,
): Promise<{ matches: boolean; expected: string; actual: string }> {
  if (record.rules_version !== rules.version) {
    throw new RulesVersionUnavailableError(record.rules_version);
  }
  const files = await renderExportFiles(
    JSON.parse(record.inputs_json) as StatementInputs,
    JSON.parse(record.options_json) as StatementOptions,
    JSON.parse(record.details_json) as ExportDetails,
    record.issued_on,
    record.watermarked === 1,
    rules,
  );
  const actual = await outputHash(files);
  return { matches: actual === record.output_hash, expected: record.output_hash, actual };
}
