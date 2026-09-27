import { describe, expect, it } from 'vitest';
import {
  CHARSET,
  PRESET_WIDTHS_MM,
  WIDTH_LIMITS_MM,
  buildStatement,
  panelContent,
} from '../src/index.ts';
import { defaultOptions, fsanzInputs, rules } from './helpers.ts';

const svgOf = (width_mm: number, extra = {}) =>
  buildStatement(fsanzInputs, { width_mm, ...extra }, rules).svg!;

const allWidths = () => {
  const widths: number[] = [];
  for (let w = WIDTH_LIMITS_MM.min; w <= WIDTH_LIMITS_MM.max; w += 0.5) widths.push(w);
  return widths;
};

describe('SVG export specification (Build Brief 01 section 8)', () => {
  it('is sized in millimetres with 1 user unit = 1 mm and viewBox equal to the panel bounds', () => {
    const result = buildStatement(fsanzInputs, { width_mm: 35 }, rules);
    const h = result.metrics!.heightMm;
    expect(result.svg).toContain(`width="35mm" height="${h}mm" viewBox="0 0 35 ${h}"`);
  });

  it('draws the outer frame exactly on the viewBox edges', () => {
    const result = buildStatement(fsanzInputs, { width_mm: 35 }, rules);
    const h = result.metrics!.heightMm;
    const frame = /<path d="([^"]+)"\/>/.exec(result.svg!)![1]!;
    expect(frame).toContain('M0 0H35V');
    expect(frame).toContain(`V${h}H0Z`);
  });

  it('keeps every coordinate inside the panel bounds', () => {
    for (const width of PRESET_WIDTHS_MM) {
      const result = buildStatement(
        fsanzInputs,
        { width_mm: width, energy_units: 'kj_cal' },
        rules,
      );
      const numbers = [...result.svg!.matchAll(/ d="([^"]+)"/g)].flatMap(([, d]) =>
        d!
          .split(/[MLCHVZ ]/)
          .filter(Boolean)
          .map(Number),
      );
      expect(Math.min(...numbers)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...numbers)).toBeLessThanOrEqual(Math.max(width, result.metrics!.heightMm));
    }
  });

  it('outlines all text: no text elements, fonts or font references', () => {
    const svg = svgOf(50, { energy_units: 'kj_cal' });
    expect(svg).not.toMatch(/<text|<tspan|<font|font-family|@font-face|<style|<image|href=/);
    const elements = [...svg.matchAll(/<([a-z]+)[\s>/]/g)].map(([, name]) => name);
    expect(new Set(elements)).toEqual(new Set(['svg', 'title', 'desc', 'g', 'path']));
    for (const [, d] of svg.matchAll(/ d="([^"]+)"/g)) expect(d).toMatch(/^[MLCHVZ0-9. -]+$/);
  });

  it('keeps every rule at or above 0.25 pt at every width from 25 to 120 mm', () => {
    for (const width of allWidths()) {
      const { metrics } = buildStatement(fsanzInputs, { width_mm: width }, rules);
      expect(metrics!.ruleWeightPt, `${width} mm`).toBeGreaterThanOrEqual(
        rules.values.min_rule_weight_pt,
      );
    }
  });

  it('fits all text inside its cells at every width, with long values and a long custom word', () => {
    const long = { abv: 45.5, package_ml: 4500, serving_ml: 1500, kj_per_100ml: 2345.6 };
    for (const width of allWidths()) {
      const result = buildStatement(
        long,
        { width_mm: width, energy_units: 'kj_cal', package_word: 'magnum presentation case' },
        rules,
      );
      expect(
        result.warnings.map((w) => w.code),
        `${width} mm`,
      ).not.toContain('TEXT_OVERFLOW');
      expect(result.exportable).toBe(true);
    }
  });

  it('blocks rather than overflows when a single word cannot fit on a line', () => {
    // 24 of the widest capital: within the length limit, wider than the panel.
    const result = buildStatement(
      fsanzInputs,
      { width_mm: 50, package_word: 'W'.repeat(24) },
      rules,
    );
    expect(result.warnings.find((w) => w.code === 'TEXT_OVERFLOW')?.severity).toBe('block');
    expect(result.svg).toBeNull();
  });

  it('scales with width: height follows content in proportion', () => {
    const at30 = buildStatement(fsanzInputs, { width_mm: 30 }, rules).metrics!;
    const at60 = buildStatement(fsanzInputs, { width_mm: 60 }, rules).metrics!;
    expect(at60.bodySizeMm / at30.bodySizeMm).toBeCloseTo(2, 2);
    expect(at60.heightMm / at30.heightMm).toBeCloseTo(2, 1);
  });
});

