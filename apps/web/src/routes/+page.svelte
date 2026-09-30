<script lang="ts">
  import type {
    BeverageTypeId,
    Finding,
    PanelMetrics,
    ResolvedOptions,
    StatementValues,
  } from '@energy-panel/panel';
  import { onMount, tick } from 'svelte';
  import Ruler from '$lib/components/Ruler.svelte';
  import {
    formatSize,
    fromBase64,
    localDate,
    parseNumber,
    statementRequest,
    type FormState,
  } from '$lib/request';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  // The page is prerendered from the rules file, so its data never changes after load.
  // svelte-ignore state_referenced_locally
  const config = data.config;

  type Field = NonNullable<Finding['field']> | 'producer' | 'sku';

  interface Statement {
    exportable: boolean;
    warnings: Finding[];
    values: StatementValues | null;
    metrics: PanelMetrics | null;
    options: ResolvedOptions | null;
    rulesVersion: string;
    description: string | null;
  }
  interface Preview {
    png: string;
    widthPx: number;
    heightPx: number;
    pxPerMm: number;
    widthMm: number;
    heightMm: number;
  }
  interface DownloadFile {
    fileName: string;
    size: number;
    url: string;
  }

  const first = config.beverageTypes[0]!;
  let form = $state<FormState>({
    beverage: first.id,
    abv: '',
    packageMl: '',
    serving: first.servingsMl.length > 0 ? String(first.servingsMl[0]) : 'custom',
    servingCustom: '',
    servings: '',
    kj: '',
    cal: '',
    area: '',
    nip: false,
    standardised: '',
    width: '50',
    widthCustom: '',
    colour: 'black',
    units: 'kj',
    packageWord: first.packageWord,
    packageWordCustom: '',
  });
  let producer = $state('');
  let sku = $state('');
  let batch = $state('');

  let statement = $state<Statement | null>(null);
  let preview = $state<Preview | null>(null);
  let freeExportAvailable = $state(true);
  let loading = $state(false);
  let previewError = $state<string | null>(null);
  let zoom = $state(1);
  let dpr = $state(1);

  let touched = $state<Partial<Record<Field, boolean>>>({});
  let attempted = $state(false);
  let exporting = $state(false);
  let exportError = $state<string | null>(null);
  let files = $state<DownloadFile[]>([]);
  let filesHeading = $state<HTMLElement | null>(null);
  let checksHeading = $state<HTMLElement | null>(null);

  const beverage = $derived(config.beverageTypes.find((t) => t.id === form.beverage) ?? first);
  const request = $derived(statementRequest(form));
  const findings = $derived(statement?.warnings ?? []);
  const blocks = $derived(findings.filter((f) => f.severity === 'block'));
  const warnings = $derived(findings.filter((f) => f.severity === 'warning'));
  const notes = $derived(findings.filter((f) => f.severity === 'note'));
  const belowThreshold = $derived.by(() => {
    const abv = parseNumber(form.abv);
    return abv !== null && !Number.isNaN(abv) && abv < config.minAbvPercent;
  });
  const computedServings = $derived(
    !form.servings.trim() && statement?.values
      ? ` (${statement.values.display.servingsPerPackage})`
      : '',
  );
  const nameProblems = $derived(
    [
      producer.trim() === '' && { field: 'producer' as Field, message: 'Enter the producer name.' },
      sku.trim() === '' && { field: 'sku' as Field, message: 'Enter the product name.' },
    ].filter((p): p is { field: Field; message: string } => p !== false),
  );

  onMount(() => {
    dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
  });

  // Live preview: debounced, and each request cancels the one before it.
  $effect(() => {
    const body = JSON.stringify({
      ...request,
      pxPerMm: Math.round(((zoom * dpr * 96) / 25.4) * 100) / 100,
    });
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      loading = true;
      try {
        const res = await fetch('/api/preview', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`preview ${res.status}`);
        const result = await res.json();
        statement = result.statement;
        preview = result.preview;
        freeExportAvailable = result.freeExport.available;
        previewError = null;
      } catch {
        if (!controller.signal.aborted) {
          previewError = 'The preview could not be updated. Check your connection and try again.';
        }
      } finally {
        if (!controller.signal.aborted) loading = false;
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  });

  const touch = (field: Field) => () => {
    touched[field] = true;
  };
  const shown = (field: Field): Array<{ message: string; severity: string }> =>
    touched[field] || attempted
      ? [
          ...findings.filter((f) => f.field === field),
          ...(field === 'producer' || field === 'sku'
            ? nameProblems
                .filter((p) => p.field === field)
                .map((p) => ({ ...p, severity: 'block' }))
            : []),
        ]
      : [];
  const invalid = (field: Field) => shown(field).some((f) => f.severity === 'block');

  function chooseBeverage(id: BeverageTypeId) {
    const type = config.beverageTypes.find((t) => t.id === id);
    if (!type) return;
    form.beverage = id;
    form.serving = type.servingsMl.length > 0 ? String(type.servingsMl[0]) : 'custom';
    form.packageWord = type.packageWord;
  }

  async function exportPreview() {
    attempted = true;
    exportError = null;
    if (nameProblems.length > 0) {
      await tick();
      document.getElementById(nameProblems[0]!.field)?.focus();
      return;
    }
    // No check against the last preview here: it can lag the inputs by a request. The server
    // validates the values sent and refuses a blocked statement without using the free export.
    exporting = true;
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...request,
          details: {
            producer,
            sku,
            ...(batch.trim() ? { vintageOrBatch: batch } : {}),
            issuedOn: localDate(),
          },
        }),
      });
      const result = await res.json();
      if (!res.ok) {
        if (result.error === 'blocked') {
          exportError = 'Resolve the items listed under Checks before exporting.';
          await tick();
          checksHeading?.focus();
          return;
        }
        exportError = result.message ?? 'The export failed. Try again.';
        if (result.error === 'free_export_used') freeExportAvailable = false;
        return;
      }
      for (const f of files) URL.revokeObjectURL(f.url);
      files = result.files.map(
        (f: { fileName: string; mediaType: string; size: number; base64: string }) => ({
          fileName: f.fileName,
          size: f.size,
          url: URL.createObjectURL(new Blob([fromBase64(f.base64)], { type: f.mediaType })),
        }),
      );
      freeExportAvailable = false;
      await tick();
      filesHeading?.focus();
    } catch {
      exportError = 'The export failed. Check your connection and try again.';
    } finally {
      exporting = false;
    }
  }

  /** One decimal place at most: 19.103 → "19.1". */
  const oneDecimal = (value: number) => String(Math.round(value * 10) / 10);
  /** Two at most, so the 0.25 pt minimum rule reads as itself: 0.502 → "0.5". */
  const twoDecimals = (value: number) => String(Math.round(value * 100) / 100);

  const colourLabels = {
    black: 'Black',
    white: 'White on transparent',
    spot: 'Spot colour (separation “Panel”)',
  } as const;
