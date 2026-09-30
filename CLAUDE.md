# Energy Panel

FSANZ alcohol energy statement generator and label preflight, built by Komms-Haus from
**Build Brief 01** (25 September 2026). The tool turns a producer's values into the prescribed
`ENERGY INFORMATION` table as press-ready artwork. It formats the statement; the producer remains
responsible for compliance, and every screen must say so.

## Status

| Session | Work                                                                                        | State              |
| ------- | ------------------------------------------------------------------------------------------- | ------------------ |
| 1       | Monorepo, `rules/fsanz-energy-statement.json`, `packages/panel` SVG builder, golden fixture | Done (rules 1.0.0) |
| 2       | PDF export with pdf-lib, outlined text, PDF/X-4 metadata; proof sheet                       | Done               |
| 3       | SvelteKit generator, live preview, validation states, export bar; preview deploy            | Done (see Deploy)  |
| 4       | D1 migrations, magic-link auth (Resend), SKU records, exports to R2                         | Next               |
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
  src/export.ts, pdf.ts, proof.ts   artwork exports (SVG, PDF) and the A4 proof sheet
  src/raster.ts, png.ts, preview.ts server-side preview: watermarked greyscale PNG
  src/settings.ts                   product settings the browser may load (@energy-panel/panel/settings)
  fonts/                            pinned IBM Plex Sans Regular OTF (v3.005) + OFL licence
  src/font/*.generated.ts           glyph outlines and kerning (pnpm glyphs:build; never edit)
  scripts/check-pdfs.ts             Poppler preflight of the exports (pnpm pdf:check)
test/fixtures/                      golden inputs (*.json) and reviewed artwork (*.svg, *.pdf)
apps/api/                           Hono API: /api/preview, /api/export (free preview export)
apps/web/                           SvelteKit generator; one Worker with static assets (wrangler.jsonc)
  tests/                            Playwright: keyboard-only generate flow, axe-core
scripts/                            secrets check, rules-change guard (node:test tests beside them)
migrations/                         not created yet: session 4
```

## Commands

```
pnpm install            also points git at .githooks (pre-commit secrets check)
pnpm check              everything CI's check job runs, in order (the web job is pnpm build + e2e)
pnpm dev                the generator at http://localhost:5173 (Vite; API included)
pnpm build              build the Worker (apps/web/.svelte-kit/cloudflare)
pnpm e2e                Playwright against the built Worker in workerd (wrangler dev on :8787)
pnpm test               Vitest in packages, node:test for scripts
pnpm typecheck          tsc (TypeScript 7), package source checked without Node types
pnpm rules:check        validate the rules file; list unverified rules (--strict to fail on them)
pnpm fixtures:update    regenerate test/fixtures/*.svg and *.pdf; review the renders before committing
pnpm glyphs:build       regenerate glyph data after changing the charset or fonts
pnpm pdf:check          pdffonts and pdfinfo over every PDF variant (needs poppler-utils)
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

## How the exports work

`exportArtwork(inputs, options, rules, { format, issuedOn, org, sku, outputIntent? })` in
`packages/panel/src/export.ts` returns `{ fileName, mediaType, bytes }`, or throws
`ExportBlockedError` carrying the blocking findings. `buildProofSheet(inputs, options, rules,
details)` in `src/proof.ts` does the same for the A4 proof. Both are deterministic: the same
arguments give byte-identical files, and the golden tests compare `test/fixtures/*.pdf` byte for
byte.

- **Formats**: `svg` (the `buildStatement` SVG), `pdf` (PDF 1.6 prepared to PDF/X-4 rules) and
  `pdf14` (PDF 1.4, for workflows that ask for EPS). The page is the panel: MediaBox, TrimBox and
  BleedBox all equal its bounds, so a 35 mm panel is 99.2126 pt wide.
- **No fonts, same geometry as the SVG.** `src/pdf.ts` writes the content streams itself; pdf-lib
  only assembles the document, because its drawing API adds font resources. One matrix maps
  layout millimetres (y down) to points (y up), so the PDF paths carry the SVG's exact numbers,
  and the tests compare them.
- **Colour**: black is CMYK 0/0/0/100; white is CMYK 0/0/0/0, which knocks out to the substrate
  (a job printed with white ink needs the spot variant, mapped to the printer's white); spot is
  100% of the Separation "Panel", whose alternate previews black.
- **Reproducible**: every date comes from `issuedOn`, the document ID is a fingerprint of the
  content, object streams are off, and pdf-lib's fixed `%PDF-1.7` header is patched to the
  declared version (one byte, so no cross-reference offset moves).
- **PDF/X-4 is claimed only with an output intent.** `GTS_PDFXVersion` and `/OutputIntents` are
  written when the request carries an `OutputIntent` (condition identifier, description,
  registry and the CMYK ICC profile). A PDF/X-4 file must embed its printing condition, so
  without one (the default until D7 is decided) the file follows the X-4 rules but claims nothing.
- **Proof sheet** (brief section 8): A4 with the panel at actual size and enlarged 2× (1.5× for
  wide panels, none when neither fits); white panels sit on a 0.8 K backdrop. Then the values
  table (entered, chosen and calculated), the findings as notes, rules version, issue date,
  producer, the printer's name and footer when given, and the responsibility statement. Its text
  is outlined like the artwork, so it needs no fonts but cannot be searched.
- **`pnpm pdf:check`** runs Poppler over both PDF flavours and the proof of every golden fixture
  (all three colours and a 35 mm panel among them): `pdffonts` must list no fonts, and `pdfinfo`
  must read one page of the declared version whose boxes measure the panel. CI installs
  poppler-utils; locally the check skips with a notice when Poppler is missing.

## How the generator works

One Cloudflare Worker (decision D9) serves the prerendered generator page from static assets and
the API under `/api`, where `apps/web/src/routes/api/[...path]/+server.ts` hands every request to
the Hono app in `apps/api`. The page is built from the rules file at build time; the browser never
loads the rules loader or the renderer.

- **The live preview is pixels, never vector artwork** (decision D8). The page posts its inputs to
  `POST /api/preview`, which returns the statement's values and findings (without the SVG) and a
  greyscale PNG with the PREVIEW mark burned in, rendered at the screen's density
  (`src/raster.ts`: exact-area anti-aliasing, non-zero winding). The image is shown at true size
  in CSS millimetres beside a millimetre ruler, at 1×, 2× or 4×.
- **Free tier (D3)**: `POST /api/export` returns a watermarked SVG, PDF, PDF 1.4 and proof sheet,
  once per browser (cookie `ep_free_export`, HttpOnly). The limit is a cookie until accounts
  (session 4) and rate limiting (session 8). Print-ready exports arrive with checkout (session 5).
- **Validation states** come from the panel's findings: field messages appear once a field has
  been left (or an export tried), and the Checks list shows everything that blocks, warns or notes.
- **API hygiene**: JSON only (415 otherwise), cross-site `Origin` refused, 16 KB body limit,
  `Cache-Control: no-store`, and logs carry the event name and export id only.
- **CPU**: a preview costs about 6–20 ms of CPU and a free export about 140 ms, above the Workers
  Free plan's 10 ms per request, so the account needs Workers Paid.

## Deploy

The Worker is `energy-panel` (`apps/web/wrangler.jsonc`). Workers Builds deploys `main` and gives
every other branch a preview URL once the repository is connected in the Cloudflare dashboard
(Workers & Pages → Create → Import a repository), with these settings:

```
Root directory     apps/web
Build variables    NODE_VERSION=22  PNPM_VERSION=10.33.0  SKIP_DEPENDENCY_INSTALL=1
Build command      cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @energy-panel/web build
Deploy command     npx wrangler deploy
Preview command    npx wrangler preview   (the default; enable builds for non-production branches)
```

## Conventions (brief section 11)

- TypeScript throughout; Australian English in copy and comments.
- Nothing regulatory is hard-coded: wording, thresholds and constants come from the rules file.
  Product settings (widths, layout proportions, package-word length) live in `packages/panel`.
- A PR that changes any `rules/*.json` must bump `version`, add a `versions[]` entry and set a new
  `verified_at` on each changed rule. CI enforces this (`scripts/check-rules-change.mjs`).
- Secrets: Wrangler secrets and the Cloudflare dashboard only. `.dev.vars` is git-ignored and the
  pre-commit hook plus CI block secret files and key-shaped strings.
- Generated files: `YYYYMMDD-<org>-<sku>-energy-panel-<width>mm.<ext>`, with org and SKU slugged
  to lower-case ASCII (`Château Lune` → `chateau-lune`). Where the convention alone would give two
  files one name, suffixes follow the width: `-white`, `-spot`, `-pdf14`, `-proof`.
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
| D7  | PDF/X-4 output intent   | none: X-4 rules followed, no X-4 claim (see exports)    | session 4 |
| D8  | Live preview            | server-rendered, watermarked PNG (Kami, 30 Sep 2026)    | session 3 |
| D9  | Hosting                 | one Worker with static assets, not Pages (Kami, 30 Sep) | session 3 |

## Open items

- Connect the repository to Workers Builds (see Deploy) for the preview URL, and move the
  account to Workers Paid (see CPU above).
- Beverage presets set the package word; "can" for beer and cider is a guess to confirm.
- In the free preview export's SVG and PDFs the PREVIEW mark is a separate path, so a designer can
  delete it; the one-per-browser limit is what protects paid exports. The live preview has no
  such gap: it is a PNG with the mark burned in.
- D7 needs a printing condition and a CMYK ICC profile licensed for embedding (printer profiles
  could supply their own from session 6). Once chosen, run an X-4 export through a preflight
  such as Acrobat or callas pdfToolbox; the tests only use a stand-in profile.
- Print a 35 mm panel at 100% and measure it: 35 mm ± 0.2 mm (brief acceptance). The file side
  is checked by `pnpm pdf:check`; the printer side needs paper.
- The FSANZ example states no ABV; the golden fixture uses 21.1% (1.0 standard drink per 60 mL).
- Optional Code features not offered yet: expressing under 40 kJ as "LESS THAN 40 kJ"
  (Standard 2.7.1—4C(4)) and percentage daily intake (2.7.1—4D).
- No minimum type size applies beyond general legibility (guidance p. 6; fact sheet p. 7), so
  `min_type_size` is null by design; the check stays in place should that change.
- Session 3 presets: the fact sheet (p. 5) cites Department of Health serves of 100 mL
  (standard) and 150 mL (restaurant) for wine and 60 mL for fortified wine.
