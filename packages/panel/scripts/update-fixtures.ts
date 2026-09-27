// Regenerates test/fixtures/*.svg from their *.json inputs. Only run this after deciding the new
// output is correct: review the rendered diff, because the golden test exists to catch changes.
//   pnpm fixtures:update
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { loadFsanzEnergyStatementRules } from '@energy-panel/rules';
import { buildStatement } from '../src/index.ts';

const dir = new URL('../../../test/fixtures/', import.meta.url);
const rules = loadFsanzEnergyStatementRules();

for (const file of readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort()) {
  const fixture = JSON.parse(readFileSync(new URL(file, dir), 'utf8'));
  const result = buildStatement(fixture.inputs, fixture.options, rules);
  if (!result.svg) {
    const blocking = result.warnings.filter((w) => w.severity === 'block').map((w) => w.code);
    throw new Error(`${file} does not produce exportable artwork: ${blocking.join(', ')}`);
  }
  const target = file.replace(/\.json$/, '.svg');
  writeFileSync(new URL(target, dir), result.svg);
  console.log(`wrote test/fixtures/${target}`);
}
