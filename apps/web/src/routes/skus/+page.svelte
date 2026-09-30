<script lang="ts">
  import { BEVERAGE_TYPES } from '@energy-panel/panel/settings';
  import { api, shortDate, type Account, type SkuSummary } from '$lib/account';
  import { session } from '$lib/session.svelte';

  let skus = $state<SkuSummary[] | null>(null);
  let loadError = $state<string | null>(null);

  let orgName = $state('');
  let role = $state<Account['role']>('producer');
  let saving = $state(false);
  let saved = $state(false);
  let accountError = $state<{ field: string | null; message: string } | null>(null);
  let filledFor: string | null = null;

  // Fill the account form once the session is known, and load the SKUs.
  $effect(() => {
    const account = session.account;
    if (!account || filledFor === account.id) return;
    filledFor = account.id;
    orgName = account.orgName ?? '';
    role = account.role;
    loadSkus();
  });

  async function loadSkus() {
    loadError = null;
    try {
      const res = await api<{ skus: SkuSummary[] }>('skus');
      if (res.ok) skus = res.data.skus;
      else loadError = 'Your SKUs could not be loaded. Reload the page to try again.';
    } catch {
      loadError = 'Your SKUs could not be loaded. Check your connection and reload the page.';
    }
  }

  async function saveAccount(event: SubmitEvent) {
    event.preventDefault();
    saving = true;
    saved = false;
    accountError = null;
    try {
      const res = await api<{ account?: Account; message?: string; field?: string }>('account', {
        method: 'PATCH',
        body: { orgName, role },
      });
      if (res.ok && res.data.account) {
        session.account = res.data.account;
        saved = true;
      } else {
        accountError = {
          field: res.data?.field ?? null,
          message: res.data?.message ?? 'Your details could not be saved. Try again.',
        };
      }
    } catch {
      accountError = {
        field: null,
        message: 'Your details could not be saved. Check your connection and try again.',
      };
    } finally {
      saving = false;
    }
  }

  const beverageLabel = (id: string | null) =>
    BEVERAGE_TYPES.find((t) => t.id === id)?.label ?? '—';
  const roles: Array<{ value: Account['role']; label: string }> = [
    { value: 'producer', label: 'Producer' },
    { value: 'printer', label: 'Printer (prepress)' },
    { value: 'designer', label: 'Designer' },
  ];
</script>

<svelte:head>
  <title>Your SKUs · Energy Panel</title>
</svelte:head>

<main id="main" class="wrap">
  <h1>Your SKUs</h1>

  {#if !session.checked}
    <p>Loading…</p>
  {:else if !session.account}
    <p>
      <a href="/sign-in">Sign in</a> to see your SKUs: each product’s values, and every export with the
      rules version it used.
    </p>
  {:else}
    <section aria-labelledby="skus-heading">
      <div class="bar">
        <h2 id="skus-heading">Saved SKUs</h2>
        <div class="actions">
          <a href="/">New SKU</a>
          {#if skus && skus.length > 0}
            <a href="/api/skus.csv" download>Download the list (CSV)</a>
          {/if}
          {#if skus?.some((s) => s.exportCount > 0)}
            <a href="/api/exports.csv" download>Download the export record (CSV)</a>
          {/if}
        </div>
      </div>
      {#if loadError}
        <p class="msg block" role="alert">{loadError}</p>
      {:else if skus === null}
        <p>Loading…</p>
      {:else if skus.length === 0}
        <p>
          No SKUs yet. Enter a product in the <a href="/">generator</a> and select
          <strong>Save SKU</strong>.
        </p>
      {:else}
        <div class="table">
          <table>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Producer</th>
                <th scope="col">Beverage</th>
                <th scope="col">Vintage or batch</th>
                <th scope="col">Last export</th>
                <th scope="col">Rules version</th>
                <th scope="col" class="number">Exports</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {#each skus as sku (sku.id)}
                <tr>
                  <th scope="row"><a href="/?sku={encodeURIComponent(sku.id)}">{sku.name}</a></th>
                  <td>{sku.producer ?? '—'}</td>
                  <td>{beverageLabel(sku.beverageType)}</td>
                  <td>{sku.vintageOrBatch ?? '—'}</td>
                  <td>{sku.lastExport ? shortDate(sku.lastExport.createdAt) : 'Not exported'}</td>
                  <td>{sku.lastExport?.rulesVersion ?? '—'}</td>
                  <td class="number">{sku.exportCount}</td>
                  <td>{shortDate(sku.updatedAt)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="hint">
          Open a SKU to change its values, export it, or download the files of an earlier export.
        </p>
      {/if}
    </section>

    <section aria-labelledby="account-heading">
      <h2 id="account-heading">Account</h2>
      <p>Signed in as <strong>{session.account.email}</strong>.</p>
      <form novalidate onsubmit={saveAccount}>
        <div class="field">
          <label for="org-name">Organisation name</label>
          <input
            id="org-name"
            type="text"
            autocomplete="organization"
            maxlength="80"
            bind:value={orgName}
            oninput={() => (saved = false)}
            aria-invalid={accountError?.field === 'orgName'}
            aria-describedby="org-name-hint"
          />
          <p class="hint" id="org-name-hint">Fills in the producer for new SKUs.</p>
        </div>
        <div class="field">
          <label for="role">Role</label>
          <select id="role" bind:value={role} onchange={() => (saved = false)}>
            {#each roles as option (option.value)}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
        <div class="actions">
          <button type="submit" class="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save account details'}
          </button>
          <p class="saved" role="status">{saved ? 'Account details saved.' : ''}</p>
        </div>
        {#if accountError}
          <p class="msg block" role="alert">{accountError.message}</p>
        {/if}
      </form>
      <p class="hint">
        {session.account.freeExportAvailable
          ? 'This account has one free watermarked preview export.'
          : 'This account has used its free watermarked preview export.'}
        Print-ready exports open when checkout is available.
      </p>
    </section>
  {/if}
</main>

<style>
  .wrap {
    max-width: 78rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 0;
  }
  h1 {
    font-size: 1.75rem;
  }
  h2 {
    font-size: 1.25rem;
  }
  section {
    margin-bottom: 2.25rem;
  }
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem 1.5rem;
    margin-bottom: 0.75rem;
  }
  .bar h2 {
    margin: 0;
  }
  .table {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    min-width: 44rem;
  }
  th,
  td {
    text-align: left;
    padding: 0.5rem 0.75rem 0.5rem 0;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  thead th {
    font-size: 0.875rem;
    color: var(--muted);
    font-weight: 600;
  }
  tbody th {
    font-weight: 600;
  }
  .number {
    text-align: right;
  }
  .saved {
    margin: 0;
    color: var(--ok);
    font-weight: 600;
  }
</style>
