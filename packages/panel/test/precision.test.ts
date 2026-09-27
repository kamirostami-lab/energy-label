import { describe, expect, it } from 'vitest';
import {
  PRESET_WIDTHS_MM,
  buildStatement,
  countSignificantFigures,
  type StatementInputs,
} from '../src/index.ts';
import { rules, seededRandom } from './helpers.ts';

// Acceptance criterion: 100 random inputs never produce a displayed value with more than three
// significant figures. The seed is fixed so any failure can be replayed exactly.
const random = seededRandom(20260925);
const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
const round = (value: number, places: number) => Number(value.toFixed(places));

const CASES = Array.from({ length: 100 }, () => {
  const serving = round(10 + random() * 490, pick([0, 1]));
  const inputs: StatementInputs = {
    abv: round(0.5 + random() * 59.5, pick([0, 1, 2])),
    serving_ml: serving,
    package_ml: round(serving * (1 + random() * 40), 1),
    kj_per_100ml: round(5 + random() * 2400, pick([0, 1, 2, 3, 4])),
  };
  return { inputs, width: pick(PRESET_WIDTHS_MM) };
});

describe('precision ceiling', () => {
  it.each(CASES.map((c, i) => [i + 1, c] as const))('random input %i', (_n, { inputs, width }) => {
    const result = buildStatement(inputs, { width_mm: width, energy_units: 'kj_cal' }, rules);
    expect(result.exportable, JSON.stringify(result.warnings)).toBe(true);
    const d = result.values!.display;
    const energy = [
      d.energyPerServingKj,
      d.energyPer100mlKj,
      d.energyPerServingCal!,
      d.energyPer100mlCal!,
    ];
    for (const value of energy) {
      expect(
        countSignificantFigures(value),
        `${value} from ${JSON.stringify(inputs)}`,
      ).toBeLessThanOrEqual(rules.values.max_significant_figures);
    }
    // What the panel displays is exactly these strings.
    const desc = /<desc>(.*)<\/desc>/.exec(result.svg!)![1]!;
    for (const value of energy) expect(desc).toContain(value);
  });
});
