import { describe, expect, it } from 'vitest';
import { buildStatement, type FindingCode, type StatementResult } from '../src/index.ts';
import { defaultOptions, fsanzInputs, rules, rulesWith } from './helpers.ts';

const codes = (result: StatementResult) => result.warnings.map((w) => w.code);
const find = (result: StatementResult, code: FindingCode) =>
  result.warnings.find((w) => w.code === code);

// The validation states table in Build Brief 01 section 7, corrected where the Code differs.
describe('validation states (Build Brief 01 section 7)', () => {
  it('ABV below 0.5, not a standardised beverage: blocked; the statement is not required', () => {
    const result = buildStatement(
      { ...fsanzInputs, abv: 0.4, standardised_beverage: false },
      defaultOptions,
      rules,
    );
    const finding = find(result, 'ABV_BELOW_THRESHOLD');
    expect(finding?.severity).toBe('block');
    expect(finding?.message).toMatch(/not required/);
    expect(result.exportable).toBe(false);
    expect(result.svg).toBeNull();
    expect(result.values).not.toBeNull();
  });

  it('ABV below 0.5 on a standardised beverage: the statement is required (Standard 2.7.1—2)', () => {
    const result = buildStatement(
      { abv: 0, package_ml: 375, serving_ml: 375, kj_per_100ml: 70, standardised_beverage: true },
      defaultOptions,
      rules,
    );
    expect(result.exportable).toBe(true);
    expect(codes(result)).not.toContain('STANDARD_DRINKS_ROUND_TO_ZERO');
    expect(result.svg).toContain('Serving size: 375 mL (0 standard drinks).');
  });

  it('ABV below 0.5 with the beverage type unknown: blocked until the type is confirmed', () => {
    const result = buildStatement({ ...fsanzInputs, abv: 0.4 }, defaultOptions, rules);
    const finding = find(result, 'STANDARDISED_BEVERAGE_UNCONFIRMED');
    expect(finding?.severity).toBe('block');
    expect(finding?.field).toBe('standardised_beverage');
    expect(finding?.message).toMatch(/beer, brandy, cider/);
    expect(codes(result)).not.toContain('ABV_BELOW_THRESHOLD');
  });

  it('ABV of exactly 0.5 is covered ("no less than 0.5%")', () => {
    const result = buildStatement({ ...fsanzInputs, abv: 0.5 }, defaultOptions, rules);
    expect(codes(result)).not.toContain('ABV_BELOW_THRESHOLD');
    expect(codes(result)).not.toContain('STANDARDISED_BEVERAGE_UNCONFIRMED');
    expect(result.exportable).toBe(true);
  });

  it('package surface area under 100 cm²: warning that the exemption may apply; export allowed', () => {
    const result = buildStatement(
      { ...fsanzInputs, package_surface_area_cm2: 99.5 },
      defaultOptions,
      rules,
    );
    expect(find(result, 'SMALL_PACKAGE_EXEMPTION')?.severity).toBe('warning');
    expect(find(result, 'SMALL_PACKAGE_EXEMPTION')?.message).toMatch(
      /does not need an energy statement/,
    );
    expect(result.exportable).toBe(true);
    expect(result.svg).not.toBeNull();
  });

  it('a surface area of 100 cm² or more raises nothing', () => {
    const result = buildStatement(
      { ...fsanzInputs, package_surface_area_cm2: 100 },
      defaultOptions,
      rules,
    );
    expect(codes(result)).not.toContain('SMALL_PACKAGE_EXEMPTION');
  });

  it('NIP present: warning that no energy statement is required; export allowed', () => {
    const result = buildStatement({ ...fsanzInputs, nip_displayed: true }, defaultOptions, rules);
    expect(find(result, 'NIP_DISPLAYED')?.severity).toBe('warning');
    expect(find(result, 'NIP_DISPLAYED')?.message).toMatch(/not required/);
    expect(result.exportable).toBe(true);
  });

  it('missing kJ per 100 mL: export blocked', () => {
    const { kj_per_100ml: _omitted, ...rest } = fsanzInputs;
    const result = buildStatement(rest, defaultOptions, rules);
    expect(find(result, 'KJ_MISSING')?.severity).toBe('block');
    expect(result.exportable).toBe(false);
    expect(result.svg).toBeNull();
    expect(result.values).toBeNull();
  });

  it('servings per package not a whole number: shown to one decimal place with a note', () => {
    const result = buildStatement(
      { abv: 40, package_ml: 700, serving_ml: 30, kj_per_100ml: 925 },
      defaultOptions,
      rules,
    );
    expect(find(result, 'SERVINGS_NOT_WHOLE')?.severity).toBe('note');
    expect(result.values?.display.servingsPerPackage).toBe('23.3');
    expect(result.exportable).toBe(true);
  });
});

