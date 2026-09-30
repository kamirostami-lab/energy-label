// Validation states from Build Brief 01 section 7, plus the input checks the renderer relies on.
// Messages are user-facing copy: plain Australian English, saying what to do next.
import { listUnverified, type EnergyStatementRules } from '@energy-panel/rules';
import type { ComputableInputs } from './compute.ts';
import { decimalPlaces, formatFixed, formatUpTo, isWholeNumber } from './decimal.ts';
import { FONT, WIDTH_LIMITS_MM, overflowingText, type PanelLayout } from './layout.ts';
import { unsupportedCharacters } from './text.ts';
import type {
  ColourVariant,
  EnergyUnits,
  Finding,
  FindingCode,
  ResolvedOptions,
  Severity,
  StatementInputs,
  StatementOptions,
  StatementValues,
} from './types.ts';

export const COLOUR_VARIANTS: readonly ColourVariant[] = ['black', 'white', 'spot'];
export const ENERGY_UNITS: readonly EnergyUnits[] = ['kj', 'kj_cal'];
export const PACKAGE_WORD_MAX_LENGTH = 24;
/** Relative difference tolerated between an entered Cal value and kJ / 4.184. */
const CAL_TOLERANCE = 0.01;

type Field = Finding['field'];

function finding(code: FindingCode, severity: Severity, message: string, field?: Field): Finding {
  return field === undefined ? { code, severity, message } : { code, severity, message, field };
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const isAbsent = (value: unknown) => value === undefined || value === null;
/** "a, b or c" */
const orList = (items: readonly string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;

export interface CheckedInputs {
  findings: Finding[];
  /** Null when the numbers needed to compute the panel are missing or invalid. */
  inputs: ComputableInputs | null;
  /** Null when an option is invalid. */
  options: ResolvedOptions | null;
}

export function validateInputs(
  inputs: StatementInputs,
  options: StatementOptions,
  rules: EnergyStatementRules,
): CheckedInputs {
  const v = rules.values;
  const findings: Finding[] = [];
  let computable = true;
  const invalid = (field: Field, message: string) => {
    findings.push(finding('INPUT_INVALID', 'block', message, field));
    computable = false;
  };

  // Numbers the formulas need
  const { abv, package_ml, serving_ml, servings, kj_per_100ml, cal_per_100ml } = inputs;
  const standardised = inputs.standardised_beverage;
  if (!isAbsent(standardised) && typeof standardised !== 'boolean') {
    invalid(
      'standardised_beverage',
      'Say whether the product is a standardised alcoholic beverage: true or false.',
    );
  }
  const threshold = formatUpTo(v.min_abv_percent, 2);
  if (!isNumber(abv) || abv < 0 || abv > 100) {
    invalid('abv', 'Enter the alcohol content as a percentage between 0 and 100.');
  } else if (abv < v.min_abv_percent && standardised !== true) {
    // A prescribed beverage is a standardised alcoholic beverage at any ABV, or any other
    // beverage from the threshold up (Standard 2.7.1—2).
    findings.push(
      standardised === false
        ? finding(
            'ABV_BELOW_THRESHOLD',
            'block',
            `An energy statement is not required. At ${formatUpTo(abv, 2)}% ABV this is not a prescribed beverage: the statement applies from ${threshold}% ABV, and to standardised alcoholic beverages at any strength.`,
            'abv',
          )
        : finding(
            'STANDARDISED_BEVERAGE_UNCONFIRMED',
            'block',
            `Below ${threshold}% ABV an energy statement is required only for standardised alcoholic beverages (${orList(v.standardised_alcoholic_beverages)}), including their low- and no-alcohol versions. Say whether this product is one of them.`,
            'standardised_beverage',
          ),
    );
  }
  if (!isNumber(package_ml) || package_ml <= 0) {
    invalid('package_ml', 'Enter the package volume in mL.');
  }
  if (!isNumber(serving_ml) || serving_ml <= 0) {
    invalid('serving_ml', 'Enter the serving size in mL.');
  } else if (decimalPlaces(serving_ml) > 1) {
    findings.push(
      finding(
        'SERVING_SIZE_PRECISION',
        'block',
        'Enter the serving size in mL to no more than one decimal place.',
        'serving_ml',
      ),
    );
  } else if (isNumber(package_ml) && package_ml > 0 && serving_ml > package_ml) {
    findings.push(
      finding(
        'SERVING_EXCEEDS_PACKAGE',
        'block',
        'The serving size is larger than the package. Check both volumes.',
        'serving_ml',
      ),
    );
  }
  if (!isAbsent(servings) && (!isNumber(servings) || servings <= 0)) {
    invalid('servings', 'Servings per package must be a number greater than zero.');
  }
  if (isAbsent(kj_per_100ml)) {
    findings.push(
      finding(
        'KJ_MISSING',
        'block',
        'Enter the average energy in kJ per 100 mL, for example from the FSANZ alcohol energy content calculator.',
        'kj_per_100ml',
      ),
    );
    computable = false;
  } else if (!isNumber(kj_per_100ml) || kj_per_100ml <= 0) {
    invalid('kj_per_100ml', 'Energy in kJ per 100 mL must be a number greater than zero.');
  }
  if (!isAbsent(cal_per_100ml) && (!isNumber(cal_per_100ml) || cal_per_100ml <= 0)) {
    invalid('cal_per_100ml', 'Energy in Cal per 100 mL must be a number greater than zero.');
  }

  // Exemption conditions: warn, never block
  const area = inputs.package_surface_area_cm2;
  const smallPackage = v.exemptions.find((e) => e.code === 'small_package');
  if (!isAbsent(area)) {
    if (!isNumber(area) || area <= 0) {
      invalid(
        'package_surface_area_cm2',
        'Package surface area must be a number greater than zero.',
      );
    } else if (
      smallPackage?.max_surface_area_cm2 !== undefined &&
      area < smallPackage.max_surface_area_cm2
    ) {
      findings.push(
        finding(
          'SMALL_PACKAGE_EXEMPTION',
          'warning',
          `A beverage for sale in a small package, with a surface area under ${smallPackage.max_surface_area_cm2} cm², does not need an energy statement (Standard 2.7.1—4A). Confirm the measurement before relying on the exemption.`,
          'package_surface_area_cm2',
        ),
      );
    }
  }
  if (!isAbsent(inputs.nip_displayed) && typeof inputs.nip_displayed !== 'boolean') {
    invalid('nip_displayed', 'The nutrition information panel flag must be true or false.');
  } else if (inputs.nip_displayed === true) {
    findings.push(
      finding(
        'NIP_DISPLAYED',
        'warning',
        'An energy statement is not required where the label has a nutrition information panel required by Standard 1.2.8, or a voluntary one that complies with section 2.7.1—4E, including standard drinks per serving.',
        'nip_displayed',
      ),
    );
  }

  const resolved = resolveOptions(options, rules, findings);
  return {
    findings,
    inputs: computable ? (inputs as ComputableInputs) : null,
    options: resolved,
  };
}

function resolveOptions(
  options: StatementOptions,
  rules: EnergyStatementRules,
  findings: Finding[],
): ResolvedOptions | null {
  const v = rules.values;
  let valid = true;
  const block = (code: FindingCode, field: Field, message: string) => {
    findings.push(finding(code, 'block', message, field));
    valid = false;
  };

  const width = options.width_mm;
  if (!isNumber(width) || width < WIDTH_LIMITS_MM.min || width > WIDTH_LIMITS_MM.max) {
    block(
      'WIDTH_OUT_OF_RANGE',
      'width_mm',
      `Choose a panel width between ${WIDTH_LIMITS_MM.min} and ${WIDTH_LIMITS_MM.max} mm.`,
    );
  }

  const colour = options.colour ?? 'black';
  if (!COLOUR_VARIANTS.includes(colour)) {
    block('INPUT_INVALID', 'colour', 'Choose black, white or spot colour artwork.');
  }

  const units = options.energy_units ?? 'kj';
  if (!ENERGY_UNITS.includes(units)) {
    block('INPUT_INVALID', 'energy_units', 'Choose kJ only, or kJ and Cal.');
  }

  const figures = options.significant_figures ?? v.max_significant_figures;
  if (!Number.isInteger(figures) || figures < 1) {
    block(
      'INPUT_INVALID',
      'significant_figures',
      'Significant figures must be a whole number of at least 1.',
    );
  } else if (figures > v.max_significant_figures) {
    block(
      'PRECISION_ABOVE_MAXIMUM',
      'significant_figures',
      `Energy values can be shown to no more than ${v.max_significant_figures} significant figures.`,
    );
  }

  const rawWord: unknown = options.package_word ?? v.package_word.default;
  const word = typeof rawWord === 'string' ? rawWord.trim().replace(/\s+/g, ' ') : '';
  const listed = word === v.package_word.default || v.package_word.alternatives.includes(word);
  const missing = unsupportedCharacters(FONT, word);
  if (word === '') {
    block('PACKAGE_WORD_INVALID', 'package_word', 'Enter the word to use for the package.');
  } else if (!listed && !v.package_word.custom_allowed) {
    block(
      'PACKAGE_WORD_INVALID',
      'package_word',
      `Choose one of: ${[v.package_word.default, ...v.package_word.alternatives].join(', ')}.`,
    );
  } else if ([...word].length > PACKAGE_WORD_MAX_LENGTH) {
    block(
      'PACKAGE_WORD_INVALID',
      'package_word',
      `Keep the package word to ${PACKAGE_WORD_MAX_LENGTH} characters or fewer.`,
    );
  } else if (missing.length > 0) {
    block(
      'PACKAGE_WORD_INVALID',
      'package_word',
      `The package word uses characters the artwork typeface does not include: ${missing.join(' ')}`,
    );
  }

  return valid
    ? {
        width_mm: width,
        colour,
        energy_units: units,
        package_word: word,
        significant_figures: figures,
      }
    : null;
}

/** Findings that depend on computed values. */
export function validateValues(
  inputs: ComputableInputs,
  values: StatementValues,
  rules: EnergyStatementRules,
): Finding[] {
  const v = rules.values;
  const findings: Finding[] = [];
  if (!isWholeNumber(values.servings)) {
    findings.push(
      finding(
        'SERVINGS_NOT_WHOLE',
        'note',
        `Servings per package is not a whole number, so it is shown to ${v.servings_decimal_places} decimal place${v.servings_decimal_places === 1 ? '' : 's'} (${values.display.servingsPerPackage}).`,
        'servings',
      ),
    );
  }
  if (
    !isAbsent(inputs.servings) &&
    formatFixed(values.servings, v.servings_decimal_places) !==
      formatFixed(values.servingsComputed, v.servings_decimal_places)
  ) {
    findings.push(
      finding(
        'SERVINGS_OVERRIDE_DIFFERS',
        'warning',
        `Servings per package (${values.display.servingsPerPackage}) differs from package volume ÷ serving size (${formatFixed(values.servingsComputed, v.servings_decimal_places)}). Check the override.`,
        'servings',
      ),
    );
  }
  // Below the threshold only standardised beverages get this far, and 0 is expected for them.
  if (inputs.abv >= v.min_abv_percent && Number(values.display.standardDrinksPerServing) === 0) {
    findings.push(
      finding(
        'STANDARD_DRINKS_ROUND_TO_ZERO',
        'warning',
        'Standard drinks per serving round to zero at one decimal place. Check the serving size and alcohol content.',
        'serving_ml',
      ),
    );
  }
  if (isNumber(inputs.cal_per_100ml)) {
    const expected = inputs.kj_per_100ml / v.kj_per_cal;
    if (Math.abs(inputs.cal_per_100ml - expected) > expected * CAL_TOLERANCE) {
      findings.push(
        finding(
          'CAL_MISMATCH',
          'warning',
          `The Cal per 100 mL entered (${formatUpTo(inputs.cal_per_100ml, 2)}) does not match the kJ value (${formatUpTo(inputs.kj_per_100ml, 2)} kJ is ${formatUpTo(expected, 1)} Cal). The panel uses kJ ÷ ${v.kj_per_cal}; check both values.`,
          'cal_per_100ml',
        ),
      );
    }
  }
  return findings;
}

/** Findings that depend on the laid-out panel: minimum type size and text that cannot fit. */
export function validateLayout(
  layout: PanelLayout,
  options: ResolvedOptions,
  rules: EnergyStatementRules,
): Finding[] {
  const findings: Finding[] = [];
  const minimum = rules.values.min_type_size;
  if (minimum !== null) {
    const measured =
      minimum.measure === 'cap_height' ? layout.metrics.capHeightMm : layout.metrics.xHeightMm;
    if (measured < minimum.size_mm) {
      // Type scales with width, so the smallest compliant width follows directly.
      const neededWidth = Math.ceil(((options.width_mm * minimum.size_mm) / measured) * 10) / 10;
      findings.push(
        finding(
          'TYPE_BELOW_MINIMUM',
          'block',
          `At ${formatUpTo(options.width_mm, 1)} mm wide the smallest type is ${formatUpTo(measured, 2)} mm (${minimum.measure.replace('_', ' ')}), below the ${formatUpTo(minimum.size_mm, 2)} mm minimum. Choose a width of at least ${formatUpTo(neededWidth, 1)} mm.`,
          'width_mm',
        ),
      );
    }
  }
  if (overflowingText(layout).length > 0) {
    // Type scales with the panel, so a wider panel never helps: the text itself must be shorter.
    findings.push(
      finding(
        'TEXT_OVERFLOW',
        'block',
        'Some text is too long to fit in its cell. Check the values entered and use a shorter package word.',
      ),
    );
  }
  return findings;
}

/** A reminder that stays on every result until a person verifies the rules file. */
export function rulesStatus(rules: EnergyStatementRules): Finding[] {
  const unverified = listUnverified(rules);
  if (unverified.length === 0) return [];
  return [
    finding(
      'RULES_UNVERIFIED',
      'note',
      `Rules version ${rules.version} has ${unverified.length} rule${unverified.length === 1 ? '' : 's'} not yet verified against the FSANZ sources. Do not issue artwork to customers until they are verified.`,
    ),
  ];
}
