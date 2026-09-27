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

  it('carries the section 2 and section 7 values from Build Brief 01', () => {
    const v = loadFsanzEnergyStatementRules().values;
    expect(v.gazettal_date).toBe('2025-08-13');
    expect(v.compliance_date).toBe('2028-08-13');
    expect(v.min_abv_percent).toBe(0.5);
    expect(v.title_text).toBe('ENERGY INFORMATION');
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

  it('gives every regulatory source a URL', () => {
    const { sources } = loadFsanzEnergyStatementRules().file;
    for (const [id, source] of Object.entries(sources)) {
      if (source.kind !== 'studio') expect(source.url, id).toMatch(/^https:\/\//);
    }
  });

  it('reports the rules that no person has verified yet', () => {
    const rules = loadFsanzEnergyStatementRules();
    // Session 1 could not reach the primary sources: only the two studio rules sourced from the
    // brief alone are verified. Every rule citing a regulatory source still awaits a person.
    const verified = Object.keys(rules.file.rules).filter(
      (key) => !listUnverified(rules).includes(key as never),
    );
    expect(verified.sort()).toEqual(['min_rule_weight_pt', 'servings_decimal_places']);
    for (const key of listUnverified(rules)) {
      expect(rules.file.rules[key].verified_at).toBeNull();
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
    json.version = '0.2.0';
    expect(() => parseRules(json)).toThrow(/versions/);
  });

  it('requires the package-word placeholder in the servings label', () => {
    const json = clone();
    json.rules.labels.value.servings_per_package = 'Servings per bottle';
    expect(() => parseRules(json)).toThrow(/servings_per_package/);
  });

  it('accepts a verified minimum type size', () => {
    const json = clone();
    json.rules.min_type_size.value = { size_mm: 1.2, measure: 'cap_height' };
    json.rules.min_type_size.verified_at = '2026-09-27';
    const rules = parseRules(json);
    expect(rules.values.min_type_size).toEqual({ size_mm: 1.2, measure: 'cap_height' });
    expect(listUnverified(rules)).not.toContain('min_type_size');
  });
});
