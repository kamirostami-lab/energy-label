import { describe, expect, it } from 'vitest';
import {
  buildStatement,
  formatFixed,
  packageStandardDrinks,
  standardDrinks,
} from '../src/index.ts';
import { defaultOptions, fsanzInputs, rules, rulesWith } from './helpers.ts';

// Acceptance criterion: 20 known ABV and serving combinations match hand-calculated values to one
// decimal place. Working: serving mL × ABV % × 0.789 g/mL ÷ 1000 (i.e. ÷ 100 for the percentage,
// ÷ 10 g per standard drink), then rounded half up to one decimal place.
const HAND_CALCULATED: Array<[servingMl: number, abv: number, working: string, expected: string]> =
  [
    [375, 4.8, '375 × 4.8 × 0.789 ÷ 1000 = 1.4202', '1.4'],
    [330, 5.0, '330 × 5.0 × 0.789 ÷ 1000 = 1.30185', '1.3'],
    [150, 13.5, '150 × 13.5 × 0.789 ÷ 1000 = 1.597725', '1.6'],
    [100, 13.5, '100 × 13.5 × 0.789 ÷ 1000 = 1.06515', '1.1'],
    [30, 40, '30 × 40 × 0.789 ÷ 1000 = 0.9468', '0.9'],
    [30, 37, '30 × 37 × 0.789 ÷ 1000 = 0.87579', '0.9'],
    [60, 21.1, '60 × 21.1 × 0.789 ÷ 1000 = 0.998874', '1.0'],
    [375, 3.5, '375 × 3.5 × 0.789 ÷ 1000 = 1.0355625', '1.0'],
    [375, 2.7, '375 × 2.7 × 0.789 ÷ 1000 = 0.7988625', '0.8'],
    [330, 4.5, '330 × 4.5 × 0.789 ÷ 1000 = 1.171665', '1.2'],
    [750, 12, '750 × 12 × 0.789 ÷ 1000 = 7.101', '7.1'],
    [250, 7, '250 × 7 × 0.789 ÷ 1000 = 1.38075', '1.4'],
    [440, 6.5, '440 × 6.5 × 0.789 ÷ 1000 = 2.25654', '2.3'],
    [500, 5.5, '500 × 5.5 × 0.789 ÷ 1000 = 2.16975', '2.2'],
    [375, 0.5, '375 × 0.5 × 0.789 ÷ 1000 = 0.1479375', '0.1'],
    [100, 18, '100 × 18 × 0.789 ÷ 1000 = 1.4202', '1.4'],
    [60, 17.5, '60 × 17.5 × 0.789 ÷ 1000 = 0.82845', '0.8'],
    [355, 4.2, '355 × 4.2 × 0.789 ÷ 1000 = 1.176399', '1.2'],
    [200, 11, '200 × 11 × 0.789 ÷ 1000 = 1.7358', '1.7'],
    [285, 4.8, '285 × 4.8 × 0.789 ÷ 1000 = 1.079352', '1.1'],
  ];

describe('standard drinks per serving', () => {
  it('has twenty hand-calculated cases', () => {
    expect(HAND_CALCULATED).toHaveLength(20);
  });

  it.each(HAND_CALCULATED)('%s mL at %s%% ABV: %s → %s', (servingMl, abv, _working, expected) => {
    const values = buildStatement(
      { abv, package_ml: servingMl * 2, serving_ml: servingMl, kj_per_100ml: 300 },
      defaultOptions,
      rules,
    ).values!;
    expect(formatFixed(values.standardDrinksPerServing, 1)).toBe(expected);
    // Displayed as in the FSANZ guidance example: whole numbers without ".0".
    expect(values.display.standardDrinksPerServing).toBe(expected.replace(/\.0$/, ''));
  });

  it('can always show one decimal place when the rules say so', () => {
    const fixed = rulesWith((json) => {
      json.rules.standard_drinks_trim_trailing_zero.value = false;
    });
    const result = buildStatement(fsanzInputs, defaultOptions, fixed);
    expect(result.values?.display.standardDrinksPerServing).toBe('1.0');
    expect(result.svg).toContain('Serving size: 60 mL (1.0 standard drinks).');
  });
});

describe('serving size line', () => {
  it('carries standard drinks in brackets, singular for exactly one', () => {
    expect(buildStatement(fsanzInputs, defaultOptions, rules).svg).toContain(
      'Serving size: 60 mL (1 standard drink).',
    );
    const wine = { abv: 13.5, package_ml: 750, serving_ml: 150, kj_per_100ml: 297 };
    expect(buildStatement(wine, defaultOptions, rules).svg).toContain(
      'Serving size: 150 mL (1.6 standard drinks).',
    );
  });
});

