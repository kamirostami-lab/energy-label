// Turns the generator's form state into API requests. Kept free of Svelte so it can be tested.
import type {
  BeverageTypeId,
  ColourVariant,
  EnergyUnits,
  StatementInputs,
  StatementOptions,
} from '@energy-panel/panel';

export interface FormState {
  beverage: BeverageTypeId;
  abv: string;
  packageMl: string;
  /** A preset serving in mL, or "custom" to use servingCustom. */
  serving: string;
  servingCustom: string;
  /** Empty to use package volume ÷ serving size. */
  servings: string;
  kj: string;
  cal: string;
  area: string;
  nip: boolean;
  standardised: '' | 'yes' | 'no';
  /** A preset width in mm, or "custom" to use widthCustom. */
  width: string;
  widthCustom: string;
  colour: ColourVariant;
  units: EnergyUnits;
  /** A listed package word, or "custom" to use packageWordCustom. */
  packageWord: string;
  packageWordCustom: string;
}

/** Empty text is null (not entered); anything unparseable is NaN, which the validator rejects. */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(trimmed) ? Number(trimmed) : Number.NaN;
}

const asJsonNumber = (value: number | null) =>
  value === null || Number.isNaN(value) ? null : value;

export function statementRequest(state: FormState): {
  inputs: StatementInputs;
  options: StatementOptions;
} {
  const serving = state.serving === 'custom' ? state.servingCustom : state.serving;
  const width = state.width === 'custom' ? state.widthCustom : state.width;
  const word = state.packageWord === 'custom' ? state.packageWordCustom : state.packageWord;
  const inputs = {
    abv: parseNumber(state.abv),
    package_ml: parseNumber(state.packageMl),
    serving_ml: parseNumber(serving),
    servings: parseNumber(state.servings),
    kj_per_100ml: parseNumber(state.kj),
    cal_per_100ml: parseNumber(state.cal),
    package_surface_area_cm2: parseNumber(state.area),
    nip_displayed: state.nip,
    standardised_beverage: state.standardised === '' ? null : state.standardised === 'yes',
  };
  return {
    // NaN has no JSON form; the validator reports a missing value with the same guidance.
    inputs: Object.fromEntries(
      Object.entries(inputs).map(([k, v]) => [k, typeof v === 'number' ? asJsonNumber(v) : v]),
    ) as unknown as StatementInputs,
    options: {
      width_mm: asJsonNumber(parseNumber(width)) as number,
      colour: state.colour,
      energy_units: state.units,
      package_word: word.trim(),
    },
  };
}

/** Today's date where the visitor is, as YYYY-MM-DD. */
export function localDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** File bytes from the API's base64. */
export function fromBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** "18.6 KB" */
export function formatSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(1)} KB`;
}
