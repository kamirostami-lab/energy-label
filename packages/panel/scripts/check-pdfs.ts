// Checks exported PDFs with Poppler, as a printer's preflight would (Build Brief 01 acceptance
// criteria): pdffonts must list no fonts, and pdfinfo must read one page of the expected PDF
// version whose MediaBox and TrimBox measure the panel (a 35 mm panel is 99.2126 pt wide). Covers
// both PDF flavours and the proof sheet for every golden fixture, which between them use all three
// colour variants and a 35 mm panel, plus the watermarked preview exports. Poppler warnings count
// as failures.
//   pnpm pdf:check
// Needs poppler-utils. Without it the check is skipped with a notice, except in CI, where it fails.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFsanzEnergyStatementRules } from '@energy-panel/rules';
import { PT_PER_MM, buildProofSheet, buildStatement, exportArtwork } from '../src/index.ts';
import type { ExportedFile } from '../src/index.ts';

const dir = new URL('../../../test/fixtures/', import.meta.url);
const rules = loadFsanzEnergyStatementRules();
const issuedOn = '2026-09-30';
const org = 'Komms-Haus';
/** Tolerance in points: pdfinfo prints boxes to 0.01 pt. The brief allows 0.2 mm (0.57 pt). */
const TOLERANCE_PT = 0.01;

interface Expected {
  widthMm: number;
  heightMm: number;
  version: '1.4' | '1.6';
}

function run(tool: string, args: string[]) {
  const result = spawnSync(tool, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  return { ok: result.status === 0, stdout: result.stdout, stderr: result.stderr.trim() };
}

function popplerMissing(): boolean {
  try {
    run('pdffonts', ['-v']);
    run('pdfinfo', ['-v']);
    return false;
  } catch {
    return true;
  }
}

/** Problems Poppler finds with one file; empty when it passes. */
function inspect(path: string, expected: Expected): string[] {
  const problems: string[] = [];
  const fonts = run('pdffonts', [path]);
  if (!fonts.ok) problems.push(`pdffonts could not read the file: ${fonts.stderr}`);
  else {
    // Two header lines, then one line per font.
    const rows = fonts.stdout.split('\n').filter((line) => line.trim() !== '');
    if (rows.length !== 2) problems.push(`pdffonts lists fonts:\n${rows.slice(2).join('\n')}`);
  }
  if (fonts.stderr) problems.push(`pdffonts reported: ${fonts.stderr}`);

  const info = run('pdfinfo', ['-box', path]);
  if (!info.ok) return [...problems, `pdfinfo could not read the file: ${info.stderr}`];
  if (info.stderr) problems.push(`pdfinfo reported: ${info.stderr}`);
  const field = (key: string) => info.stdout.match(new RegExp(`^${key}:\\s+(.+)$`, 'm'))?.[1];
  const box = (key: string) => {
    const [x0 = NaN, y0 = NaN, x1 = NaN, y1 = NaN] = (field(key) ?? '')
      .trim()
      .split(/\s+/)
      .map(Number);
    return { width: x1 - x0, height: y1 - y0 };
  };
  if (field('Pages') !== '1') problems.push(`expected 1 page, pdfinfo reads ${field('Pages')}`);
  if (field('PDF version') !== expected.version) {
    problems.push(`expected PDF ${expected.version}, pdfinfo reads ${field('PDF version')}`);
  }
  const width = expected.widthMm * PT_PER_MM;
  const height = expected.heightMm * PT_PER_MM;
  for (const key of ['MediaBox', 'TrimBox']) {
    const { width: w, height: h } = box(key);
    if (!(Math.abs(w - width) <= TOLERANCE_PT && Math.abs(h - height) <= TOLERANCE_PT)) {
      problems.push(
        `${key} is ${w} × ${h} pt; expected ${width.toFixed(2)} × ${height.toFixed(2)} pt`,
      );
    }
  }
  return problems;
}

if (popplerMissing()) {
  const message = 'pdffonts and pdfinfo not found: install poppler-utils to check exported PDFs';
  if (process.env.CI) {
    console.error(message);
    process.exit(1);
  }
  console.warn(`${message}. Skipped.`);
  process.exit(0);
}

const out = mkdtempSync(join(tmpdir(), 'energy-panel-pdf-'));
let failures = 0;
const check = (file: ExportedFile, expected: Expected) => {
  const path = join(out, file.fileName);
  writeFileSync(path, file.bytes);
  const problems = inspect(path, expected);
  const size = `${expected.widthMm} × ${expected.heightMm.toFixed(2)} mm`;
  if (problems.length === 0) {
    console.log(`ok    ${file.fileName}  ${size}, PDF ${expected.version}, no fonts`);
  } else {
    failures += 1;
    console.error(`FAIL  ${file.fileName}\n      ${problems.join('\n      ')}`);
  }
};

try {
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()) {
    const sku = file.replace(/\.json$/, '');
    const { inputs, options } = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
    const { metrics } = buildStatement(inputs, options, rules);
    if (!metrics) throw new Error(`${file} does not produce a panel`);
    const panel = { widthMm: metrics.widthMm, heightMm: metrics.heightMm };
    const request = { issuedOn, org, sku };
    check(await exportArtwork(inputs, options, rules, { format: 'pdf', ...request }), {
      ...panel,
      version: '1.6',
    });
    check(await exportArtwork(inputs, options, rules, { format: 'pdf14', ...request }), {
      ...panel,
      version: '1.4',
    });
    check(await buildProofSheet(inputs, options, rules, { producer: org, sku, issuedOn }), {
      widthMm: 210,
      heightMm: 297,
      version: '1.6',
    });
    // Free preview exports (decision D3) carry the PREVIEW mark and must pass the same checks.
    check(
      await exportArtwork(inputs, options, rules, { format: 'pdf', ...request, watermark: true }),
      { ...panel, version: '1.6' },
    );
    check(
      await buildProofSheet(
        inputs,
        options,
        rules,
        { producer: org, sku, issuedOn },
        { watermark: true },
      ),
      { widthMm: 210, heightMm: 297, version: '1.6' },
    );
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`${failures} PDF${failures === 1 ? '' : 's'} failed the Poppler check`);
  process.exit(1);
}