describe('total standard drinks per package (reminder line)', () => {
  it('uses the same formula on the package volume', () => {
    // 720 × 21.1 × 0.789 ÷ 1000 = 11.986488: more than 10, so the nearest whole number.
    expect(
      buildStatement(fsanzInputs, defaultOptions, rules).values?.display.totalStandardDrinks,
    ).toBe('12');
  });

  it('shows one decimal place up to 10 and the nearest whole number above (2.7.1—4(2))', () => {
    const total = (package_ml: number, abv: number) =>
      packageStandardDrinks(standardDrinks(package_ml, abv, rules), abv, rules);
    expect(total(750, 13.5)).toBe('8.0'); // 7.988…
    expect(total(1267.4271229404309, 10)).toBe('10.0'); // exactly 10 is not more than 10
    expect(total(700, 40)).toBe('22'); // 22.092, not 22.1
    expect(total(4000, 12.5)).toBe('39'); // 39.45, not 39.5
    expect(total(30000, 5)).toBe('118'); // 118.35, not 118.4
  });

  it('is not required at 0.5% ABV or less (2.7.1—4(1)(b))', () => {
    expect(packageStandardDrinks(0.1, 0.4, rules)).toBeNull();
    expect(packageStandardDrinks(0.3, 0.5, rules)).toBeNull();
    expect(packageStandardDrinks(0.3, 0.6, rules)).toBe('0.3');
  });

  it('rounds exact halves up: 4 L cask at 12.5% is 39.45 → 39.5', () => {
    expect(formatFixed(standardDrinks(4000, 12.5, rules), 1)).toBe('39.5');
  });

  it('rounds exact halves up: 30 L keg at 5% is 118.35 → 118.4', () => {
    expect(formatFixed(standardDrinks(30000, 5, rules), 1)).toBe('118.4');
  });
});

describe('servings per package', () => {
  it('is package volume ÷ serving size, whole numbers shown without decimals', () => {
    const d = buildStatement(fsanzInputs, defaultOptions, rules).values?.display;
    expect(d?.servingsPerPackage).toBe('12');
  });

  it('is shown to one decimal place when not a whole number', () => {
    const values = buildStatement(
      { abv: 40, package_ml: 700, serving_ml: 30, kj_per_100ml: 925 },
      defaultOptions,
      rules,
    ).values;
    expect(values?.display.servingsPerPackage).toBe('23.3');
    // 1000 / 333 = 3.003…: not whole, so "3.0" rather than a misleading "3".
    const nearWhole = buildStatement(
      { abv: 5, package_ml: 1000, serving_ml: 333, kj_per_100ml: 150 },
      defaultOptions,
      rules,
    ).values;
    expect(nearWhole?.display.servingsPerPackage).toBe('3.0');
  });

  it('accepts a user override', () => {
    const values = buildStatement({ ...fsanzInputs, servings: 11 }, defaultOptions, rules).values;
    expect(values?.display.servingsPerPackage).toBe('11');
    expect(values?.servingsComputed).toBe(12);
  });
});

describe('energy', () => {
  it('reproduces the FSANZ example: 592 kJ per 100 mL × 60 mL = 355.2 → 355 kJ per serving', () => {
    const d = buildStatement(fsanzInputs, defaultOptions, rules).values?.display;
    expect(d?.energyPerServingKj).toBe('355');
    expect(d?.energyPer100mlKj).toBe('592');
    expect(d?.energyPerServingCal).toBeNull();
  });

  it('reduces the per 100 mL input to three significant figures', () => {
    const d = buildStatement({ ...fsanzInputs, kj_per_100ml: 1234.5 }, defaultOptions, rules).values
      ?.display;
    expect(d?.energyPer100mlKj).toBe('1230');
  });

  it('derives Cal from unrounded kJ ÷ 4.18 (Schedule 11, S11—2(4)) when Cal is shown', () => {
    const values = buildStatement(
      fsanzInputs,
      { width_mm: 50, energy_units: 'kj_cal' },
      rules,
    ).values;
    // 355.2 ÷ 4.18 = 84.976…; 592 ÷ 4.18 = 141.626…
    expect(values?.display.energyPerServingCal).toBe('85');
    expect(values?.display.energyPer100mlCal).toBe('142');
  });

  it('allows fewer significant figures, never more', () => {
    const d = buildStatement(fsanzInputs, { width_mm: 50, significant_figures: 2 }, rules).values
      ?.display;
    expect(d?.energyPerServingKj).toBe('360');
    expect(d?.energyPer100mlKj).toBe('590');
  });
});