describe('precision ceiling (section 7 rule)', () => {
  it('rejects a request to display more than three significant figures', () => {
    const result = buildStatement(fsanzInputs, { width_mm: 50, significant_figures: 4 }, rules);
    expect(find(result, 'PRECISION_ABOVE_MAXIMUM')?.severity).toBe('block');
    expect(result.svg).toBeNull();
  });
});

describe('input checks', () => {
  it.each([
    ['abv', { abv: Number.NaN }],
    ['abv', { abv: 101 }],
    ['package_ml', { package_ml: 0 }],
    ['serving_ml', { serving_ml: -30 }],
    ['servings', { servings: 0 }],
    ['kj_per_100ml', { kj_per_100ml: -5 }],
    ['cal_per_100ml', { cal_per_100ml: 0 }],
    ['package_surface_area_cm2', { package_surface_area_cm2: -1 }],
    ['standardised_beverage', { standardised_beverage: 'yes' as never }],
  ])('blocks an invalid %s', (field, change) => {
    const result = buildStatement({ ...fsanzInputs, ...change }, defaultOptions, rules);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: 'INPUT_INVALID', field }),
    );
    expect(result.svg).toBeNull();
  });

  it('blocks a serving larger than the package', () => {
    const result = buildStatement({ ...fsanzInputs, serving_ml: 800 }, defaultOptions, rules);
    expect(find(result, 'SERVING_EXCEEDS_PACKAGE')?.severity).toBe('block');
  });

  it('blocks a serving size with more than one decimal place', () => {
    const result = buildStatement({ ...fsanzInputs, serving_ml: 37.55 }, defaultOptions, rules);
    expect(find(result, 'SERVING_SIZE_PRECISION')?.severity).toBe('block');
  });

  it('warns when a servings override disagrees with volume ÷ serving size', () => {
    const result = buildStatement({ ...fsanzInputs, servings: 10 }, defaultOptions, rules);
    expect(find(result, 'SERVINGS_OVERRIDE_DIFFERS')?.severity).toBe('warning');
    expect(result.exportable).toBe(true);
  });

  it('warns when an entered Cal value does not match kJ ÷ 4.184', () => {
    expect(
      codes(buildStatement({ ...fsanzInputs, cal_per_100ml: 141.5 }, defaultOptions, rules)),
    ).not.toContain('CAL_MISMATCH');
    const result = buildStatement({ ...fsanzInputs, cal_per_100ml: 160 }, defaultOptions, rules);
    expect(find(result, 'CAL_MISMATCH')?.severity).toBe('warning');
  });

  it('warns when standard drinks per serving round to zero', () => {
    const result = buildStatement(
      { abv: 0.5, package_ml: 100, serving_ml: 10, kj_per_100ml: 80 },
      defaultOptions,
      rules,
    );
    expect(result.values?.display.standardDrinksPerServing).toBe('0');
    expect(find(result, 'STANDARD_DRINKS_ROUND_TO_ZERO')?.severity).toBe('warning');
  });
});

