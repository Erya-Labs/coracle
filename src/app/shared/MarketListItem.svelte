<script lang="ts">
  import Card from "src/partials/Card.svelte"
  import Link from "src/partials/Link.svelte"
  import PersonBadgeSmall from "src/app/shared/PersonBadgeSmall.svelte"
  import {router} from "src/app/util/router"
  import {msatToSats, listingActivity} from "src/domain"

  export let listing

  const href = router.at("market").of(listing.coordinate).toString()

  $: activity = listingActivity(listing)
</script>

<Link {href}>
  <Card interactive>
    <div class="flex items-center justify-between gap-4">
      <div class="flex min-w-0 flex-col gap-1">
        <div class="flex items-center gap-2">
          <span
            class="whitespace-nowrap rounded bg-neutral-800 px-2 py-1 text-xs uppercase text-tinted-400">
            {listing.side}
          </span>
          <span class="truncate font-bold">{listing.title}</span>
        </div>
        {#if listing.summary}
          <span class="truncate text-sm text-neutral-400">{listing.summary}</span>
        {/if}
        <PersonBadgeSmall pubkey={listing.authorPubkey} />
      </div>
      <div class="flex flex-col items-end gap-1 whitespace-nowrap">
        <span class="font-bold">{msatToSats(listing.priceMsat).toLocaleString()} sats</span>
        <span class="text-xs uppercase text-neutral-400">{activity}</span>
      </div>
    </div>
  </Card>
</Link>
