// Golden fixtures in test/fixtures: each *.json holds inputs, options and hand-checked display
// values; the matching *.svg is the reviewed artwork, compared byte for byte.
// After an intended change: pnpm fixtures:update, then review the rendered diff before committing.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildProofSheet, buildStatement, exportArtwork } from '../src/index.ts';
import { rules } from './helpers.ts';

const dir = new URL('../../../test/fixtures/', import.meta.url);
const fixtures = readdirSync(dir)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map((file) => ({
    name: file.replace(/\.json$/, ''),
    ...JSON.parse(readFileSync(new URL(file, dir), 'utf8')),
  }));

describe('golden fixtures', () => {
  it('starts with the FSANZ guidance example', () => {
    expect(fixtures.map((f) => f.name)).toContain('fsanz-example');
  });

  it.each(fixtures.map((f) => [f.name, f] as const))('%s', (name, fixture) => {
    const result = buildStatement(fixture.inputs, fixture.options, rules);
    expect(result.values?.display).toMatchObject(fixture.expected);
    const golden = readFileSync(new URL(`${name}.svg`, dir), 'utf8');
    expect(result.svg).toBe(golden);
  });

  it.each(fixtures.filter((f) => f.export).map((f) => [f.name, f] as const))(
    '%s exports byte-identical PDF artwork and proof sheet',
    async (name, fixture) => {
      const { issuedOn, org, sku } = fixture.export;
      const pdf = await exportArtwork(fixture.inputs, fixture.options, rules, {
        format: 'pdf',
        issuedOn,
        org,
        sku,
      });
      const proof = await buildProofSheet(fixture.inputs, fixture.options, rules, {
        producer: org,
        sku,
        issuedOn,
      });
      const golden = (file: string) => readFileSync(new URL(file, dir));
      expect(Buffer.from(pdf.bytes).equals(golden(`${name}.pdf`))).toBe(true);
      expect(Buffer.from(proof.bytes).equals(golden(`${name}-proof.pdf`))).toBe(true);
    },
  );
});
