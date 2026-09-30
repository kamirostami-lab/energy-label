import type { EnergyStatementRules } from '@energy-panel/rules';
import { computeValues } from './compute.ts';
import {
  energyText,
  layoutPanel,
  type EnergyCell,
  type PanelContent,
  type PanelLayout,
} from './layout.ts';
import { renderSvg } from './svg.ts';
import type {
  Finding,
  ResolvedOptions,
  StatementInputs,
  StatementOptions,
  StatementResult,
  StatementValues,
} from './types.ts';
import { rulesStatus, validateInputs, validateLayout, validateValues } from './validate.ts';

/** The text content of the panel, built from the rules file wording and the computed values. */
export function panelContent(
  values: StatementValues,
  options: ResolvedOptions,
  rules: EnergyStatementRules,
): PanelContent {
  const v = rules.values;
  const d = values.display;
  const { required: kJ, optional: Cal } = v.energy_units;
  const energy = (kj: string, cal: string | null): EnergyCell => ({
    kj: `${kj} ${kJ}`,
    cal: cal === null ? null : `(${cal} ${Cal})`,
  });
  const drinks = d.standardDrinksPerServing;
  const drinksWord =
    drinks === '1' ? v.standard_drinks_words.singular : v.standard_drinks_words.plural;
  return {
    title: v.title_text,
    // Standard drinks follow the serving size in brackets, as the prescribed format sets out.
    info: [
      // A replacer function, so "$&" or "$1" in a custom word is never read as a pattern.
      `${v.labels.servings_per_package.replace('{package}', () => options.package_word)}: ${d.servingsPerPackage}`,
      `${v.labels.serving_size}: ${d.servingSizeMl} ${v.serving_size_unit} (${drinks} ${drinksWord})`,
    ],
    headings: [v.column_headings.per_serving, v.column_headings.per_100ml],
    energyLabel: v.labels.energy,
    perServing: energy(d.energyPerServingKj, d.energyPerServingCal),
    per100ml: energy(d.energyPer100mlKj, d.energyPer100mlCal),
  };
}

/** The whole statement as one plain-text sentence sequence, for the SVG description. */
export function describePanel(content: PanelContent): string {
  return [
    content.title,
    ...content.info,
    `${content.energyLabel}, ${content.headings[0]}: ${energyText(content.perServing)}`,
    `${content.energyLabel}, ${content.headings[1]}: ${energyText(content.per100ml)}`,
  ]
    .map((sentence) => `${sentence}.`)
    .join(' ');
}

/** A built statement plus the laid-out panel the exporters draw from. */
export interface StatementPlan {
  result: StatementResult;
  /** Null when the inputs or options could not be computed. */
  layout: PanelLayout | null;
  content: PanelContent | null;
}

/** buildStatement, keeping the layout and content for the PDF and proof exporters. */
export function planStatement(
  inputs: StatementInputs,
  options: StatementOptions,
  rules: EnergyStatementRules,
): StatementPlan {
  const checked = validateInputs(inputs, options, rules);
  const warnings: Finding[] = [...checked.findings];
  const result = (partial: Partial<StatementResult>): StatementResult => {
    warnings.push(...rulesStatus(rules));
    const exportable = !warnings.some((w) => w.severity === 'block');
    return {
      svg: null,
      values: null,
      metrics: null,
      options: checked.options,
      rulesVersion: rules.version,
      ...partial,
      warnings,
      exportable,
    };
  };

  if (!checked.inputs || !checked.options)
    return { result: result({}), layout: null, content: null };

  const values = computeValues(checked.inputs, checked.options, rules);
  warnings.push(...validateValues(checked.inputs, values, rules));
  const content = panelContent(values, checked.options, rules);
  const layout = layoutPanel(content, checked.options.width_mm, rules.values.min_rule_weight_pt);
  warnings.push(...validateLayout(layout, checked.options, rules));

  const blocked = warnings.some((w) => w.severity === 'block');
  const svg = blocked
    ? null
    : renderSvg(layout, checked.options.colour, {
        title: content.title,
        description: describePanel(content),
        rulesVersion: rules.version,
      });
  return { result: result({ svg, values, metrics: layout.metrics }), layout, content };
}

/**
 * Turns a producer's values into the prescribed FSANZ energy statement as outlined SVG artwork.
 * Pure and deterministic: the same inputs, options and rules always give byte-identical SVG.
 * `svg` is null whenever a finding blocks export; `values` and `metrics` are still returned when
 * the inputs could be computed, so a preview can explain what is wrong.
 */
export function buildStatement(
  inputs: StatementInputs,
  options: StatementOptions,
  rules: EnergyStatementRules,
): StatementResult {
  return planStatement(inputs, options, rules).result;
}
