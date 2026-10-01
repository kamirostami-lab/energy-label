<script lang="ts">
  import type {
    BeverageTypeId,
    Finding,
    PanelMetrics,
    ResolvedOptions,
    StatementValues,
  } from '@energy-panel/panel';
  import { onMount, tick, untrack } from 'svelte';
  import { afterNavigate, beforeNavigate, replaceState } from '$app/navigation';
  import Ruler from '$lib/components/Ruler.svelte';
  import {
    api,
    priceLabel,
    shortDate,
    shows,
    startCheckout,
    takeCheckoutResult,
    type Billing,
    type Product,
    type Sku,
    type StoredExport,
  } from '$lib/account';
  import { restoreForm, storeDraft, takeDraft } from '$lib/draft';
  import {
    formFromSku,
    formatSize,
    fromBase64,
    localDate,
    parseNumber,
    statementRequest,
    type FormState,
  } from '$lib/request';
  import { refreshSession, session, waitForAccount } from '$lib/session.svelte';
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
    /** Known for files returned in the response; account exports download from storage. */
    size: number | null;
    url: string;
  }

  const first = config.beverageTypes[0]!;
  const emptyForm = (): FormState => ({
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
  let form = $state<FormState>(emptyForm());
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
  /** The export under way, if any: the free preview or print-ready files. */
  let exporting = $state<'preview' | 'print' | null>(null);
  let exportError = $state<string | null>(null);
  let files = $state<DownloadFile[]>([]);
  let filesEdition = $state<'preview' | 'print'>('preview');
  let filesHeading = $state<HTMLElement | null>(null);
  let checksHeading = $state<HTMLElement | null>(null);

  // Signed in: the SKU on screen (opened from the list, or saved from here) and its exports.
  let skuId = $state<string | null>(null);
  let skuExports = $state<StoredExport[]>([]);
  let savedBody = $state<string | null>(null);
  let saving = $state(false);
  let skuNotice = $state<string | null>(null);

  // Print-ready exports: prices from Stripe, the way back from Checkout.
  let billing = $state<Billing | null>(null);
  let buying = $state(false);
  let paymentNotice = $state<{ text: string; kind: 'ok' | 'note' } | null>(null);
  let printButton = $state<HTMLButtonElement | null>(null);
  const forSale = (id: string) =>
    billing?.available ? (billing.products.find((p) => p.id === id) ?? null) : null;
  const exportProduct = $derived(forSale('export'));
  const planProduct = $derived(forSale('producer'));
  const busy = $derived(saving || buying || exporting !== null);

  const beverage = $derived(config.beverageTypes.find((t) => t.id === form.beverage) ?? first);
  const request = $derived(statementRequest(form));
  const account = $derived(session.account);
  /** The SKU record the save and export buttons write. */
  const skuBody = $derived({
    name: sku,
    producer: producer.trim() || null,
    beverageType: form.beverage,
    vintageOrBatch: batch.trim() || null,
    ...request,
  });
  const unsaved = $derived(savedBody !== JSON.stringify(skuBody));
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

  /** Counts every field that has a value as entered, so its messages show. */
  function markEntered(): boolean {
    const entered: Array<[Field, string]> = [
      ['abv', form.abv],
      ['package_ml', form.packageMl],
      ['serving_ml', form.servingCustom],
      ['servings', form.servings],
      ['kj_per_100ml', form.kj],
      ['cal_per_100ml', form.cal],
      ['package_surface_area_cm2', form.area],
      ['width_mm', form.widthCustom],
      ['package_word', form.packageWordCustom],
      ['producer', producer],
      ['sku', sku],
    ];
    let any = false;
    for (const [field, value] of entered) {
      if (value.trim() === '') continue;
      touched[field] = true;
      any = true;
    }
    return any;
  }

  onMount(() => {
    dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
    // Values typed before the page finished loading survive hydration, but the blur that left
    // the field happened before any handler existed: count those fields as already entered.
    const typed = markEntered();
    const id = new URLSearchParams(location.search).get('sku');
    const checkout = takeCheckoutResult();
    loadBilling();
    if (checkout?.outcome === 'cancelled') {
      paymentNotice = { text: 'Checkout was cancelled. Nothing was charged.', kind: 'note' };
    } else if (checkout?.outcome === 'complete') {
      confirmPayment(checkout.product);
    }
    if (id) {
      openSku(id);
    } else if (!typed) {
      // Values entered before a trip through sign-in come back once.
      const draft = takeDraft();
      if (draft) {
        form = restoreForm(emptyForm(), draft.form ?? {});
        producer = draft.producer;
        sku = draft.sku;
        batch = draft.batch;
        skuId = draft.skuId; // saving writes to that SKU again
        markEntered();
      }
    }
  });

  // Keep what has been entered while its user goes to sign in (the link opens in a new tab).
  beforeNavigate(({ to }) => {
    const typed = [
      form.abv,
      form.packageMl,
      form.servingCustom,
      form.servings,
      form.kj,
      form.cal,
      form.area,
      form.widthCustom,
      form.packageWordCustom,
      producer,
      sku,
      batch,
    ].some((value) => value.trim() !== '');
    if (to?.url.pathname === '/sign-in' && (typed || skuId !== null)) {
      storeDraft({ form: $state.snapshot(form), producer, sku, batch, skuId });
    }
  });

  // The header's Generator link, or signing out, leaves the SKU for an empty form.
  afterNavigate(({ type, to }) => {
    if (type === 'enter') return;
    const id = to?.url.searchParams.get('sku') ?? null;
    if (id === skuId) return;
    if (id) openSku(id);
    else startNew();
  });

  // A signed-in account's organisation is the producer until another is entered.
  $effect(() => {
    const org = session.account?.orgName;
    untrack(() => {
      if (org && producer.trim() === '' && skuId === null) producer = org;
    });
  });

  async function loadBilling() {
    try {
      const res = await api<Billing>('billing');
      if (res.ok) billing = res.data;
    } catch {
      // Without prices the buy button stays hidden; exporting on a plan or credit still works.
    }
  }

  /** Back from Stripe Checkout: waits for the webhook to record the payment. */
  async function confirmPayment(product: Product['id'] | null) {
    paymentNotice = { text: 'Payment received. Confirming it with Stripe…', kind: 'note' };
    const confirmed = await waitForAccount(shows(product));
    paymentNotice = confirmed
      ? { text: 'Payment confirmed: export the print-ready files below.', kind: 'ok' }
      : {
          text: 'Payment received. It can take a minute to confirm: reload the page shortly.',
          kind: 'note',
        };
    if (confirmed) {
      await tick();
      printButton?.focus();
    }
  }

  function startNew() {
    opening++;
    form = emptyForm();
    producer = session.account?.orgName ?? '';
    sku = '';
    batch = '';
    skuId = null;
    skuExports = [];
    savedBody = null;
    skuNotice = null;
    touched = {};
    attempted = false;
    exportError = null;
    files = [];
  }

  let opening = 0;

  async function openSku(id: string) {
    const ticket = ++opening;
    skuNotice = null;
    try {
      const res = await api<{ sku: Sku; exports: StoredExport[] }>(
        `skus/${encodeURIComponent(id)}`,
      );
      if (ticket !== opening) return; // another SKU was opened meanwhile
      if (!res.ok) {
        skuNotice =
          res.status === 401
            ? 'Sign in to open this SKU.'
            : res.status === 404
              ? 'This SKU is not in your account.'
              : 'The SKU could not be opened. Reload the page to try again.';
        return;
      }
      const stored = res.data.sku;
      form = formFromSku(stored, config);
      producer = stored.producer ?? session.account?.orgName ?? '';
      sku = stored.name;
      batch = stored.vintageOrBatch ?? '';
      skuId = stored.id;
      skuExports = res.data.exports;
      files = [];
      exportError = null;
      savedBody = JSON.stringify(skuBody);
      touched = {};
      attempted = false;
      markEntered();
    } catch {
      if (ticket === opening) {
        skuNotice = 'The SKU could not be opened. Check your connection and reload the page.';
      }
    }
  }

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
    exporting = 'preview';
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
      showFiles(
        result.files.map(
          (f: { fileName: string; mediaType: string; size: number; base64: string }) => ({
            fileName: f.fileName,
            size: f.size,
            url: URL.createObjectURL(new Blob([fromBase64(f.base64)], { type: f.mediaType })),
          }),
        ),
      );
      freeExportAvailable = false;
      filesEdition = 'preview';
      await tick();
      filesHeading?.focus();
    } catch {
      exportError = 'The export failed. Check your connection and try again.';
    } finally {
      exporting = null;
    }
  }

  function showFiles(next: DownloadFile[]) {
    for (const f of files) if (f.url.startsWith('blob:')) URL.revokeObjectURL(f.url);
    files = next;
  }

  /** Writes the values on screen to the open SKU, or to a new one. Returns its id. */
  async function storeSku(): Promise<string | null> {
    const body = skuBody;
    const res = await api<{ sku?: Sku; message?: string; field?: string }>(
      skuId ? `skus/${encodeURIComponent(skuId)}` : 'skus',
      { method: skuId ? 'PUT' : 'POST', body },
    );
    if (!res.ok || !res.data?.sku) {
      if (res.status === 401) {
        // Signed out elsewhere: the values stay on screen, and signing in again keeps them.
        session.account = null;
        exportError = 'You have been signed out. Sign in again to save this SKU.';
      } else if (res.status === 404 && skuId) {
        skuId = null;
        exportError =
          'This SKU is not in the account you are signed in to. Select Save SKU to save it as a new one.';
      } else {
        exportError = res.data?.message ?? 'The SKU could not be saved. Try again.';
        const field = res.data?.field === 'name' ? 'sku' : res.data?.field;
        if (field === 'sku' || field === 'producer') document.getElementById(field)?.focus();
      }
      return null;
    }
    skuId = res.data.sku.id;
    savedBody = JSON.stringify(body);
    replaceState(`/?sku=${encodeURIComponent(skuId)}`, {});
    return skuId;
  }

  async function saveSku() {
    exportError = null;
    touched.sku = true;
    if (sku.trim() === '') {
      await tick();
      document.getElementById('sku')?.focus();
      return;
    }
    saving = true;
    try {
      await storeSku();
    } catch {
      exportError = 'The SKU could not be saved. Check your connection and try again.';
    } finally {
      saving = false;
    }
  }

  /** Asks for the producer and product before anything is saved or exported. */
  async function namesMissing(): Promise<boolean> {
    attempted = true;
    exportError = null;
    if (nameProblems.length === 0) return false;
    await tick();
    document.getElementById(nameProblems[0]!.field)?.focus();
    return true;
  }

  /**
   * Saves the SKU, then exports it: the files go to storage and the export to its record. The
   * preview is the free watermarked one; print-ready files are paid for by the plan or a credit.
   */
  async function exportSku(edition: 'preview' | 'print') {
    if (await namesMissing()) return;
    exporting = edition;
    try {
      const id = await storeSku();
      if (!id) return;
      const res = await api<{
        export?: StoredExport;
        error?: string;
        message?: string;
        field?: string;
      }>(`skus/${encodeURIComponent(id)}/exports`, {
        method: 'POST',
        body: { issuedOn: localDate(), edition },
      });
      if (!res.ok || !res.data?.export) {
        const error = res.data?.error;
        if (error === 'blocked') {
          exportError = 'Resolve the items listed under Checks before exporting.';
          await tick();
          checksHeading?.focus();
          return;
        }
        if (error === 'free_export_used' && session.account) {
          session.account.freeExportAvailable = false;
        }
        if (error === 'payment_required') refreshSession();
        exportError = res.data?.message ?? 'The export failed. Try again.';
        if (error === 'producer_required') document.getElementById('producer')?.focus();
        return;
      }
      const stored = res.data.export;
      skuExports = [stored, ...skuExports];
      showFiles(stored.files.map((f) => ({ fileName: f.fileName, size: null, url: f.url })));
      filesEdition = edition;
      paymentNotice = null;
      if (edition === 'preview' && session.account) session.account.freeExportAvailable = false;
      if (edition === 'print') refreshSession(); // a credit used, or the plan unchanged
      await tick();
      filesHeading?.focus();
    } catch {
      exportError = 'The export failed. Check your connection and try again.';
    } finally {
      exporting = null;
    }
  }

  /** Saves the SKU and goes to Stripe Checkout to buy one print-ready export of it. */
  async function buyExport() {
    if (await namesMissing()) return;
    buying = true;
    try {
      const id = await storeSku();
      const message = id ? await startCheckout('export', id) : 'not saved';
      if (message) buying = false; // otherwise the browser is on its way to Stripe
      if (id && message) exportError = message;
    } catch {
      buying = false;
      exportError = 'Checkout could not be started. Check your connection and try again.';
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
    {#if skuNotice}
      <p class="msg block" role="alert">
        {skuNotice}
        {#if !account}<a href="/sign-in">Sign in</a>{:else}<a href="/skus">Your SKUs</a>{/if}
      </p>
    {/if}
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
    {#if account && skuId}
      <p class="hint">Saved SKU. <a href="/skus">All your SKUs</a></p>
    {/if}
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
        aria-describedby="producer-hint producer-msg"
      />
      <p class="hint" id="producer-hint">Names the files and appears on the proof sheet.</p>
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

    {#if account}
      {#if paymentNotice}
        <p class="msg {paymentNotice.kind}" role="status">{paymentNotice.text}</p>
      {/if}
      <div class="actions">
        <button type="button" class="secondary" onclick={saveSku} disabled={busy}>
          {saving ? 'Saving…' : skuId ? 'Save changes' : 'Save SKU'}
        </button>
        {#if account.printReady}
          <button
            type="button"
            class="primary"
            bind:this={printButton}
            onclick={() => exportSku('print')}
            aria-describedby="print-hint"
            disabled={busy}
          >
            {exporting === 'print' ? 'Exporting…' : 'Export print-ready files'}
          </button>
        {:else if exportProduct}
          <button
            type="button"
            class="primary"
            onclick={buyExport}
            aria-describedby="print-hint"
            disabled={busy}
          >
            {buying ? 'Opening checkout…' : `Buy this export: ${priceLabel(exportProduct)}`}
          </button>
        {/if}
        {#if account.freeExportAvailable}
          <button
            type="button"
            class="secondary"
            onclick={() => exportSku('preview')}
            aria-describedby="export-hint"
            disabled={busy}
          >
            {exporting === 'preview' ? 'Exporting…' : 'Export free preview files'}
          </button>
        {/if}
        <p class="saved" role="status">
          {skuId ? (unsaved ? 'Unsaved changes.' : 'Saved to your SKUs.') : ''}
        </p>
      </div>
      <p class="hint" id="print-hint">
        {#if account.printReady === 'subscription'}
          {account.plan === 'printer' ? 'Printer plan' : 'Producer plan'}: unlimited print-ready
          exports.
        {:else if account.printReady === 'credit'}
          {account.exportCredits} print-ready {account.exportCredits === 1 ? 'export' : 'exports'} to
          use.
        {:else if exportProduct}
          Print-ready SVG, PDF, PDF 1.4 and proof sheet, without the watermark.{planProduct
            ? ` Or export without limit on the Producer plan, ${priceLabel(planProduct)}.`
            : ''} Prices include GST. <a href="/billing">Plans and billing</a>
        {:else if billing}
          Print-ready exports open when payments are set up.
        {/if}
      </p>
      {#if account.freeExportAvailable}
        <p class="hint" id="export-hint">
          Watermarked SVG, PDF (to PDF/X-4 rules), PDF 1.4 and an A4 proof sheet, for checking size
          and layout. One free preview export per account.
        </p>
      {:else}
        <p>This account has used its free preview export.</p>
      {/if}
      <p class="hint">Every export saves the SKU and records the export with its rules version.</p>
    {:else}
      {#if freeExportAvailable}
        <button
          type="button"
          class="primary"
          onclick={exportPreview}
          aria-describedby="export-hint"
          disabled={exporting !== null}
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
      <p class="hint">
        <a href="/sign-in">Sign in</a> to save this product as a SKU, keep a record of each export and
        buy print-ready files.
      </p>
    {/if}

    {#if exportError}
      <p class="msg block" role="alert">{exportError}</p>
    {/if}

    {#if files.length > 0}
      <h3 tabindex="-1" bind:this={filesHeading}>
        {filesEdition === 'print' ? 'Your print-ready files' : 'Your preview files'}
      </h3>
      <ul class="files">
        {#each files as file (file.fileName)}
          <li>
            <a href={file.url} download={file.fileName}>{file.fileName}</a>
            {#if file.size !== null}<span class="size">{formatSize(file.size)}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}

    {#if account && skuExports.length > 0}
      <h3>Exports of this SKU</h3>
      <ol class="history">
        {#each skuExports as item (item.id)}
          <li>
            <p>
              <strong>{shortDate(item.createdAt)}</strong> · rules {item.rulesVersion} ·
              {item.watermarked
                ? 'watermarked preview'
                : item.entitlement === 'subscription'
                  ? 'print-ready, on the plan'
                  : 'print-ready, bought export'} ·
              <span class="hash" title={item.outputHash}
                >output hash {item.outputHash.slice(0, 12)}…</span
              >
            </p>
            <ul>
              {#each item.files as file (file.kind)}
                <li><a href={file.url} download={file.fileName}>{file.fileName}</a></li>
              {/each}
            </ul>
          </li>
        {/each}
      </ol>
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
  .choices {
    margin-bottom: 1rem;
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
  .export .actions {
    margin-top: 0.5rem;
  }
  .saved {
    margin: 0;
    color: var(--muted);
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
  .history {
    margin: 0;
    padding-left: 1.25rem;
  }
  .history > li {
    margin-bottom: 0.75rem;
  }
  .history p {
    margin: 0 0 0.25rem;
  }
  .history ul {
    margin: 0;
    padding-left: 1rem;
    word-break: break-all;
  }
  .hash {
    font-variant-numeric: tabular-nums;
  }
</style>
