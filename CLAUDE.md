# Energy Panel

FSANZ alcohol energy statement generator and label preflight, built by Komms-Haus from
**Build Brief 01** (25 September 2026). The tool turns a producer's values into the prescribed
`ENERGY INFORMATION` table as press-ready artwork. It formats the statement; the producer remains
responsible for compliance, and every screen must say so.

## Status

| Session | Work                                                                                        | State                   |
| ------- | ------------------------------------------------------------------------------------------- | ----------------------- |
| 1       | Monorepo, `rules/fsanz-energy-statement.json`, `packages/panel` SVG builder, golden fixture | Done (rules unverified) |
| 2       | PDF export with pdf-lib, outlined text, PDF/X-4 metadata; proof sheet                       | Next                    |
| 3       | SvelteKit generator, live preview, validation states, export bar; Pages preview             |                         |
| 4       | D1 migrations, magic-link auth (Resend), SKU records, exports to R2                         |                         |
| 5       | Stripe Checkout and Portal, webhooks, entitlements                                          |                         |
| 6       | Printer profiles, subdomain routing, branding, job history                                  |                         |
| 7       | Checklist from `rules/anz-label-elements.json`, tick record, CSV export                     |                         |
| 8       | Accessibility pass, error copy, rate limiting, logging, production deploy                   |                         |

**Blocking before any customer export:** 18 of the 20 rules in `rules/fsanz-energy-statement.json`
have `verified_at: null`. Session 1 could not open the primary sources (the build environment's
network policy blocked `www.foodstandards.gov.au`, `www.wineaustralia.com` and
`www.legislation.gov.au`), so the values are transcribed from Build Brief 01 section 2 and 7.
A person must read each source, correct any value, set `verified_at`, bump `version`, and
regenerate the fixtures. `pnpm rules:check --strict` fails until that is done; every
`buildStatement` result carries a `RULES_UNVERIFIED` note meanwhile.

## Layout

```
rules/fsanz-energy-statement.json   regulatory values, each with sources and verified_at
packages/rules/                     schema (zod), loader, verification status, rules:check CLI
packages/panel/                     buildStatement(): compute, validate, lay out, outline, SVG
  fonts/                            pinned IBM Plex Sans OTFs (v3.005) + OFL licence
  src/font/*.generated.ts           glyph outlines and kerning (pnpm glyphs:build; never edit)
test/fixtures/                      golden inputs (*.json) and reviewed artwork (*.svg)
scripts/                            secrets check, rules-change guard (node:test tests beside them)
apps/web, apps/api, migrations/     not created yet: sessions 3, 2–4 and 4
```

## Commands

```
pnpm install            also points git at .githooks (pre-commit secrets check)
pnpm check              everything CI runs, in order
pnpm test               Vitest in packages, node:test for scripts
pnpm typecheck          tsc (TypeScript 7), package source checked without Node types
pnpm rules:check        validate the rules file; list unverified rules (--strict to fail on them)
pnpm fixtures:update    regenerate test/fixtures/*.svg; review the rendered diff before committing
pnpm glyphs:build       regenerate glyph data after changing the charset or fonts
```

## How the panel works

`buildStatement(inputs, options, rules) -> { svg, warnings, exportable, values, metrics, options }`
in `packages/panel/src/build-statement.ts` is pure and deterministic: the same inputs, options and
rules give byte-identical SVG.

- **Inputs and options are snake_case** to match the D1 `skus` columns and `exports.inputs_json`,
  so a stored record replays unchanged. Store the returned (resolved) `options`, not the request.
- **`svg` is null whenever a finding has severity `block`.** `values` and `metrics` are still
  returned when computable, for the preview. Findings use the codes in `src/types.ts`; messages
  are user-facing copy.
- **Formulas** (brief section 7) live in `src/compute.ts`; every constant comes from the rules file.
- **Rounding** (`src/decimal.ts`) works on the decimal value, half up: 84.85 → 84.9, and a 30 L keg
  at 5% is 118.35 → 118.4 standard drinks. Energy is reduced to at most three significant figures
  and never gains trailing zeros (70.985 → 71, not 71.0). Standard drinks always show one decimal.
- **Layout** (`src/layout.ts`) is proportional: body type = width ÷ 22, everything else in ems,
  rules 0.5 pt at 50 mm and never below the rules minimum (0.25 pt). Rules are filled rectangles,
  so they scale with the artwork. Cal, when shown, sits on a second line in each energy cell.
- **Text is outlined** from glyph data generated from the pinned OTFs; no font reaches the
  artwork. Characters outside `src/font/charset.ts` are rejected, never dropped.
- **SVG**: 1 user unit = 1 mm, `width`/`height` in mm, viewBox equal to the panel bounds, only
  `path` elements with M/L/C/H/V/Z. Colour variants: black `#000000`, white `#FFFFFF`, spot
  (previews black, tagged `data-spot-colour="Panel"`; the PDF export makes the separation).

## Conventions (brief section 11)

- TypeScript throughout; Australian English in copy and comments.
- Nothing regulatory is hard-coded: wording, thresholds and constants come from the rules file.
  Product settings (widths, layout proportions, package-word length) live in `packages/panel`.
- A PR that changes any `rules/*.json` must bump `version`, add a `versions[]` entry and set a new
  `verified_at` on each changed rule. CI enforces this (`scripts/check-rules-change.mjs`).
- Secrets: Wrangler secrets and the Cloudflare dashboard only. `.dev.vars` is git-ignored and the
  pre-commit hook plus CI block secret files and key-shaped strings.
- Generated files: `YYYYMMDD-<org>-<sku>-energy-panel-<width>mm.<ext>` (from session 2).
- Logging: no input values in logs beyond the export id.
- Golden fixtures change only on purpose: rerun `pnpm fixtures:update`, render and compare.

## Decisions (brief section 12)

Defaults apply until Kami records otherwise.

| #   | Decision                | Applied default                                         | Needed by |
| --- | ----------------------- | ------------------------------------------------------- | --------- |
| D1  | Working name and domain | "Energy Panel" (repository is `energy-label`)           | session 3 |
| D2  | Pricing                 | A$12 export; A$24/month; A$240/month                    | session 5 |
| D3  | Free tier               | one watermarked preview export per visitor              | session 3 |
| D4  | Typeface in exports     | IBM Plex Sans, outlined (applied)                       | session 1 |
| D5  | New Zealand rules       | same rules file, `jurisdictions: ["AU","NZ"]` (applied) | session 1 |
| D6  | Printer white-label     | subdomain only                                          | session 6 |

## Open questions for verification

- The FSANZ example's ABV is not in the brief; the golden fixture uses 21.1% (1.0 standard drink
  per 60 mL). Replace it if the guidance states one.
- Exact row wording ("Servings per package", "Serving size", "Standard drinks per serving",
  "Energy"), the colon after each label, bold heading, and "kJ (Cal)" presentation follow NIP
  convention and need checking against the prescribed format.
- Whether the Code sets a minimum type size for the statement, and how it is measured
  (`min_type_size` is null, so no minimum is enforced yet).
