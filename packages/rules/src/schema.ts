import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected a date as YYYY-MM-DD');
const semver = z.string().regex(/^\d+\.\d+\.\d+$/, 'expected a version as MAJOR.MINOR.PATCH');

export const JURISDICTIONS = ['AU', 'NZ'] as const;
export const EXEMPTION_CODES = [
  'nip_displayed',
  'small_package',
  'not_required_to_bear_label',
] as const;
export const TYPE_SIZE_MEASURES = ['cap_height', 'x_height'] as const;

const sourceSchema = z
  .object({
    title: z.string().min(1),
    publisher: z.string().min(1),
    url: z.url().nullable(),
    kind: z.enum([
      'studio',
      'regulator_guidance',
      'regulator_proposal',
      'legislation',
      'industry_guidance',
      'regulator_tool',
    ]),
    /** SHA-256 of the copy a person read when verifying, so the check can be repeated. */
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/, 'expected a lower-case hex SHA-256')
      .optional(),
    notes: z.string().optional(),
  })
  .strict();

/** Every rule carries its value, where it came from and when a person last checked it. */
function entry<T extends z.ZodType>(value: T) {
  return z
    .object({
      value,
      sources: z.array(z.string().min(1)).min(1),
      /** Where in the sources the value is stated: section, clause, page. */
      locator: z.string().min(1).optional(),
      notes: z.string().optional(),
      verified_at: isoDate.nullable(),
    })
    .strict();
}

const text = z.string().min(1);

const rulesSchema = z
  .object({
    gazettal_date: entry(isoDate),
    compliance_date: entry(isoDate),
    min_abv_percent: entry(z.number().positive()),
    standardised_alcoholic_beverages: entry(z.array(text).min(1)),
    exemptions: entry(
      z
        .array(
          z
            .object({
              code: z.enum(EXEMPTION_CODES),
              description: text,
              max_surface_area_cm2: z.number().positive().optional(),
            })
            .strict(),
        )
        .min(1),
    ),
    title_text: entry(text),
    table_with_borders: entry(z.literal(true)),
    labels: entry(
      z
        .object({
          servings_per_package: text.includes('{package}'),
          serving_size: text,
          energy: text,
        })
        .strict(),
    ),
    standard_drinks_words: entry(z.object({ singular: text, plural: text }).strict()),
    column_headings: entry(z.object({ per_serving: text, per_100ml: text }).strict()),
    serving_size_unit: entry(z.literal('mL')),
    energy_units: entry(
      z.object({ required: z.literal('kJ'), optional: z.literal('Cal') }).strict(),
    ),
    max_significant_figures: entry(z.number().int().min(1).max(6)),
    standard_drinks_decimal_places: entry(z.number().int().min(0).max(3)),
    standard_drinks_trim_trailing_zero: entry(z.boolean()),
    package_word: entry(
      z
        .object({
          default: text,
          alternatives: z.array(text),
          custom_allowed: z.boolean(),
        })
        .strict(),
    ),
    existing_duties: entry(z.array(text).min(1)),
    package_standard_drinks: entry(
      z
        .object({
          required_above_abv_percent: z.number().nonnegative(),
          decimal_places: z.number().int().min(0).max(3),
          whole_number_above: z.number().positive(),
        })
        .strict(),
    ),
    standard_drink_ethanol_g: entry(z.number().positive()),
    ethanol_density_g_per_ml: entry(z.number().positive()),
    alcohol_energy_kj_per_g: entry(z.number().positive()),
    kj_per_cal: entry(z.number().positive()),
    servings_decimal_places: entry(z.number().int().min(0).max(3)),
    min_rule_weight_pt: entry(z.number().positive()),
    min_type_size: entry(
      z
        .object({ size_mm: z.number().positive(), measure: z.enum(TYPE_SIZE_MEASURES) })
        .strict()
        .nullable(),
    ),
  })
  .strict();

export const rulesFileSchema = z
  .object({
    rules_id: z.literal('fsanz-energy-statement'),
    version: semver,
    title: text,
    jurisdictions: z.array(z.enum(JURISDICTIONS)).min(1),
    versions: z.array(z.object({ version: semver, date: isoDate, notes: text }).strict()).min(1),
    sources: z.record(z.string(), sourceSchema),
    rules: rulesSchema,
  })
  .strict()
  .superRefine((file, ctx) => {
    for (const [id, source] of Object.entries(file.sources)) {
      if (source.kind !== 'studio' && source.url === null && source.sha256 === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['sources', id],
          message: 'an external source needs a url or the sha256 of the copy that was read',
        });
      }
    }
    for (const [key, rule] of Object.entries(file.rules)) {
      for (const source of rule.sources) {
        if (!(source in file.sources)) {
          ctx.addIssue({
            code: 'custom',
            path: ['rules', key, 'sources'],
            message: `unknown source "${source}"`,
          });
        }
      }
      const external = rule.sources.some((id) => file.sources[id]?.kind !== 'studio');
      if (rule.verified_at !== null && external && rule.locator === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['rules', key, 'locator'],
          message: 'a rule verified against an external source needs a locator (section or page)',
        });
      }
    }
    const latest = file.versions.at(-1);
    if (latest?.version !== file.version) {
      ctx.addIssue({
        code: 'custom',
        path: ['versions'],
        message: `the last versions[] entry must describe the current version ${file.version}`,
      });
    }
    const smallPackage = file.rules.exemptions.value.find((e) => e.code === 'small_package');
    if (smallPackage && smallPackage.max_surface_area_cm2 === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['rules', 'exemptions', 'value'],
        message: 'the small_package exemption needs max_surface_area_cm2',
      });
    }
  });

export type RulesFile = z.infer<typeof rulesFileSchema>;
export type RuleKey = keyof RulesFile['rules'];
export type RuleValues = { [K in RuleKey]: RulesFile['rules'][K]['value'] };
export type Jurisdiction = (typeof JURISDICTIONS)[number];
export type ExemptionCode = (typeof EXEMPTION_CODES)[number];
