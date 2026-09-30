<script lang="ts">
  import { tick } from 'svelte';
  import { api } from '$lib/account';
  import { session } from '$lib/session.svelte';

  let email = $state('');
  let sending = $state(false);
  let sentTo = $state<string | null>(null);
  let minutes = $state(15);
  let fieldError = $state<string | null>(null);
  let error = $state<string | null>(null);
  let input = $state<HTMLInputElement | null>(null);
  let sentHeading = $state<HTMLElement | null>(null);

  async function requestLink(event: SubmitEvent) {
    event.preventDefault();
    fieldError = null;
    error = null;
    if (email.trim() === '') {
      fieldError = 'Enter your email address.';
      input?.focus();
      return;
    }
    sending = true;
    try {
      const res = await api<{ error?: string; message?: string; expiresInMinutes?: number }>(
        'auth/request',
        {
          method: 'POST',
          body: { email },
        },
      );
      if (res.ok) {
        sentTo = email.trim();
        minutes = res.data?.expiresInMinutes ?? minutes;
        await tick();
        sentHeading?.focus();
      } else if (res.data?.error === 'invalid_email') {
        fieldError = res.data.message ?? 'Enter a valid email address.';
        input?.focus();
      } else {
        error = res.data?.message ?? 'The sign-in link could not be sent. Try again.';
      }
    } catch {
      error = 'The sign-in link could not be sent. Check your connection and try again.';
    } finally {
      sending = false;
    }
  }
</script>

<svelte:head>
  <title>Sign in · Energy Panel</title>
</svelte:head>

<main id="main" class="wrap">
  <h1>Sign in</h1>

  {#if session.account}
    <p>
      You are signed in as <strong>{session.account.email}</strong>. Go to
      <a href="/skus">your SKUs</a>
      or the <a href="/">generator</a>.
    </p>
  {:else if sentTo}
    <h2 tabindex="-1" bind:this={sentHeading}>Check your email</h2>
    <p>
      We sent a sign-in link to <strong>{sentTo}</strong>. It works once and expires in {minutes}
      minutes. Open it in this browser to sign in here.
    </p>
    <p>
      Nothing arrived? Check your spam folder, or <button
        type="button"
        class="link"
        onclick={() => (sentTo = null)}>use another address</button
      >.
    </p>
  {:else}
    <p class="lead">
      An account keeps your products as SKU records, with every export, the rules version it used
      and its files. There is no password: we email you a link to sign in.
    </p>
    <form novalidate onsubmit={requestLink}>
      <div class="field">
        <label for="email">Email address</label>
        <input
          id="email"
          type="email"
          autocomplete="email"
          spellcheck="false"
          maxlength="254"
          bind:value={email}
          bind:this={input}
          aria-invalid={fieldError !== null}
          aria-describedby="email-msg"
        />
        <div id="email-msg">
          {#if fieldError}
            <p class="msg block">{fieldError}</p>
          {/if}
        </div>
      </div>
      <button type="submit" class="primary" disabled={sending}>
        {sending ? 'Sending…' : 'Email me a sign-in link'}
      </button>
    </form>
    {#if error}
      <p class="msg block" role="alert">{error}</p>
    {/if}
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
  h2 {
    font-size: 1.25rem;
  }
  .lead {
    margin-bottom: 1.25rem;
  }
  input[type='email'] {
    max-width: 26rem;
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
</style>
