import { generatorConfig } from '@energy-panel/api/config';
import type { StatementInputs, StatementOptions } from '@energy-panel/panel';
import { loadFsanzEnergyStatementRules } from '@energy-panel/rules';
import { describe, expect, it } from 'vitest';
import { formFromSku, parseNumber, statementRequest } from './request';

const config = generatorConfig(loadFsanzEnergyStatementRules());

const inputs = (values: Partial<Record<keyof StatementInputs, unknown>>) =>
  ({
    abv: null,
    package_ml: null,
    serving_ml: null,
    servings: null,
    kj_per_100ml: null,
    cal_per_100ml: null,
    package_surface_area_cm2: null,
    nip_displayed: false,
    standardised_beverage: null,
    ...values,
  }) as unknown as StatementInputs;

describe('formFromSku', () => {
  // The generator marks a SKU saved when the form sends back exactly what was stored.
  const cases: Array<[string, Parameters<typeof formFromSku>[0]]> = [
    [
      'presets: fortified wine at 60 mL, 50 mm, bottle',
      {
        beverageType: 'fortified_wine',
        inputs: inputs({ abv: 21.1, package_ml: 720, serving_ml: 60, kj_per_100ml: 592 }),
        options: { width_mm: 50, colour: 'black', energy_units: 'kj', package_word: 'bottle' },
      },
    ],
    [
      'custom serving, width and package word, with Cal and a surface area',
      {
        beverageType: 'spirits',
        inputs: inputs({
          abv: 40,
          package_ml: 700,
          serving_ml: 45,
          servings: 15.5,
          kj_per_100ml: 925,
          cal_per_100ml: 221,
          package_surface_area_cm2: 180,
          nip_displayed: true,
        }),
        options: { width_mm: 37.5, colour: 'spot', energy_units: 'kj_cal', package_word: 'flask' },
      },
    ],
    [
      'below 0.5% ABV, confirmed as a standardised beverage',
      {
        beverageType: 'beer',
        inputs: inputs({
          abv: 0.4,
          package_ml: 375,
          serving_ml: 375,
          kj_per_100ml: 90,
          standardised_beverage: true,
        }),
        options: { width_mm: 30, colour: 'white', energy_units: 'kj', package_word: 'can' },
      },
    ],
    [
      'an incomplete draft with no beverage type',
      {
        beverageType: null,
        inputs: inputs({ abv: 5, standardised_beverage: false }),
        options: { width_mm: null as unknown as number, package_word: 'package' },
      },
    ],
  ];

  for (const [name, sku] of cases) {
    it(`round-trips ${name}`, () => {
      const request = statementRequest(formFromSku(sku, config));
      expect(request.inputs).toEqual(sku.inputs);
      expect(request.options).toEqual({
        colour: 'black',
        energy_units: 'kj',
        ...(sku.options as StatementOptions),
      });
    });
  }

  it('falls back to the Other beverage type for an unknown one', () => {
    const form = formFromSku(
      { beverageType: 'mead' as never, inputs: inputs({}), options: { width_mm: 50 } },
      config,
    );
    expect(form.beverage).toBe('other');
    expect(form.serving).toBe('custom');
  });
});

describe('parseNumber', () => {
  it('reads decimals, treats empty as not entered and anything else as invalid', () => {
    expect(parseNumber(' 21.1 ')).toBe(21.1);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('12,5')).toBeNaN();
    expect(parseNumber('1e3')).toBeNaN();
  });
});
