<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { api } from '$lib/account';
  import { refreshSession, session } from '$lib/session.svelte';

  let { children } = $props();

  onMount(() => {
    refreshSession();
    // A sign-in link is usually opened in a new tab; coming back to this one picks it up.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !session.account) refreshSession();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });

  async function signOut() {
    await api('auth/sign-out', { method: 'POST' }).catch(() => undefined);
    session.account = null;
    await goto('/');
  }

  const current = (path: string) => (page.url.pathname === path ? 'page' : undefined);
</script>

<a class="skip" href="#main">Skip to main content</a>

<header class="site">
  <div class="wrap">
    <div class="top">
      <a class="name" href="/">Energy Panel</a>
      <nav aria-label="Main">
        <a href="/" aria-current={current('/')}>Generator</a>
        {#if session.account}
          <a href="/skus" aria-current={current('/skus')}>Your SKUs</a>
        {/if}
        <a href="/billing" aria-current={current('/billing')}>Plans</a>
      </nav>
      <div class="account">
        {#if session.account}
          <span class="email">{session.account.email}</span>
          <button type="button" class="link" onclick={signOut}>Sign out</button>
        {:else if session.checked}
          <a href="/sign-in" aria-current={current('/sign-in')}>Sign in</a>
        {/if}
      </div>
    </div>
    <p class="responsibility">
      Energy Panel formats the energy statement from the values you enter. You remain responsible
      for your label complying with the Australia New Zealand Food Standards Code.
    </p>
  </div>
</header>

{@render children()}

<footer class="site">
  <div class="wrap">
    <p>
      Energy Panel formats the statement; the producer remains responsible for compliance. It is not
      legal advice.
    </p>
    <p>Built by Komms-Haus.</p>
  </div>
</footer>

<style>
  .wrap {
    max-width: 78rem;
    margin: 0 auto;
    padding: 0 1rem;
  }
  .skip {
    position: absolute;
    left: 1rem;
    top: -3rem;
    background: var(--accent);
    color: var(--accent-ink);
    padding: 0.5rem 0.75rem;
    border-radius: var(--radius);
    z-index: 10;
  }
  .skip:focus {
    top: 0.5rem;
  }
  header.site {
    border-bottom: 1px solid var(--line);
    background: var(--soft);
  }
  header.site .wrap {
    padding-top: 0.75rem;
    padding-bottom: 0.75rem;
  }
  .top {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 1.5rem;
    margin-bottom: 0.25rem;
  }
  .name {
    font-weight: 700;
    font-size: 1.125rem;
    color: var(--ink);
    text-decoration: none;
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
  }
  nav a[aria-current='page'] {
    color: var(--ink);
    font-weight: 600;
    text-decoration: none;
  }
  .account {
    margin-left: auto;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.75rem;
  }
  .email {
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  button.link {
    font: inherit;
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    text-decoration: underline;
    cursor: pointer;
  }
  .responsibility {
    margin: 0;
    color: var(--muted);
    font-size: 0.9375rem;
    max-width: 60rem;
  }
  footer.site {
    border-top: 1px solid var(--line);
    margin-top: 3rem;
    color: var(--muted);
    font-size: 0.875rem;
  }
  footer.site .wrap {
    padding-top: 1rem;
    padding-bottom: 2rem;
  }
  footer.site p {
    margin: 0 0 0.25rem;
  }
</style>
