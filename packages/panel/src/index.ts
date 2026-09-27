export { buildStatement, describePanel, panelContent } from './build-statement.ts';
export { computeValues, standardDrinks } from './compute.ts';
export {
  countSignificantFigures,
  formatFixed,
  formatSignificant,
  formatUpTo,
  isWholeNumber,
} from './decimal.ts';
export { CHARSET } from './font/charset.ts';
export { LAYOUT, PRESET_WIDTHS_MM, WIDTH_LIMITS_MM, layoutPanel } from './layout.ts';
export { SPOT_COLOUR_NAME, renderSvg } from './svg.ts';
export {
  COLOUR_VARIANTS,
  ENERGY_UNITS,
  PACKAGE_WORD_MAX_LENGTH,
  validateInputs,
} from './validate.ts';
export type {
  ColourVariant,
  EnergyUnits,
  Finding,
  FindingCode,
  PanelMetrics,
  ResolvedOptions,
  Severity,
  StatementInputs,
  StatementOptions,
  StatementResult,
  StatementValues,
} from './types.ts';
