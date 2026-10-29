<script lang="ts">
  import {noop, uniq} from "@welshman/lib"
  import {inbox} from "@welshman/util"
  import {fly} from "src/util/transition"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import Card from "src/partials/Card.svelte"
  import Field from "src/partials/Field.svelte"
  import Input from "src/partials/Input.svelte"
  import Textarea from "src/partials/Textarea.svelte"
  import Button from "src/partials/Button.svelte"
  import Spinner from "src/partials/Spinner.svelte"
  import PersonBadge from "src/app/shared/PersonBadge.svelte"
  import {showInfo, showWarning} from "src/partials/Toast.svelte"
  import {router} from "src/app/util/router"
  import {
    bidFilters,
    bidActivity,
    connectOrderChannel,
    listingActivity,
    makeMarketBid,
    msatToSats,
    proposeOrder,
    readBid,
    readListing,
  } from "src/domain"
  import {env, myLoad, sign} from "src/engine"
  import {
    app,
    deriveEvents,
    getWriteRelays,
    pubkey,
    publisher,
    resolveRelays,
    signer,
  } from "src/engine/core"

  export let address

  let orderReady = false

  connectOrderChannel(
    event => publisher.get().publish({event, relays: env.DEFAULT_RELAYS}),
    async filters => {
      await myLoad({relays: env.DEFAULT_RELAYS, filters, skipCache: true}).catch(noop)

      return app.get().repository.query(filters)
    },
  ).then(pk => {
    orderReady = Boolean(pk)
  })

  const orderThis = async () => {
    const {sent, words} = await proposeOrder(listing)

    if (!sent) return showWarning(`Nenya refused the proposal: ${words}`)

    showInfo("Order proposed — the maker has it now.")
    router.at("market/orders").push()
  }

  const [kind, author, dValue] = address.split(":")

  const listingFilters = [{kinds: [parseInt(kind)], authors: [author], "#d": [dValue]}]

  const listingEvents = deriveEvents(listingFilters)

  const bidEvents = deriveEvents(bidFilters(address))

  const relaySelections = $pubkey ? resolveRelays([inbox($pubkey)]) : Promise.resolve([])

  relaySelections
    .then(relays =>
      myLoad({
        relays: uniq([...relays, ...env.DEFAULT_RELAYS]),
        filters: [...listingFilters, ...bidFilters(address)],
      }),
    )
    .catch(noop)

  let bidSats = 0
  let bidContent = ""
  let loading = false

  $: result = $listingEvents.length > 0 ? readListing($listingEvents[0]) : null
  $: listing = result?.ok ? result.listing : null
  $: bids = $bidEvents.map(event => readBid(event))

  const submitBid = async () => {
    const {template, error} = makeMarketBid({
      pubkey: $pubkey,
      coordinate: address,
      priceSats: bidSats,
      content: bidContent,
    })

    if (error) {
      return showWarning(`Nenya refused to build the bid: ${error}`)
    }

    loading = true

    try {
      const event = await sign(template)

      publisher
        .get()
        .publish({event, relays: uniq([...getWriteRelays($pubkey), ...env.DEFAULT_RELAYS])})
      showInfo("Your bid has been published!")
      bidContent = ""
    } finally {
      loading = false
    }
  }
</script>

<FlexColumn>
  {#if !result}
    <Spinner delay={500} />
  {:else if !listing}
    <Card>
      <p class="text-neutral-400">
        This event is tagged as a marketplace listing, but nenya refused it: {result.reason}
        {result.detail ? ` — ${result.detail}` : ""}
      </p>
    </Card>
  {:else}
    <div class="flex items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <span class="rounded bg-neutral-800 px-2 py-1 text-xs uppercase text-tinted-400">
          {listing.side}
        </span>
        <h2 class="staatliches text-2xl">{listing.title}</h2>
      </div>
      <div class="flex flex-col items-end whitespace-nowrap">
        <span class="font-bold">{msatToSats(listing.priceMsat).toLocaleString()} sats</span>
        <span class="text-xs uppercase text-neutral-400">{listingActivity(listing)}</span>
      </div>
    </div>
    {#if listing.kind === 30402 && $signer && listing.authorPubkey !== $pubkey}
      <Button class="btn btn-accent" disabled={!orderReady} on:click={orderThis}>
        <i class="fa fa-handshake" /> Order this
      </Button>
      {#if !orderReady}
        <p class="text-sm text-neutral-400">
          Ordering needs a NIP-07 signer with nip44 — nos2x, Alby, or the dev test signer.
        </p>
      {/if}
    {/if}
    <PersonBadge pubkey={listing.authorPubkey} />
    {#if listing.summary}
      <p class="text-neutral-400">{listing.summary}</p>
    {/if}
    {#if listing.content}
      <Card>
        <p class="whitespace-pre-wrap">{listing.content}</p>
      </Card>
    {/if}
    <div class="flex items-center gap-3">
      <i class="fa fa-gavel fa-lg text-accent" />
      <h2 class="staatliches text-2xl">Bids</h2>
    </div>
    {#each bids as bid, i (i)}
      <div in:fly={{y: 20}}>
        {#if bid.ok}
          <Card>
            <div class="flex items-center justify-between gap-4">
              <div class="flex min-w-0 flex-col gap-1">
                <PersonBadge pubkey={bid.bid.bidderPubkey} />
                {#if bid.bid.content}
                  <p class="text-sm text-neutral-400">{bid.bid.content}</p>
                {/if}
              </div>
              <div class="flex flex-col items-end whitespace-nowrap">
                <span class="font-bold">{msatToSats(bid.bid.priceMsat).toLocaleString()} sats</span>
                <span class="text-xs uppercase text-neutral-400">{bidActivity(bid.bid)}</span>
              </div>
            </div>
          </Card>
        {:else}
          <Card>
            <p class="text-sm text-neutral-500">
              A bid on this listing failed nenya's checks and is not shown: {bid.reason}
            </p>
          </Card>
        {/if}
      </div>
    {/each}
    {#if bids.length === 0}
      <p class="text-neutral-400">No bids yet.</p>
    {/if}
    {#if $signer}
      <form on:submit|preventDefault={submitBid}>
        <FlexColumn small>
          <Field label="Your bid (sats)">
            <Input type="number" bind:value={bidSats} />
          </Field>
          <Field label="Message (optional)">
            <Textarea bind:value={bidContent} placeholder="When you can deliver, questions..." />
          </Field>
          <Button type="submit" class="btn btn-accent" {loading}>Place bid</Button>
        </FlexColumn>
      </form>
    {/if}
  {/if}
</FlexColumn>
