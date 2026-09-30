// What the generator screen needs from the rules file and the product settings. The web app reads
// this on the server when it builds the page, so the browser never loads the rules loader.
import {
  BEVERAGE_TYPES,
  PACKAGE_WORD_MAX_LENGTH,
  PRESET_WIDTHS_MM,
  WIDTH_LIMITS_MM,
  type BeverageType,
} from '@energy-panel/panel/settings';
import type { EnergyStatementRules } from '@energy-panel/rules';

export interface GeneratorConfig {
  rulesVersion: string;
  complianceDate: string;
  /** Below this ABV only standardised alcoholic beverages need the statement. */
  minAbvPercent: number;
  standardisedBeverages: readonly string[];
  packageWords: { default: string; alternatives: readonly string[]; customAllowed: boolean };
  packageWordMaxLength: number;
  presetWidthsMm: readonly number[];
  widthLimitsMm: { min: number; max: number };
  beverageTypes: readonly BeverageType[];
  /** The FSANZ alcohol energy content calculator, where producers get kJ per 100 mL. */
  calculatorUrl: string | null;
}

export function generatorConfig(rules: EnergyStatementRules): GeneratorConfig {
  const v = rules.values;
  return {
    rulesVersion: rules.version,
    complianceDate: v.compliance_date,
    minAbvPercent: v.min_abv_percent,
    standardisedBeverages: v.standardised_alcoholic_beverages,
    packageWords: {
      default: v.package_word.default,
      alternatives: v.package_word.alternatives,
      customAllowed: v.package_word.custom_allowed,
    },
    packageWordMaxLength: PACKAGE_WORD_MAX_LENGTH,
    presetWidthsMm: PRESET_WIDTHS_MM,
    widthLimitsMm: WIDTH_LIMITS_MM,
    beverageTypes: BEVERAGE_TYPES,
    calculatorUrl: rules.file.sources.fsanz_energy_calculator?.url ?? null,
  };
}