describe('colour variants', () => {
  it('fills black artwork with #000000', () => {
    expect(svgOf(50)).toContain('<g id="energy-panel" fill="#000000">');
  });

  it('fills white-on-transparent artwork with #FFFFFF and no background', () => {
    const svg = svgOf(50, { colour: 'white' });
    expect(svg).toContain('<g id="energy-panel" fill="#FFFFFF">');
    expect(svg).not.toMatch(/#000000|<rect/);
  });

  it('tags spot artwork with the "Panel" separation name', () => {
    expect(svgOf(50, { colour: 'spot' })).toContain('data-spot-colour="Panel"');
  });
});

describe('content', () => {
  it('uses the prescribed wording from the rules file', () => {
    const svg = svgOf(50, { energy_units: 'kj_cal' });
    expect(svg).toContain('<title>ENERGY INFORMATION</title>');
    expect(svg).toContain(
      '<desc>ENERGY INFORMATION. Servings per package: 12. Serving size: 60 mL. Standard drinks per serving: 1.0. ' +
        'Energy, Average quantity per serving: 355 kJ (84.9 Cal). Energy, Average quantity per 100 mL: 592 kJ (141 Cal).</desc>',
    );
  });

  it('inserts custom package words literally, even with replacement patterns', () => {
    const svg = svgOf(50, { package_word: 'box$&' });
    expect(svg).toContain('Servings per box$&amp;: 12.');
  });

  it('never draws the total standard drinks inside the panel', () => {
    const result = buildStatement(fsanzInputs, defaultOptions, rules);
    const content = panelContent(result.values!, result.options!, rules);
    const text = JSON.stringify(content);
    expect(result.values!.display.totalStandardDrinks).toBe('12.0');
    expect(text).not.toContain('12.0');
    expect(text).not.toMatch(/total/i);
  });

  it('escapes markup in custom package words', () => {
    const svg = svgOf(50, { package_word: 'bag & box' });
    expect(svg).toContain('Servings per bag &amp; box: 12.');
  });

  it('can typeset every rules-file string and the documented character set', () => {
    const v = rules.values;
    const strings = [
      v.title_text,
      ...Object.values(v.labels),
      ...Object.values(v.column_headings),
      v.package_word.default,
      ...v.package_word.alternatives,
    ];
    for (const s of strings) expect(CHARSET.includes(s[0]!)).toBe(true);
    expect(
      buildStatement(fsanzInputs, { width_mm: 50, package_word: 'ĀāĒēĪīŌōŪū' }, rules).exportable,
    ).toBe(true);
  });
});

describe('determinism', () => {
  it('renders byte-identical SVG for the same inputs, whatever the key order', () => {
    const a = buildStatement(fsanzInputs, { width_mm: 45, energy_units: 'kj_cal' }, rules).svg;
    const reordered = { kj_per_100ml: 592, serving_ml: 60, package_ml: 720, abv: 21.1 };
    const b = buildStatement(reordered, { energy_units: 'kj_cal', width_mm: 45 }, rules).svg;
    expect(b).toBe(a);
  });
});
