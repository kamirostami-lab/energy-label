<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, type Account } from '$lib/account';
  import { pendingDraft } from '$lib/draft';
  import { session } from '$lib/session.svelte';

  // The link's token is in the URL fragment, which browsers never send to a server. It is read
  // once, taken out of the address bar, and used only when the button is pressed, so a mail
  // scanner that opens the link cannot use it up.
  let token = $state<string | null>(null);
  let read = $state(false);
  let working = $state(false);
  let error = $state<string | null>(null);

  onMount(() => {
    token = new URLSearchParams(location.hash.slice(1)).get('token');
    // The router is still starting here, so the history API directly, keeping its state.
    if (location.hash) history.replaceState(history.state, '', location.pathname);
    read = true;
  });

  async function finish() {
    if (!token) return;
    working = true;
    error = null;
    try {
      const res = await api<{ account?: Account; message?: string }>('auth/verify', {
        method: 'POST',
        body: { token },
      });
      if (!res.ok || !res.data?.account) {
        error = res.data?.message ?? 'Signing in failed. Try again.';
        return;
      }
      session.account = res.data.account;
      session.checked = true;
      // Values entered before signing in wait in the generator; otherwise show the SKU list.
      await goto(pendingDraft() ? '/' : '/skus');
    } catch {
      error = 'Signing in failed. Check your connection and try again.';
    } finally {
      working = false;
    }
  }
</script>

<svelte:head>
  <title>Finish signing in · Energy Panel</title>
</svelte:head>

<main id="main" class="wrap">
  <h1>Finish signing in</h1>

  {#if !read}
    <p>Loading…</p>
  {:else if token}
    <p>Sign in to Energy Panel in this browser.</p>
    <button type="button" class="primary" onclick={finish} disabled={working}>
      {working ? 'Signing in…' : 'Finish signing in'}
    </button>
    {#if error}
      <p class="msg block" role="alert">{error}</p>
      <p><a href="/sign-in">Ask for a new sign-in link</a></p>
    {/if}
  {:else if session.account}
    <p>
      You are signed in as <strong>{session.account.email}</strong>. Go to
      <a href="/skus">your SKUs</a>.
    </p>
  {:else}
    <p>This page needs the link from your sign-in email, and each link works only once.</p>
    <p><a href="/sign-in">Ask for a new sign-in link</a></p>
  {/if}
</main>

<style>
  .wrap {
    max-width: 40rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 0;
  }
  h1 {
    font-size: 1.75rem;
  }
</style>
