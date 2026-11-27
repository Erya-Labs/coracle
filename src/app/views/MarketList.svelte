<script lang="ts">
  import {noop, uniq} from "@welshman/lib"
  import {inbox} from "@welshman/util"
  import {fly} from "src/util/transition"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import Button from "src/partials/Button.svelte"
  import Card from "src/partials/Card.svelte"
  import Input from "src/partials/Input.svelte"
  import FilterChip from "src/app/shared/FilterChip.svelte"
  import MarketListItem from "src/app/shared/MarketListItem.svelte"
  import {router} from "src/app/util/router"
  import {
    isOpenListing,
    listingDeletionFilters,
    marketFilters,
    readListing,
    searchListings,
    sortListings,
  } from "src/domain"
  import {env, myLoad, userSettings} from "src/engine"
  import {deriveEvents, pubkey, resolveRelays, signer} from "src/engine/core"

  const createListing = () => router.at("market/create").open()

  const events = deriveEvents(marketFilters)

  const relaySelections = $pubkey ? resolveRelays([inbox($pubkey)]) : Promise.resolve([])

  const load = (filters: any[]) =>
    relaySelections
      .then(relays => myLoad({relays: uniq([...relays, ...env.DEFAULT_RELAYS]), filters}))
      .catch(noop)

  // Nothing is fetched unless the user has turned the marketplace on.
  if (userSettings.get().enable_market) load(marketFilters)

  // Deletion requests are fetched for each listing once; the event store then drops what they
  // delete.
  const askedForDeletions = new Set<string>()

  let query = ""
  let sortBy: "date" | "price" = "date"
  let reverse = false

  $: decoded = $events.map(event => ({event, result: readListing(event)}))
  $: listings = decoded.filter(d => d.result.ok).map(d => d.result.listing)
  $: refused = decoded.filter(d => !d.result.ok)
  $: open = listings.filter(isOpenListing)
  $: shown = sortListings(searchListings(open, query), {by: sortBy, reverse})

  $: {
    const fresh = listings.map(l => l.coordinate).filter(c => !askedForDeletions.has(c))

    if (fresh.length > 0 && $userSettings.enable_market) {
      fresh.forEach(c => askedForDeletions.add(c))
      load(listingDeletionFilters(fresh))
    }
  }
</script>

<FlexColumn>
  <div class="flex flex-wrap items-center justify-between gap-4">
    <div class="flex items-center gap-3">
      <i class="fa fa-store fa-lg text-accent" />
      <h2 class="staatliches text-2xl">Marketplace</h2>
    </div>
    <div class="flex gap-2">
      <Button class="btn" disabled={!$signer} on:click={() => router.at("market/orders").push()}>
        <i class="fa fa-handshake" /> My Orders
      </Button>
      <Button class="btn btn-accent" disabled={!$signer} on:click={createListing}>
        <i class="fa fa-plus" /> Create
      </Button>
    </div>
  </div>
  {#if !$userSettings.enable_market}
    <Card>
      <p class="py-8 text-center text-neutral-400">
        The marketplace is off, and nothing is fetched while it stays off. Turn on "Enable the
        marketplace" in Settings to use it.
      </p>
    </Card>
  {/if}
  <p class="text-sm text-neutral-400">
    Requests and offers for commissioned work, paid in sats. Everything shown here passed the nenya
    library's checks; anything that failed them is counted below, never rendered as good.
  </p>
  <Input bind:value={query} placeholder="Search listings">
    <i slot="before" class="fa fa-search" />
  </Input>
  <div class="flex flex-wrap items-center gap-2">
    <FilterChip active={sortBy === "date"} on:click={() => (sortBy = "date")}>
      Sort by date
    </FilterChip>
    <FilterChip active={sortBy === "price"} on:click={() => (sortBy = "price")}>
      Sort by price
    </FilterChip>
    <FilterChip active={reverse} on:click={() => (reverse = !reverse)}>Reverse order</FilterChip>
  </div>
  {#each shown as listing (listing.coordinate)}
    <div in:fly={{y: 20}}>
      <MarketListItem {listing} />
    </div>
  {/each}
  {#if open.length === 0}
    <Card>
      <div class="flex flex-col items-center gap-2 py-8 text-center text-neutral-400">
        <i class="fa fa-store fa-2x" />
        <p>No listings found on your relays.</p>
        <Button class="btn btn-low mt-2" disabled={!$signer} on:click={createListing}>
          <i class="fa fa-plus" /> Create a listing
        </Button>
      </div>
    </Card>
  {:else if shown.length === 0}
    <Card>
      <p class="py-8 text-center text-neutral-400">No listings match "{query}".</p>
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
