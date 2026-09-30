<script lang="ts">
  import '../app.css';

  let { children } = $props();
</script>

<a class="skip" href="#main">Skip to the generator</a>

<header class="site">
  <div class="wrap">
    <p class="name">Energy Panel</p>
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
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1.5rem;
    align-items: baseline;
    padding-top: 0.75rem;
    padding-bottom: 0.75rem;
  }
  .name {
    margin: 0;
    font-weight: 700;
    font-size: 1.125rem;
  }
  .responsibility {
    margin: 0;
    color: var(--muted);
    font-size: 0.9375rem;
    flex: 1 1 28rem;
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
