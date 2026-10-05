import { describe, expect, it } from 'vitest';
import {
  CHARSET,
  PRESET_WIDTHS_MM,
  WIDTH_LIMITS_MM,
  buildStatement,
  layoutPanel,
  panelContent,
} from '../src/index.ts';
import { FONT, bindPhrases } from '../src/layout.ts';
import { measureText } from '../src/text.ts';
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

describe('prescribed format (Standard 2.7.1—4B(3))', () => {
  const layoutFor = (inputs: typeof fsanzInputs, options: Parameters<typeof buildStatement>[1]) => {
    const result = buildStatement(inputs, options, rules);
    return layoutPanel(
      panelContent(result.values!, result.options!, rules),
      options.width_mm,
      rules.values.min_rule_weight_pt,
    );
  };

  it('has an outer border and two full-width rules, and no rules between columns', () => {
    const layout = layoutFor(fsanzInputs, { width_mm: 50 });
    const r = layout.metrics.ruleWeightMm;
    const horizontal = layout.rects.filter((rect) => rect.x === 0 && rect.width === 50);
    const vertical = layout.rects.filter((rect) => rect.height === layout.height);
    expect(layout.rects).toHaveLength(6);
    expect(horizontal).toHaveLength(4); // top and bottom border, above headings, above Energy
    expect(vertical.map((rect) => rect.x)).toEqual([0, 50 - r]);
  });

  it('centres the heading and sets everything else from the left', () => {
    const layout = layoutFor(fsanzInputs, { width_mm: 50 });
    const [title, ...rest] = layout.texts;
    const width = measureText(FONT, title!.text, title!.sizeMm);
    expect(title!.text).toBe('ENERGY INFORMATION');
    expect(title!.x + width / 2).toBeCloseTo(25, 9);
    expect(rest[0]!.text).toBe('Servings per package: 12');
    expect(rest[1]!.text).toBe('Serving size: 60\u00a0mL (1\u00a0standard\u00a0drink)');
  });

  it('sets kJ (Cal) on one line when both cells fit, and Cal under kJ in both when not', () => {
    const lines = (kj_per_100ml: number) =>
      layoutFor({ ...fsanzInputs, kj_per_100ml }, { width_mm: 50, energy_units: 'kj_cal' })
        .texts.map((t) => t.text)
        .filter((text) => /kJ|Cal/.test(text));
    expect(lines(592)).toEqual(['355\u00a0kJ (85\u00a0Cal)', '592\u00a0kJ (142\u00a0Cal)']);
    expect(lines(21400)).toEqual([
      '12800\u00a0kJ',
      '(3070\u00a0Cal)',
      '21400\u00a0kJ',
      '(5120\u00a0Cal)',
    ]);
  });

  it('never breaks a line inside brackets or between a number and its unit', () => {
    expect(bindPhrases('Serving size: 60 mL (1 standard drink)')).toBe(
      'Serving size: 60\u00a0mL (1\u00a0standard\u00a0drink)',
    );
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
      '<desc>ENERGY INFORMATION. Servings per package: 12. Serving size: 60 mL (1 standard drink). ' +
        'Energy, Average quantity per serving: 355 kJ (85 Cal). Energy, Average quantity per 100 mL: 592 kJ (142 Cal).</desc>',
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
    expect(result.values!.display.totalStandardDrinks).toBe('12');
    expect(text).not.toContain('in the package');
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