</script>

<svelte:head>
  <title>Energy Panel · FSANZ energy statement generator</title>
  <meta
    name="description"
    content="Generate the prescribed FSANZ ENERGY INFORMATION statement for alcoholic beverages as outlined, press-ready artwork."
  />
</svelte:head>

{#snippet messages(field: Field)}
  <div id="{field}-msg" class="messages">
    {#each shown(field) as finding (finding.message)}
      <p class="msg {finding.severity}">{finding.message}</p>
    {/each}
  </div>
{/snippet}

<main id="main" class="wrap">
  <div class="intro">
    <h1>Energy statement generator</h1>
    <p>
      Enter your product’s values to build the prescribed <strong>ENERGY INFORMATION</strong>
      statement (Food Standards Code, Standard 2.7.1). Labels on alcoholic beverages packaged from
      {new Date(`${config.complianceDate}T00:00:00Z`).toLocaleDateString('en-AU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })} must carry it.
    </p>
  </div>

  <div class="layout">
    <form class="inputs" novalidate onsubmit={(e) => e.preventDefault()}>
      <fieldset>
        <legend>Beverage</legend>
        <fieldset class="choices">
          <legend class="label">Beverage type</legend>
          <div class="options">
            {#each config.beverageTypes as type (type.id)}
              <label class="option">
                <input
                  type="radio"
                  name="beverage"
                  value={type.id}
                  checked={form.beverage === type.id}
                  onchange={() => chooseBeverage(type.id)}
                />
                {type.label}
              </label>
            {/each}
          </div>
          <p class="hint">Sets the serving size presets and the package word.</p>
        </fieldset>

        <div class="field">
          <label for="abv">Alcohol by volume <span class="unit">%</span></label>
          <input
            id="abv"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            bind:value={form.abv}
            onblur={touch('abv')}
            aria-invalid={invalid('abv')}
            aria-describedby="abv-msg"
          />
          {@render messages('abv')}
        </div>

        {#if belowThreshold}
          <fieldset class="choices">
            <legend class="label">Is this a standardised alcoholic beverage?</legend>
            <p class="hint" id="standardised-hint">
              Below {config.minAbvPercent}% ABV the statement is required only for these:
              {config.standardisedBeverages.join(', ')}.
            </p>
            <div class="options">
              <label class="option">
                <input
                  type="radio"
                  name="standardised"
                  value="yes"
                  bind:group={form.standardised}
                  onchange={touch('standardised_beverage')}
                />
                Yes
              </label>
              <label class="option">
                <input
                  type="radio"
                  name="standardised"
                  value="no"
                  bind:group={form.standardised}
                  onchange={touch('standardised_beverage')}
                />
                No
              </label>
            </div>
            {@render messages('standardised_beverage')}
          </fieldset>
        {/if}
      </fieldset>

      <fieldset>
        <legend>Package</legend>
        <div class="field">
          <label for="package-ml">Package volume <span class="unit">mL</span></label>
          <input
            id="package-ml"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            bind:value={form.packageMl}
            onblur={touch('package_ml')}
            aria-invalid={invalid('package_ml')}
            aria-describedby="package_ml-msg"
          />
          {@render messages('package_ml')}
        </div>

        <div class="field">
          <label for="package-word">Package word</label>
          <select
            id="package-word"
            bind:value={form.packageWord}
            onchange={touch('package_word')}
            aria-describedby="package-word-hint package_word-msg"
          >
            <option value={config.packageWords.default}>{config.packageWords.default}</option>
            {#each config.packageWords.alternatives as word (word)}
              <option value={word}>{word}</option>
            {/each}
            {#if config.packageWords.customAllowed}
              <option value="custom">another word…</option>
            {/if}
          </select>
          <p class="hint" id="package-word-hint">
            Completes “Servings per {form.packageWord === 'custom'
              ? form.packageWordCustom || '…'
              : form.packageWord}”.
          </p>
          {#if form.packageWord === 'custom'}
            <label for="package-word-custom">Your package word</label>
            <input
              id="package-word-custom"
              type="text"
              maxlength={config.packageWordMaxLength}
              autocomplete="off"
              bind:value={form.packageWordCustom}
              onblur={touch('package_word')}
              aria-invalid={invalid('package_word')}
              aria-describedby="package_word-msg"
            />
          {/if}
          {@render messages('package_word')}
        </div>

        <div class="field">
          <label for="area">
            Package surface area <span class="unit">cm²</span>
            <span class="optional">optional</span>
          </label>
          <input
            id="area"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            bind:value={form.area}
            onblur={touch('package_surface_area_cm2')}
            aria-invalid={invalid('package_surface_area_cm2')}
            aria-describedby="area-hint package_surface_area_cm2-msg"
          />
          <p class="hint" id="area-hint">Packages under 100 cm² may be exempt.</p>
          {@render messages('package_surface_area_cm2')}
        </div>

        <div class="field check">
          <input
            id="nip"
            type="checkbox"
            bind:checked={form.nip}
            onchange={touch('nip_displayed')}
            aria-describedby="nip_displayed-msg"
          />
          <label for="nip">The label displays a nutrition information panel</label>
          {@render messages('nip_displayed')}
        </div>
      </fieldset>

      <fieldset>
        <legend>Serving</legend>
        {#if beverage.servingsMl.length > 0}
          <fieldset class="choices">
            <legend class="label">Serving size</legend>
            <div class="options">
              {#each beverage.servingsMl as ml (ml)}
                <label class="option">
                  <input type="radio" name="serving" value={String(ml)} bind:group={form.serving} />
                  {ml} mL
                </label>
              {/each}
              <label class="option">
                <input type="radio" name="serving" value="custom" bind:group={form.serving} />
                Other
              </label>
            </div>
          </fieldset>
        {/if}
        {#if form.serving === 'custom'}
          <div class="field">
            <label for="serving-custom">Serving size <span class="unit">mL</span></label>
            <input
              id="serving-custom"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              bind:value={form.servingCustom}
              onblur={touch('serving_ml')}
              aria-invalid={invalid('serving_ml')}
              aria-describedby="serving_ml-msg"
            />
          </div>
        {/if}
        {@render messages('serving_ml')}

        <div class="field">
          <label for="servings">
            Servings per package <span class="optional">optional</span>
          </label>
          <input
            id="servings"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            bind:value={form.servings}
            onblur={touch('servings')}
            aria-invalid={invalid('servings')}
            aria-describedby="servings-hint servings-msg"
          />
          <p class="hint" id="servings-hint">
            Leave empty to use package volume ÷ serving size{computedServings}.
          </p>
          {@render messages('servings')}
        </div>
      </fieldset>

      <fieldset>
        <legend>Energy</legend>
        <div class="field">
          <label for="kj">Average energy <span class="unit">kJ per 100 mL</span></label>
          <input
            id="kj"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            bind:value={form.kj}
            onblur={touch('kj_per_100ml')}
            aria-invalid={invalid('kj_per_100ml')}
            aria-describedby="kj-hint kj_per_100ml-msg"
          />
          <p class="hint" id="kj-hint">
            {#if config.calculatorUrl}
              From the <a href={config.calculatorUrl} target="_blank" rel="noopener noreferrer"
                >FSANZ alcohol energy content calculator</a
              > (opens in a new tab).
            {:else}
              From the FSANZ alcohol energy content calculator.
            {/if}
          </p>
          {@render messages('kj_per_100ml')}
        </div>
        <div class="field">
          <label for="cal">
            Average energy <span class="unit">Cal per 100 mL</span>
            <span class="optional">optional</span>
          </label>
          <input
            id="cal"
            type="text"
            inputmode="decimal"
            autocomplete="off"
            bind:value={form.cal}
            onblur={touch('cal_per_100ml')}
            aria-invalid={invalid('cal_per_100ml')}
            aria-describedby="cal-hint cal_per_100ml-msg"
          />
          <p class="hint" id="cal-hint">Checked against the kJ value.</p>
          {@render messages('cal_per_100ml')}
        </div>
      </fieldset>

      <fieldset>
        <legend>Panel</legend>
        <fieldset class="choices">
          <legend class="label">Width</legend>
          <div class="options">
            {#each config.presetWidthsMm as mm (mm)}
              <label class="option">
                <input
                  type="radio"
                  name="width"
                  value={String(mm)}
                  bind:group={form.width}
                  onchange={touch('width_mm')}
                />
                {mm} mm
              </label>
            {/each}
            <label class="option">
              <input
                type="radio"
                name="width"
                value="custom"
                bind:group={form.width}
                onchange={touch('width_mm')}
              />
              Other
            </label>
          </div>
          {#if form.width === 'custom'}
            <div class="field">
              <label for="width-custom">
                Width <span class="unit"
                  >mm, {config.widthLimitsMm.min} to {config.widthLimitsMm.max}</span
                >
              </label>
              <input
                id="width-custom"
                type="text"
                inputmode="decimal"
                autocomplete="off"
                bind:value={form.widthCustom}
                onblur={touch('width_mm')}
                aria-invalid={invalid('width_mm')}
                aria-describedby="width_mm-msg"
              />
            </div>
          {/if}
          {@render messages('width_mm')}
          <p class="hint">The height follows the content.</p>
        </fieldset>

        <fieldset class="choices">
          <legend class="label">Colour</legend>
          <div class="options">
            {#each ['black', 'white', 'spot'] as const as colour (colour)}
              <label class="option">
                <input type="radio" name="colour" value={colour} bind:group={form.colour} />
                {colourLabels[colour]}
              </label>
            {/each}
          </div>
        </fieldset>

        <fieldset class="choices">
          <legend class="label">Energy units</legend>
          <div class="options">
            <label class="option">
              <input type="radio" name="units" value="kj" bind:group={form.units} />
              kJ only
            </label>
            <label class="option">
              <input type="radio" name="units" value="kj_cal" bind:group={form.units} />
              kJ and Cal
            </label>
          </div>
        </fieldset>
      </fieldset>
    </form>

    <div class="output">
      <section class="preview" aria-labelledby="preview-heading">
        <div class="bar">
          <h2 id="preview-heading">Preview</h2>
          <fieldset class="choices zoom">
            <legend class="visually-hidden">Preview size</legend>
            <div class="options">
              {#each [1, 2, 4] as z (z)}
                <label class="option">
                  <input type="radio" name="zoom" value={z} bind:group={zoom} />
                  {z === 1 ? 'Actual size' : `${z}×`}
                </label>
              {/each}
            </div>
          </fieldset>
        </div>

        <figure class="stage" aria-busy={loading}>
          {#if preview && statement}
            <div class="scroll">
              <div class="grid">
                <span></span>
                <Ruler lengthMm={preview.widthMm} {zoom} />
                <Ruler lengthMm={preview.heightMm} {zoom} orientation="vertical" />
                <img
                  src="data:image/png;base64,{preview.png}"
                  alt="Preview of the energy statement. {statement.description ?? ''}"
                  style:width="{preview.widthMm * zoom}mm"
                  style:height="{preview.heightMm * zoom}mm"
                />
              </div>
            </div>
            <figcaption>
              {#if statement.metrics}
                {oneDecimal(statement.metrics.widthMm)} × {oneDecimal(statement.metrics.heightMm)} mm
                · type {oneDecimal(statement.metrics.bodySizePt)} pt · rules {twoDecimals(
                  statement.metrics.ruleWeightPt,
                )} pt ·
              {/if}
              Screens differ, so size on screen is approximate: print the proof sheet at 100% to check
              it.
            </figcaption>
          {:else if statement}
            <p class="empty">Enter the values on the left to build the statement.</p>
          {:else}
            <p class="empty">Loading…</p>
          {/if}
        </figure>

        {#if previewError}
          <p class="msg block" role="alert">{previewError}</p>
        {/if}

        {#if statement?.values}
          <p class="reminder">
            <strong
              >Standard drinks in the package: {statement.values.display
                .totalStandardDrinks}.</strong
            >
            State this separately on the label, not inside the energy statement.
          </p>
        {/if}
      </section>

      <section class="checks" aria-labelledby="checks-heading">
        <h2 id="checks-heading" tabindex="-1" bind:this={checksHeading}>Checks</h2>
        <p class="status" role="status">
          {#if !statement}
            Checking…
          {:else if blocks.length === 0}
            Ready to export.
          {:else}
            {blocks.length}
            {blocks.length === 1 ? 'item' : 'items'} to resolve before export.
          {/if}
        </p>
        {#each [{ title: 'To resolve before export', items: blocks }, { title: 'Check', items: warnings }, { title: 'Notes', items: notes }] as group (group.title)}
          {#if group.items.length > 0}
            <h3>{group.title}</h3>
            <ul>
              {#each group.items as finding, i (`${finding.code}-${i}`)}
                <li class="msg {finding.severity}">{finding.message}</li>
              {/each}
            </ul>
          {/if}
        {/each}
      </section>
    </div>
  </div>

  <section class="export" aria-labelledby="export-heading">
    <h2 id="export-heading">Export</h2>
    <div class="field">
      <label for="producer">Producer</label>
      <input
        id="producer"
        type="text"
        autocomplete="organization"
        maxlength="80"
        bind:value={producer}
        onblur={touch('producer')}
        aria-invalid={invalid('producer')}
        aria-describedby="producer-msg"
      />
      {@render messages('producer')}
    </div>
    <div class="field">
      <label for="sku">Product</label>
      <input
        id="sku"
        type="text"
        autocomplete="off"
        maxlength="80"
        bind:value={sku}
        onblur={touch('sku')}
        aria-invalid={invalid('sku')}
        aria-describedby="sku-msg"
      />
      {@render messages('sku')}
    </div>
    <div class="field">
      <label for="batch">Vintage or batch <span class="optional">optional</span></label>
      <input id="batch" type="text" autocomplete="off" maxlength="40" bind:value={batch} />
    </div>

    {#if freeExportAvailable}
      <button
        type="button"
        class="primary"
        onclick={exportPreview}
        aria-describedby="export-hint"
        disabled={exporting}
      >
        {exporting ? 'Exporting…' : 'Export free preview files'}
      </button>
      <p class="hint" id="export-hint">
        Watermarked SVG, PDF (to PDF/X-4 rules), PDF 1.4 and an A4 proof sheet, for checking size
        and layout. One free preview export per browser.
      </p>
    {:else if files.length === 0}
      <p>This browser has used its free preview export.</p>
    {/if}
    <p class="hint">Print-ready exports without the watermark open when checkout is available.</p>

    {#if exportError}
      <p class="msg block" role="alert">{exportError}</p>
    {/if}

    {#if files.length > 0}
      <h3 tabindex="-1" bind:this={filesHeading}>Your preview files</h3>
      <ul class="files">
        {#each files as file (file.fileName)}
          <li>
            <a href={file.url} download={file.fileName}>{file.fileName}</a>
            <span class="size">{formatSize(file.size)}</span>
          </li>
        {/each}
      </ul>
    {/if}
    <p class="hint">Rules version {config.rulesVersion}.</p>
  </section>
</main>

<style>
  .wrap {
    max-width: 78rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 0;
  }
  .intro {
    max-width: 48rem;
    margin-bottom: 1.5rem;
  }
  h1 {
    font-size: 1.75rem;
  }
  h2 {
    font-size: 1.25rem;
  }
  h3 {
    font-size: 1rem;
    margin-top: 1rem;
  }
  .layout {
    display: grid;
    gap: 2rem;
  }
  @media (min-width: 60rem) {
    .layout {
      grid-template-columns: minmax(20rem, 26rem) minmax(0, 1fr);
      align-items: start;
    }
    .output {
      position: sticky;
      top: 0;
      max-height: 100vh;
      overflow-y: auto;
      padding: 1rem 0.25rem 1rem 0;
    }
  }
  fieldset {
    border: 0;
    margin: 0 0 1.5rem;
    padding: 0;
    min-width: 0;
  }
  .inputs > fieldset > legend {
    font-size: 1.125rem;
    font-weight: 700;
    padding: 0;
    margin-bottom: 0.75rem;
    border-bottom: 1px solid var(--line);
    width: 100%;
    padding-bottom: 0.25rem;
  }
  .field {
    margin-bottom: 1rem;
  }
  .field > label,
  .label {
    display: block;
    font-weight: 600;
    margin-bottom: 0.25rem;
    padding: 0;
  }
  .choices {
    margin-bottom: 1rem;
  }
  .unit,
  .optional {
    font-weight: 400;
    color: var(--muted);
  }
  .optional::before {
    content: '· ';
  }
  input[type='text'],
  select {
    font: inherit;
    width: 100%;
    max-width: 20rem;
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--muted);
    border-radius: var(--radius);
    background: var(--paper);
    color: var(--ink);
  }
  input[aria-invalid='true'] {
    border-color: var(--block);
    box-shadow: 0 0 0 1px var(--block);
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .option {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--paper);
    cursor: pointer;
  }
  .option:has(input:checked) {
    border-color: var(--accent);
    background: var(--note-soft);
  }
  .check {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 0.25rem 0.5rem;
    align-items: start;
  }
  .check label {
    font-weight: 400;
  }
  .check .messages {
    grid-column: 2;
  }
  input[type='checkbox'],
  input[type='radio'] {
    width: 1.1rem;
    height: 1.1rem;
    margin: 0.2rem 0 0;
    accent-color: var(--accent);
  }
  .hint {
    color: var(--muted);
    font-size: 0.9rem;
    margin: 0.3rem 0 0;
  }
  .msg {
    margin: 0.35rem 0 0;
    padding: 0.4rem 0.6rem;
    border-left: 4px solid;
    border-radius: 2px;
    font-size: 0.9375rem;
  }
  .msg.block {
    border-color: var(--block);
    background: var(--block-soft);
  }
  .msg.warning {
    border-color: var(--warn);
    background: var(--warn-soft);
  }
  .msg.note {
    border-color: var(--note);
    background: var(--note-soft);
  }
  section {
    margin-bottom: 1.75rem;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .bar h2 {
    margin: 0;
  }
  .zoom {
    margin: 0;
  }
  .stage {
    margin: 0;
    padding: 1rem;
    background: var(--soft);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }
  .scroll {
    overflow: auto;
    padding-bottom: 0.25rem;
  }
  .grid {
    display: grid;
    grid-template-columns: auto auto;
    justify-content: start;
    gap: 1mm;
  }
  .grid img {
    display: block;
    box-shadow: 0 0 0 1px var(--line);
  }
  figcaption {
    margin-top: 0.75rem;
    font-size: 0.875rem;
    color: var(--muted);
  }
  .empty {
    margin: 0;
    color: var(--muted);
  }
  .reminder {
    margin: 0.75rem 0 0;
  }
  .status {
    margin: 0 0 0.5rem;
    font-weight: 600;
  }
  .checks ul,
  .files {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .checks li {
    margin-bottom: 0.4rem;
  }
  .export {
    padding: 1rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    max-width: 48rem;
  }
  button.primary {
    font: inherit;
    font-weight: 600;
    padding: 0.6rem 1.1rem;
    border: 0;
    border-radius: var(--radius);
    background: var(--accent);
    color: var(--accent-ink);
    cursor: pointer;
  }
  button.primary:disabled {
    opacity: 0.7;
    cursor: progress;
  }
  .files li {
    margin-bottom: 0.35rem;
    word-break: break-all;
  }
  .size {
    color: var(--muted);
    font-size: 0.875rem;
    margin-left: 0.4rem;
  }
</style>
