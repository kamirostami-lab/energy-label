// Regenerates the golden files in test/fixtures from their *.json inputs: <name>.svg for every
// fixture, plus <name>.pdf and <name>-proof.pdf for fixtures with an "export" block. Only run this
// after deciding the new output is correct: review the rendered diff, because the golden tests
// exist to catch changes.
//   pnpm fixtures:update
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { loadFsanzEnergyStatementRules } from '@energy-panel/rules';
import { buildProofSheet, buildStatement, exportArtwork } from '../src/index.ts';

const dir = new URL('../../../test/fixtures/', import.meta.url);
const rules = loadFsanzEnergyStatementRules();

const write = (name: string, bytes: string | Uint8Array) => {
  writeFileSync(new URL(name, dir), bytes);
  console.log(`wrote test/fixtures/${name}`);
};

for (const file of readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()) {
  const name = file.replace(/\.json$/, '');
  const fixture = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
  const result = buildStatement(fixture.inputs, fixture.options, rules);
  if (!result.svg) {
    const blocking = result.warnings.filter((w) => w.severity === 'block').map((w) => w.code);
    throw new Error(`${file} does not produce exportable artwork: ${blocking.join(', ')}`);
  }
  write(`${name}.svg`, result.svg);

  if (fixture.export) {
    const { issuedOn, org, sku } = fixture.export;
    const pdf = await exportArtwork(fixture.inputs, fixture.options, rules, {
      format: 'pdf',
      issuedOn,
      org,
      sku,
    });
    write(`${name}.pdf`, pdf.bytes);
    const proof = await buildProofSheet(fixture.inputs, fixture.options, rules, {
      producer: org,
      sku,
      issuedOn,
    });
    write(`${name}-proof.pdf`, proof.bytes);
  }
}
