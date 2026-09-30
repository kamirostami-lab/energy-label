# Energy Panel

FSANZ alcohol energy statement generator and label preflight, built by Komms-Haus from
**Build Brief 01** (25 September 2026). The tool turns a producer's values into the prescribed
`ENERGY INFORMATION` table as press-ready artwork. It formats the statement; the producer remains
responsible for compliance, and every screen must say so.

## Status

| Session | Work                                                                                        | State              |
| ------- | ------------------------------------------------------------------------------------------- | ------------------ |
| 1       | Monorepo, `rules/fsanz-energy-statement.json`, `packages/panel` SVG builder, golden fixture | Done (rules 1.0.0) |
| 2       | PDF export with pdf-lib, outlined text, PDF/X-4 metadata; proof sheet                       | Next               |
| 3       | SvelteKit generator, live preview, validation states, export bar; Pages preview             |                    |
| 4       | D1 migrations, magic-link auth (Resend), SKU records, exports to R2                         |                    |
| 5       | Stripe Checkout and Portal, webhooks, entitlements                                          |                    |
| 6       | Printer profiles, subdomain routing, branding, job history                                  |                    |
| 7       | Checklist from `rules/anz-label-elements.json`, tick record, CSV export                     |                    |
| 8       | Accessibility pass, error copy, rate limiting, logging, production deploy                   |                    |

**Rules status (1.0.0): all 23 rules verified.** 21 against the Code amendment (Gazette FSC 181,
Amendment No. 241), the FSANZ guidance of February 2026 and the Wine Australia fact sheet v1.2;
each source records the SHA-256 of the copy read and each rule a locator (section, clause or
page). The two formula constants no regulatory source states, `ethanol_density_g_per_ml` (0.789)
and `kj_per_cal` (4.184), were accepted by Komms-Haus as physical constants on 30 September 2026.
Should a rule ever lose its verification, `pnpm rules:check --strict` fails and every
`buildStatement` result carries a `RULES_UNVERIFIED` note.

The sources corrected Build Brief 01 in three places, now reflected in code and rules:

- **Standard drinks sit in the serving-size line**, in brackets: `Serving size: 60 mL (1 standard
drink)`. There is no separate "Standard drinks per serving" line (Standard 2.7.1—4B(3)).
- **Standardised alcoholic beverages need the statement at any ABV**, including versions under
  0.5% (Standard 2.7.1—2; guidance p. 1). Below 0.5% ABV the input `standardised_beverage`
  decides: true renders, false blocks as not required, unset blocks until confirmed.
- **Existing duties**: only the separate statement of standard drinks in the package is required
  elsewhere, and it must not appear inside the energy statement (Standard 2.7.1—4(1A)). The
  brief's "alcohol content" is not in these sources and was dropped from the rule.

## Layout

```
rules/fsanz-energy-statement.json   regulatory values, each with sources and verified_at
packages/rules/                     schema (zod), loader, verification status, rules:check CLI
packages/panel/                     buildStatement(): compute, validate, lay out, outline, SVG
  fonts/                            pinned IBM Plex Sans Regular OTF (v3.005) + OFL licence
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
  and never gains trailing zeros (70.985 → 71, not 71.0). Standard drinks are accurate to one
  decimal; whole numbers drop the ".0" as in the FSANZ example (`standard_drinks_trim_trailing_zero`),
  and exactly 1 takes the singular "standard drink".
- **Layout** (`src/layout.ts`) follows the prescribed format (Standard 2.7.1—4B(3)): a bordered
  box, heading centred and not bold, servings and serving-size lines, a rule, the column
  headings, a rule, the Energy row; no rule under the heading, no rules between columns. "kJ
  (Cal)" sits on one line when both cells fit, otherwise Cal goes under kJ in both. Proportions
  are ours: type = width ÷ 22 (larger than the FSANZ example's, for small labels), rules 0.5 pt
  at 50 mm and never below the rules minimum (0.25 pt), drawn as filled rectangles so they scale
  with the artwork. Lines never break inside brackets or between a number and its unit.
- **Text is outlined** from glyph data generated from the pinned OTF; no font reaches the
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

## Open items

- The FSANZ example states no ABV; the golden fixture uses 21.1% (1.0 standard drink per 60 mL).
- Optional Code features not offered yet: expressing under 40 kJ as "LESS THAN 40 kJ"
  (Standard 2.7.1—4C(4)) and percentage daily intake (2.7.1—4D).
- No minimum type size applies beyond general legibility (guidance p. 6; fact sheet p. 7), so
  `min_type_size` is null by design; the check stays in place should that change.
- Session 3 presets: the fact sheet (p. 5) cites Department of Health serves of 100 mL
  (standard) and 150 mL (restaurant) for wine and 60 mL for fortified wine.
