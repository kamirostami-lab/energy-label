// Request bodies. Shapes are checked here; values are left to the panel's validator, whose
// findings are the user-facing copy (an empty ABV field arrives as null and gets its message).
import { z } from 'zod';

const maybeNumber = z.number().nullish();
const maybeBoolean = z.boolean().nullish();

export const inputsSchema = z
  .object({
    abv: maybeNumber,
    package_ml: maybeNumber,
    serving_ml: maybeNumber,
    servings: maybeNumber,
    kj_per_100ml: maybeNumber,
    cal_per_100ml: maybeNumber,
    package_surface_area_cm2: maybeNumber,
    nip_displayed: maybeBoolean,
    standardised_beverage: maybeBoolean,
  })
  .strict();

export const optionsSchema = z
  .object({
    width_mm: maybeNumber,
    colour: z.string().max(16).optional(),
    energy_units: z.string().max(16).optional(),
    package_word: z.string().max(64).optional(),
    significant_figures: z.number().int().optional(),
  })
  .strict();

export const previewRequestSchema = z
  .object({
    inputs: inputsSchema,
    options: optionsSchema,
    /** Device pixels per mm the screen will show the preview at. */
    pxPerMm: z.number().positive().max(1000).optional(),
  })
  .strict();

export const exportRequestSchema = z
  .object({
    inputs: inputsSchema,
    options: optionsSchema,
    details: z
      .object({
        producer: z.string().max(200),
        sku: z.string().max(200),
        vintageOrBatch: z.string().max(200).optional(),
        /** The visitor's local date as YYYY-MM-DD; used when within a day of the server's. */
        issuedOn: z.string().max(10).optional(),
      })
      .strict(),
  })
  .strict();

export type PreviewRequest = z.infer<typeof previewRequestSchema>;
export type ExportRequestBody = z.infer<typeof exportRequestSchema>;

export const skuBodySchema = z
  .object({
    name: z.string().max(200),
    producer: z.string().max(200).nullish(),
    beverageType: z.string().max(32).nullish(),
    vintageOrBatch: z.string().max(200).nullish(),
    inputs: inputsSchema,
    options: optionsSchema,
  })
  .strict();

export const accountExportSchema = z
  .object({
    /** The visitor's local date as YYYY-MM-DD; used when within a day of the server's. */
    issuedOn: z.string().max(10).optional(),
  })
  .strict();

export type SkuBody = z.infer<typeof skuBodySchema>;
