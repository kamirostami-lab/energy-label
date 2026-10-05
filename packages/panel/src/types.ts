/**
 * Values a producer already has. Field names match the SKU and export records (snake_case) so
 * a stored inputs_json replays through buildStatement unchanged.
 */
export interface StatementInputs {
  /** Alcohol by volume, per cent. */
  abv: number;
  /** Package volume in mL. */
  package_ml: number;
  /** Serving size in mL, to at most one decimal place. */
  serving_ml: number;
  /** Servings per package. Defaults to package_ml / serving_ml; the user may override it. */
  servings?: number | null;
  /** Average energy in kJ per 100 mL, for example from the FSANZ calculator. Required to export. */
  kj_per_100ml?: number | null;
  /** Optional Cal per 100 mL from the same source. Only used to cross-check kj_per_100ml. */
  cal_per_100ml?: number | null;
  /** Optional package surface area in cm², to flag the small-package exemption. */
  package_surface_area_cm2?: number | null;
  /** Optional flag: the label already displays a nutrition information panel. */
  nip_displayed?: boolean | null;
  /**
   * Whether the product is a standardised alcoholic beverage (beer, wine, cider, spirit and the
   * others listed in the rules file). Those need the statement at any ABV, other beverages only
   * from 0.5% ABV, so this is consulted only below that threshold.
   */
  standardised_beverage?: boolean | null;
}

/** black (CMYK K in PDF), white on transparent, or a single spot colour named "Panel". */
export type ColourVariant = 'black' | 'white' | 'spot';
/** kJ only, or kJ followed by Cal in brackets. */
export type EnergyUnits = 'kj' | 'kj_cal';

export interface StatementOptions {
  /** Panel width in mm. Height follows content. */
  width_mm: number;
  /** Defaults to black. */
  colour?: ColourVariant;
  /** Defaults to kJ only. */
  energy_units?: EnergyUnits;
  /** Word used in "Servings per …". Defaults to the rules file default ("package"). */
  package_word?: string;
  /** Significant figures for energy values. Defaults to, and may not exceed, the rules maximum. */
  significant_figures?: number;
}

export type ResolvedOptions = Required<StatementOptions>;

/** block stops export; warning and note are shown to the user and allow export. */
export type Severity = 'block' | 'warning' | 'note';

export type FindingCode =
  | 'INPUT_INVALID'
  | 'ABV_BELOW_THRESHOLD'
  | 'STANDARDISED_BEVERAGE_UNCONFIRMED'
  | 'KJ_MISSING'
  | 'SERVING_EXCEEDS_PACKAGE'
  | 'SERVING_SIZE_PRECISION'
  | 'WIDTH_OUT_OF_RANGE'
  | 'PACKAGE_WORD_INVALID'
  | 'PRECISION_ABOVE_MAXIMUM'
  | 'TYPE_BELOW_MINIMUM'
  | 'TEXT_OVERFLOW'
  | 'SMALL_PACKAGE_EXEMPTION'
  | 'NIP_DISPLAYED'
  | 'SERVINGS_NOT_WHOLE'
  | 'SERVINGS_OVERRIDE_DIFFERS'
  | 'STANDARD_DRINKS_ROUND_TO_ZERO'
  | 'CAL_MISMATCH'
  | 'ENERGY_BELOW_ALCOHOL'
  | 'RULES_UNVERIFIED';

export interface Finding {
  code: FindingCode;
  severity: Severity;
  message: string;
  /** Input or option the finding is about, when there is one. */
  field?: keyof StatementInputs | keyof StatementOptions;
}

/** Computed quantities: unrounded numbers plus the exact strings the panel displays. */
export interface StatementValues {
  servings: number;
  servingsComputed: number;
  standardDrinksPerServing: number;
  totalStandardDrinks: number;
  energyPerServingKj: number;
  energyPer100mlKj: number;
  energyPerServingCal: number | null;
  energyPer100mlCal: number | null;
  display: {
    servingsPerPackage: string;
    servingSizeMl: string;
    standardDrinksPerServing: string;
    energyPerServingKj: string;
    energyPer100mlKj: string;
    energyPerServingCal: string | null;
    energyPer100mlCal: string | null;
    /**
     * Standard drinks in the package, for the reminder line outside the panel; never drawn inside
     * it. Null when no statement is required (0.5% ABV or less).
     */
    totalStandardDrinks: string | null;
  };
}

export interface PanelMetrics {
  widthMm: number;
  heightMm: number;
  bodySizeMm: number;
  bodySizePt: number;
  /** Height of capitals and figures in the smallest type on the panel. */
  capHeightMm: number;
  /** Height of lower-case letters in the smallest type on the panel. */
  xHeightMm: number;
  ruleWeightMm: number;
  ruleWeightPt: number;
}

export interface StatementResult {
  /** Outlined SVG artwork, or null while any finding blocks export. */
  svg: string | null;
  /** Every validation finding, in a stable order. Severity 'block' prevents export. */
  warnings: Finding[];
  exportable: boolean;
  /** Present whenever the inputs could be computed, even if export is blocked. */
  values: StatementValues | null;
  metrics: PanelMetrics | null;
  /** Options after defaults were applied; store these with the export record. */
  options: ResolvedOptions | null;
  rulesVersion: string;
}
