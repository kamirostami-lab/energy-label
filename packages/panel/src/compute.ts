// The section 7 formulas of Build Brief 01. Constants come from the rules file, never from here.
import type { EnergyStatementRules } from '@energy-panel/rules';
import { formatFixed, formatSignificant, formatUpTo, isWholeNumber } from './decimal.ts';
import type { ResolvedOptions, StatementInputs, StatementValues } from './types.ts';

/** Inputs that passed validation: every number needed for the panel is present and finite. */
export type ComputableInputs = StatementInputs & { kj_per_100ml: number };

/** Standard drinks in `volumeMl` of a beverage at `abv` per cent, unrounded. */
export function standardDrinks(volumeMl: number, abv: number, rules: EnergyStatementRules): number {
  const { ethanol_density_g_per_ml: density, standard_drink_ethanol_g: grams } = rules.values;
  return (volumeMl * (abv / 100) * density) / grams;
}

/**
 * The separate statement of standard drinks in the package (Standard 2.7.1—4): required only
 * above the ABV threshold, to the first decimal place up to 10 and the nearest whole number above.
 */
export function packageStandardDrinks(
  total: number,
  abv: number,
  rules: EnergyStatementRules,
): string | null {
  const rule = rules.values.package_standard_drinks;
  if (abv <= rule.required_above_abv_percent) return null;
  // Compared on the decimal value, so binary noise cannot push exactly 10 over the threshold.
  return Number(formatSignificant(total, 15)) > rule.whole_number_above
    ? formatUpTo(total, 0)
    : formatFixed(total, rule.decimal_places);
}

export function computeValues(
  inputs: ComputableInputs,
  options: ResolvedOptions,
  rules: EnergyStatementRules,
): StatementValues {
  const v = rules.values;
  const figures = options.significant_figures;
  const withCal = options.energy_units === 'kj_cal';

  const servingsComputed = inputs.package_ml / inputs.serving_ml;
  const servings = inputs.servings ?? servingsComputed;
  const standardDrinksPerServing = standardDrinks(inputs.serving_ml, inputs.abv, rules);
  const totalStandardDrinks = standardDrinks(inputs.package_ml, inputs.abv, rules);
  const energyPerServingKj = (inputs.kj_per_100ml * inputs.serving_ml) / 100;
  const energyPer100mlKj = inputs.kj_per_100ml;
  const energyPerServingCal = withCal ? energyPerServingKj / v.kj_per_cal : null;
  const energyPer100mlCal = withCal ? energyPer100mlKj / v.kj_per_cal : null;

  const sig = (value: number | null) => (value === null ? null : formatSignificant(value, figures));

  return {
    servings,
    servingsComputed,
    standardDrinksPerServing,
    totalStandardDrinks,
    energyPerServingKj,
    energyPer100mlKj,
    energyPerServingCal,
    energyPer100mlCal,
    display: {
      servingsPerPackage: isWholeNumber(servings)
        ? formatUpTo(servings, 0)
        : formatFixed(servings, v.servings_decimal_places),
      servingSizeMl: formatUpTo(inputs.serving_ml, 1),
      // One decimal place; whole numbers without ".0" when the rules say so ("1 standard drink").
      standardDrinksPerServing: v.standard_drinks_trim_trailing_zero
        ? formatUpTo(standardDrinksPerServing, v.standard_drinks_decimal_places)
        : formatFixed(standardDrinksPerServing, v.standard_drinks_decimal_places),
      energyPerServingKj: formatSignificant(energyPerServingKj, figures),
      energyPer100mlKj: formatSignificant(energyPer100mlKj, figures),
      energyPerServingCal: sig(energyPerServingCal),
      energyPer100mlCal: sig(energyPer100mlCal),
      totalStandardDrinks: packageStandardDrinks(totalStandardDrinks, inputs.abv, rules),
    },
  };
}
