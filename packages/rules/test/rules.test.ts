import { describe, expect, it } from 'vitest';
import rulesJson from '../../../rules/fsanz-energy-statement.json' with { type: 'json' };
import {
  RulesValidationError,
  listUnverified,
  loadFsanzEnergyStatementRules,
  parseRules,
} from '../src/index.ts';

const clone = (): any => structuredClone(rulesJson);

describe('rules/fsanz-energy-statement.json', () => {
  it('passes schema validation', () => {
    const rules = loadFsanzEnergyStatementRules();
    expect(rules.id).toBe('fsanz-energy-statement');
    expect(rules.jurisdictions).toEqual(['AU', 'NZ']);
  });

  it('carries the values verified against the Code, the FSANZ guidance and Wine Australia', () => {
    const v = loadFsanzEnergyStatementRules().values;
    expect(v.gazettal_date).toBe('2025-08-13');
    expect(v.compliance_date).toBe('2028-08-13');
    expect(v.min_abv_percent).toBe(0.5);
    expect(v.standardised_alcoholic_beverages).toContain('beer');
    expect(v.standardised_alcoholic_beverages).toHaveLength(13);
    expect(v.title_text).toBe('ENERGY INFORMATION');
    expect(v.labels).toEqual({
      servings_per_package: 'Servings per {package}',
      serving_size: 'Serving size',
      energy: 'Energy',
    });
    expect(v.standard_drinks_words).toEqual({
      singular: 'standard drink',
      plural: 'standard drinks',
    });
    expect(v.standard_drinks_trim_trailing_zero).toBe(true);
    expect(v.existing_duties).toEqual(['the approximate number of standard drinks in the package']);
    expect(v.min_type_size).toBeNull();
    expect(v.max_significant_figures).toBe(3);
    expect(v.standard_drinks_decimal_places).toBe(1);
    expect(v.column_headings).toEqual({
      per_serving: 'Average quantity per serving',
      per_100ml: 'Average quantity per 100 mL',
    });
    expect(v.package_word.default).toBe('package');
    expect(v.package_word.alternatives).toEqual(['bottle', 'can', 'cask', 'keg']);
    expect(v.exemptions.map((e) => e.code)).toEqual([
      'nip_displayed',
      'small_package',
      'not_required_to_bear_label',
    ]);
    expect(v.exemptions.find((e) => e.code === 'small_package')?.max_surface_area_cm2).toBe(100);
    expect(v.standard_drink_ethanol_g).toBe(10);
    expect(v.ethanol_density_g_per_ml).toBe(0.789);
    expect(v.kj_per_cal).toBe(4.184);
    expect(v.min_rule_weight_pt).toBe(0.25);
  });

  it('identifies every external source by URL or by the SHA-256 of the copy read', () => {
    const { sources } = loadFsanzEnergyStatementRules().file;
    for (const [id, source] of Object.entries(sources)) {
      if (source.kind === 'studio') continue;
      expect(source.url !== null || source.sha256 !== undefined, id).toBe(true);
      if (source.url !== null) expect(source.url, id).toMatch(/^https:\/\//);
    }
  });

  it('has every rule verified', () => {
    const rules = loadFsanzEnergyStatementRules();
    expect(rules.version).toBe('1.0.0');
    expect(listUnverified(rules)).toEqual([]);
  });

  it('records where each externally verified rule is stated', () => {
    const { rules, sources } = loadFsanzEnergyStatementRules().file;
    for (const [key, rule] of Object.entries(rules)) {
      const external = rule.sources.some((id) => sources[id]?.kind !== 'studio');
      if (rule.verified_at !== null && external) expect(rule.locator, key).toBeTruthy();
    }
  });
});

describe('parseRules', () => {
  it('rejects a rule that cites an unknown source', () => {
    const json = clone();
    json.rules.min_abv_percent.sources = ['nowhere'];
    expect(() => parseRules(json)).toThrow(/unknown source "nowhere"/);
  });

  it('rejects unknown keys so typos cannot slip through', () => {
    const json = clone();
    json.rules.max_sig_figs = json.rules.max_significant_figures;
    expect(() => parseRules(json)).toThrow(RulesValidationError);
  });

  it('rejects a malformed verified_at date', () => {
    const json = clone();
    json.rules.min_abv_percent.verified_at = '27/09/2026';
    expect(() => parseRules(json)).toThrow(/verified_at/);
  });

  it('requires the versions log to describe the current version', () => {
    const json = clone();
    json.version = '9.0.0';
    expect(() => parseRules(json)).toThrow(/versions/);
  });

  it('requires the package-word placeholder in the servings label', () => {
    const json = clone();
    json.rules.labels.value.servings_per_package = 'Servings per bottle';
    expect(() => parseRules(json)).toThrow(/servings_per_package/);
  });

  it('accepts a minimum type size, should one ever be set', () => {
    const json = clone();
    json.rules.min_type_size.value = { size_mm: 1.2, measure: 'cap_height' };
    const rules = parseRules(json);
    expect(rules.values.min_type_size).toEqual({ size_mm: 1.2, measure: 'cap_height' });
  });

  it('requires a locator on a rule verified against an external source', () => {
    const json = clone();
    delete json.rules.title_text.locator;
    expect(() => parseRules(json)).toThrow(/locator/);
  });

  it('requires an external source to carry a URL or the SHA-256 of the copy read', () => {
    const json = clone();
    delete json.sources.code_amendment_241.sha256;
    expect(() => parseRules(json)).toThrow(/url or the sha256/);
  });
});
