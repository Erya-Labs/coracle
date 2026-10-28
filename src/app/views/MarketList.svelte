<script lang="ts">
  import {noop, uniq} from "@welshman/lib"
  import {inbox} from "@welshman/util"
  import {fly} from "src/util/transition"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import Button from "src/partials/Button.svelte"
  import Card from "src/partials/Card.svelte"
  import MarketListItem from "src/app/shared/MarketListItem.svelte"
  import {router} from "src/app/util/router"
  import {marketFilters, readListing} from "src/domain"
  import {env, myLoad} from "src/engine"
  import {deriveEvents, pubkey, resolveRelays, signer} from "src/engine/core"

  const createRequest = () => router.at("market/create").open()

  const events = deriveEvents(marketFilters)

  const relaySelections = $pubkey ? resolveRelays([inbox($pubkey)]) : Promise.resolve([])

  relaySelections
    .then(relays =>
      myLoad({relays: uniq([...relays, ...env.DEFAULT_RELAYS]), filters: marketFilters}),
    )
    .catch(noop)

  $: decoded = $events.map(event => ({event, result: readListing(event)}))
  $: listings = decoded.filter(d => d.result.ok).map(d => d.result.listing)
  $: refused = decoded.filter(d => !d.result.ok)
</script>

<FlexColumn>
  <div class="flex items-center justify-between gap-4">
    <div class="flex items-center gap-3">
      <i class="fa fa-store fa-lg text-accent" />
      <h2 class="staatliches text-2xl">Marketplace</h2>
    </div>
    <div class="flex gap-2">
      <Button class="btn" disabled={!$signer} on:click={() => router.at("market/orders").push()}>
        <i class="fa fa-handshake" /> Orders
      </Button>
      <Button class="btn btn-accent" disabled={!$signer} on:click={createRequest}>
        <i class="fa fa-plus" /> Listing
      </Button>
    </div>
  </div>
  <p class="text-sm text-neutral-400">
    Requests and offers for commissioned work, paid in sats. Everything shown here passed the nenya
    library's checks; anything that failed them is counted below, never rendered as good.
  </p>
  {#each listings as listing (listing.coordinate)}
    <div in:fly={{y: 20}}>
      <MarketListItem {listing} />
    </div>
  {/each}
  {#if listings.length === 0}
    <Card>
      <div class="flex flex-col items-center gap-2 py-8 text-center text-neutral-400">
        <i class="fa fa-store fa-2x" />
        <p>No listings found on your relays.</p>
        <Button class="btn btn-low mt-2" disabled={!$signer} on:click={createRequest}>
          <i class="fa fa-plus" /> Post a request
        </Button>
      </div>
    </Card>
  {/if}
  {#if refused.length > 0}
    <Card>
      <p class="text-sm text-neutral-400">
        {refused.length}
        {refused.length === 1 ? "event" : "events"} tagged as marketplace listings failed nenya's checks
        and {refused.length === 1 ? "is" : "are"} not shown:
      </p>
      {#each refused as { event, result } (event.id)}
        <p class="text-sm text-neutral-500">
          {result.reason}{result.detail ? ` — ${result.detail}` : ""}
        </p>
      {/each}
    </Card>
  {/if}
</FlexColumn>
