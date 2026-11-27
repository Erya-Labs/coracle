<script lang="ts">
  // A rounded on/off button for filter and sort choices.
  export let active = false
</script>

<button
  type="button"
  aria-pressed={active}
  class="cursor-pointer whitespace-nowrap rounded-full border border-solid px-3 py-1 text-sm"
  class:border-accent={active}
  class:bg-accent={active}
  class:text-white={active}
  class:border-neutral-600={!active}
  class:text-neutral-300={!active}
  on:click>
  <slot />
</button>
