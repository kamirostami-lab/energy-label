<!--
  Millimetre ruler beside the true-size preview. One SVG user unit is one CSS millimetre, so the
  ticks line up with the preview image at every zoom. Decorative: the size is also given in text.
-->
<script lang="ts">
  let {
    lengthMm,
    zoom,
    orientation = 'horizontal',
  }: { lengthMm: number; zoom: number; orientation?: 'horizontal' | 'vertical' } = $props();

  const DEPTH = 6;
  const span = $derived(Math.ceil(lengthMm));
  const ticks = $derived(
    Array.from({ length: span + 1 }, (_, mm) => ({
      at: mm * zoom,
      size: mm % 10 === 0 ? 3.2 : mm % 5 === 0 ? 2.2 : 1.2,
      label: mm % 10 === 0 ? String(mm) : null,
    })),
  );
  const extent = $derived(span * zoom);
</script>

{#if orientation === 'horizontal'}
  <svg
    class="ruler"
    aria-hidden="true"
    width="{extent}mm"
    height="{DEPTH}mm"
    viewBox="0 0 {extent} {DEPTH}"
    overflow="visible"
  >
    {#each ticks as tick (tick.at)}
      <line
        x1={tick.at}
        x2={tick.at}
        y1={DEPTH}
        y2={DEPTH - tick.size}
        vector-effect="non-scaling-stroke"
      />
      {#if tick.label !== null}
        <text x={tick.at + 0.5} y={DEPTH - 3.4}>{tick.label}</text>
      {/if}
    {/each}
  </svg>
{:else}
  <svg
    class="ruler"
    aria-hidden="true"
    width="{DEPTH}mm"
    height="{extent}mm"
    viewBox="0 0 {DEPTH} {extent}"
    overflow="visible"
  >
    {#each ticks as tick (tick.at)}
      <line
        y1={tick.at}
        y2={tick.at}
        x1={DEPTH}
        x2={DEPTH - tick.size}
        vector-effect="non-scaling-stroke"
      />
      {#if tick.label !== null && tick.at > 0}
        <text x={0.2} y={tick.at + 2.2}>{tick.label}</text>
      {/if}
    {/each}
  </svg>
{/if}

<style>
  .ruler {
    display: block;
    color: var(--muted);
  }
  line {
    stroke: currentColor;
    stroke-width: 1px;
  }
  text {
    fill: currentColor;
    font-size: 2.3px;
    font-family: var(--font);
  }
</style>
