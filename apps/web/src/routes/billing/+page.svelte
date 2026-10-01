<script lang="ts">
  import { onMount, tick } from 'svelte';
  import {
    api,
    openPortal,
    priceLabel,
    shortDate,
    shows,
    startCheckout,
    takeCheckoutResult,
    type Billing,
    type Product,
  } from '$lib/account';
  import { session, waitForAccount } from '$lib/session.svelte';

  let billing = $state<Billing | null>(null);
  let loadError = $state<string | null>(null);
  let busy = $state<string | null>(null);
  let error = $state<string | null>(null);
  let notice = $state<{ text: string; kind: 'ok' | 'note' } | null>(null);
  let noticeEl = $state<HTMLElement | null>(null);

  const account = $derived(session.account ?? billing?.account ?? null);
  const planActive = $derived(account?.printReady === 'subscription');

  async function load() {
    try {
      const res = await api<Billing>('billing');
      if (res.ok) billing = res.data;
      else loadError = 'Plans could not be loaded. Reload the page to try again.';
    } catch {
      loadError = 'Plans could not be loaded. Check your connection and reload the page.';
    }
  }

  onMount(() => {
    const result = takeCheckoutResult();
    load();
    if (result?.outcome === 'cancelled') {
      notice = { text: 'Checkout was cancelled. Nothing was charged.', kind: 'note' };
    } else if (result?.outcome === 'complete') {
      notice = { text: 'Payment received. Confirming it with Stripe…', kind: 'note' };
      waitForAccount(shows(result.product)).then(async (confirmed) => {
        notice = confirmed
          ? { text: 'Payment confirmed. Thank you.', kind: 'ok' }
          : {
              text: 'Payment received. It can take a minute to show here: reload the page shortly.',
              kind: 'note',
            };
        await load();
        await tick();
        noticeEl?.focus();
      });
    }
  });

  async function buy(product: Product) {
    busy = product.id;
    error = await startCheckout(product.id);
    if (error) busy = null;
  }

  async function manage() {
    busy = 'portal';
    error = await openPortal();
    if (error) busy = null;
  }

  const status = (subscription: NonNullable<NonNullable<typeof account>['subscription']>) => {
    const end = subscription.currentPeriodEnd ? shortDate(subscription.currentPeriodEnd) : null;
    if (subscription.status === 'past_due') {
      return 'The last payment did not go through. Update your card under Manage billing.';
    }
    if (subscription.cancelAtPeriodEnd && end) return `Cancelled: it ends on ${end}.`;
    return end ? `Renews on ${end}.` : '';
  };
</script>

<svelte:head>
  <title>Plans and billing · Energy Panel</title>
</svelte:head>

<main id="main" class="wrap">
  <h1>Plans and billing</h1>
  <p class="lead">
    The generator and its live preview are free, and so is one watermarked preview export.
    Print-ready files, without the watermark, are bought one export at a time or come with a plan.
  </p>

  {#if notice}
    <p
      class="msg {notice.kind === 'ok' ? 'ok' : 'note'}"
      role="status"
      tabindex="-1"
      bind:this={noticeEl}
    >
      {notice.text}
    </p>
  {/if}

  {#if account}
    <section aria-labelledby="yours-heading">
      <h2 id="yours-heading">Your account</h2>
      <ul class="facts">
        {#if planActive && account.subscription}
          <li>
            <strong>{account.plan === 'printer' ? 'Printer plan' : 'Producer plan'}</strong>:
            unlimited print-ready exports. {status(account.subscription)}
          </li>
        {:else}
          <li>No plan.</li>
        {/if}
        {#if account.exportCredits > 0}
          <li>
            {account.exportCredits} print-ready {account.exportCredits === 1 ? 'export' : 'exports'}
            to use.
          </li>
        {/if}
        <li>
          {account.freeExportAvailable
            ? 'One free watermarked preview export left.'
            : 'Free watermarked preview export used.'}
        </li>
      </ul>
      {#if account.billingAccount}
        <button type="button" class="secondary" onclick={manage} disabled={busy !== null}>
          {busy === 'portal' ? 'Opening…' : 'Manage billing and invoices'}
        </button>
        <p class="hint">
          Change or cancel the plan, update the card and download invoices, on Stripe.
        </p>
      {/if}
    </section>
  {/if}

  <section aria-labelledby="plans-heading">
    <h2 id="plans-heading">Print-ready exports</h2>
    {#if loadError}
      <p class="msg block" role="alert">{loadError}</p>
    {:else if billing === null}
      <p>Loading…</p>
    {:else if !billing.available}
      <p>Payments are not available yet. Print-ready exports open when they are.</p>
    {:else}
      <ul class="products">
        {#each billing.products as product (product.id)}
          <li>
            <h3>{product.name}</h3>
            <p class="price">{priceLabel(product)} <span class="gst">GST included</span></p>
            <p>{product.summary}</p>
            {#if !account}
              <p><a href="/sign-in">Sign in to buy</a></p>
            {:else if product.mode === 'subscription' && planActive}
              <p class="current">Your plan is active.</p>
            {:else}
              <button
                type="button"
                class="primary"
                onclick={() => buy(product)}
                disabled={busy !== null}
              >
                {busy === product.id
                  ? 'Opening checkout…'
                  : product.mode === 'subscription'
                    ? `Subscribe: ${priceLabel(product)}`
                    : `Buy one export: ${priceLabel(product)}`}
              </button>
            {/if}
          </li>
        {/each}
      </ul>
      <p class="hint">
        Prices are in Australian dollars and include GST. Payments are handled by Stripe; Energy
        Panel never sees card details. A plan can be cancelled at any time and runs to the end of
        the month paid for.
      </p>
    {/if}
    {#if error}
      <p class="msg block" role="alert">{error}</p>
    {/if}
  </section>
</main>

<style>
  .wrap {
    max-width: 52rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 0;
  }
  h1 {
    font-size: 1.75rem;
  }
  h2 {
    font-size: 1.25rem;
  }
  h3 {
    font-size: 1.0625rem;
    margin: 0 0 0.25rem;
  }
  section {
    margin-bottom: 2rem;
  }
  .lead {
    max-width: 44rem;
  }
  .facts {
    padding-left: 1.25rem;
    margin: 0 0 1rem;
  }
  .products {
    list-style: none;
    padding: 0;
    margin: 0 0 1rem;
    display: grid;
    gap: 1rem;
  }
  @media (min-width: 40rem) {
    .products {
      grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    }
  }
  .products li {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 1rem;
  }
  .products p {
    margin: 0 0 0.75rem;
  }
  .price {
    font-size: 1.25rem;
    font-weight: 700;
  }
  .gst {
    font-size: 0.875rem;
    font-weight: 400;
    color: var(--muted);
  }
  .current {
    color: var(--ok);
    font-weight: 600;
  }
</style>