describe('options', () => {
  it.each([24.9, 120.1, Number.NaN])('blocks a width of %s mm', (width_mm) => {
    const result = buildStatement(fsanzInputs, { width_mm }, rules);
    expect(find(result, 'WIDTH_OUT_OF_RANGE')?.severity).toBe('block');
  });

  it.each([25, 120])('accepts the %s mm limit', (width_mm) => {
    expect(buildStatement(fsanzInputs, { width_mm }, rules).exportable).toBe(true);
  });

  it('accepts the listed package words and custom words', () => {
    for (const package_word of ['package', 'bottle', 'can', 'cask', 'keg', 'flask', 'pouch']) {
      const result = buildStatement(fsanzInputs, { width_mm: 50, package_word }, rules);
      expect(result.exportable, package_word).toBe(true);
      expect(result.svg).toContain(`Servings per ${package_word}: 12.`);
    }
  });

  it('blocks package words the artwork typeface cannot set', () => {
    const result = buildStatement(fsanzInputs, { width_mm: 50, package_word: '瓶' }, rules);
    expect(find(result, 'PACKAGE_WORD_INVALID')?.message).toMatch(/瓶/);
  });

  it('blocks empty and over-long package words', () => {
    for (const package_word of ['  ', 'x'.repeat(25)]) {
      const result = buildStatement(fsanzInputs, { width_mm: 50, package_word }, rules);
      expect(find(result, 'PACKAGE_WORD_INVALID')?.severity, package_word).toBe('block');
    }
  });

  it('blocks custom package words when the rules do not allow them', () => {
    const strict = rulesWith((json) => {
      json.rules.package_word.value.custom_allowed = false;
    });
    const result = buildStatement(fsanzInputs, { width_mm: 50, package_word: 'flask' }, strict);
    expect(find(result, 'PACKAGE_WORD_INVALID')?.message).toMatch(/Choose one of/);
  });

  it('blocks unknown colour variants and energy units', () => {
    const result = buildStatement(
      fsanzInputs,
      { width_mm: 50, colour: 'red' as never, energy_units: 'cal' as never },
      rules,
    );
    expect(result.warnings.filter((w) => w.code === 'INPUT_INVALID').map((w) => w.field)).toEqual([
      'colour',
      'energy_units',
    ]);
  });
});

describe('minimum type size (rules file, section 8)', () => {
  const withMinimum = rulesWith((json) => {
    json.rules.min_type_size.value = { size_mm: 1.2, measure: 'cap_height' };
    json.rules.min_type_size.verified_at = '2026-09-27';
  });

  it('is not enforced while the rules file records no minimum', () => {
    expect(rules.values.min_type_size).toBeNull();
    expect(buildStatement(fsanzInputs, { width_mm: 25 }, rules).exportable).toBe(true);
  });

  it('blocks exports whose type falls below it and names the smallest compliant width', () => {
    const result = buildStatement(fsanzInputs, { width_mm: 30 }, withMinimum);
    const finding = find(result, 'TYPE_BELOW_MINIMUM');
    expect(finding?.severity).toBe('block');
    // Cap height is 0.698 em and the body is width ÷ 22, so 1.2 mm needs 1.2 × 22 ÷ 0.698 = 37.8 mm.
    expect(finding?.message).toMatch(/at least 37\.9 mm/);
    expect(result.svg).toBeNull();
    expect(buildStatement(fsanzInputs, { width_mm: 37.9 }, withMinimum).exportable).toBe(true);
  });
});

describe('rules verification note', () => {
  it('stays on every result while rules are unverified', () => {
    const result = buildStatement(fsanzInputs, defaultOptions, rules);
    expect(find(result, 'RULES_UNVERIFIED')?.severity).toBe('note');
    expect(result.exportable).toBe(true);
  });

  it('disappears once every rule is verified', () => {
    const verified = rulesWith((json) => {
      for (const rule of Object.values<any>(json.rules)) rule.verified_at = '2026-09-27';
    });
    expect(codes(buildStatement(fsanzInputs, defaultOptions, verified))).toEqual([]);
  });
});
