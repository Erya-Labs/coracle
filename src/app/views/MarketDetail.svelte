<script lang="ts">
  import {tick} from "svelte"
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
    isOpenListing,
    listingActivity,
    listingFilter,
    makeListingDeletion,
    makeListingRemoval,
    makeMarketBid,
    msatToSats,
    proposeOrder,
    proposeOrderForBid,
    listingDeletionFilters,
    readBid,
    readListing,
    removalTimes,
  } from "src/domain"
  import {PublishStatus} from "@welshman/net"
  import {env, myLoad, publishOrderEvent, sign} from "src/engine"
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
    publishOrderEvent,
    async (filters, options) => {
      await myLoad({relays: env.DEFAULT_RELAYS, filters, skipCache: true}).catch(noop)

      return app.get().repository.query(filters, options)
    },
    $signer,
  ).then(pk => {
    orderReady = Boolean(pk)
  })

  const orderThis = async () => {
    const {sent, words} = await proposeOrder(listing)

    if (!sent) return showWarning(`The proposal was not sent: ${words}`)

    showInfo("Order proposed — the maker has it now.")
    router.at("market/orders").push()
  }

  const orderFromBid = async bid => {
    const {sent, words} = await proposeOrderForBid(listing, bid)

    if (!sent) return showWarning(`The order was not sent: ${words}`)

    showInfo(
      listing.kind === 30404
        ? "Order sent to the bidder — they accept it next."
        : "Order sent to the seller at your bid's price — they accept it next.",
    )
    router.at("market/orders").push()
  }

  const listingFilters = [listingFilter(address)]

  const listingEvents = deriveEvents(listingFilters)

  const bidEvents = deriveEvents(bidFilters(address))

  const relaySelections = $pubkey ? resolveRelays([inbox($pubkey)]) : Promise.resolve([])

  let loaded = false

  relaySelections
    .then(relays =>
      myLoad({
        relays: uniq([...relays, ...env.DEFAULT_RELAYS]),
        filters: [...listingFilters, ...bidFilters(address), ...listingDeletionFilters([address])],
      }),
    )
    .catch(noop)
    // The load answers once half the relays have; a slower one may still bring the listing.
    .then(() => setTimeout(() => (loaded = true), 3000))

  let confirmingDelete = false
  let deleting = false
  let removed = false
  let confirmBox
  let deleteButton

  const askToDelete = async () => {
    confirmingDelete = true
    await tick()
    confirmBox?.focus()
  }

  const keepListing = async () => {
    confirmingDelete = false
    await tick()
    deleteButton?.querySelector("button")?.focus()
  }

  // Counts as sent only once a relay has kept it.
  const publishToRelays = async event => {
    const pub = publisher.get().publish({
      event,
      relays: uniq([...getWriteRelays($pubkey), ...env.DEFAULT_RELAYS]),
    })

    await pub.settled()

    return pub.hasStatus(PublishStatus.Success)
  }

  // The listing goes out again marked sold or cancelled, with a deletion request dated between
  // the open and the closed versions (see removalTimes).
  const deleteListing = async () => {
    const {deletionAt, closedAt} = removalTimes(listing)
    const {template, error} = makeListingRemoval(listing, closedAt)

    if (error) return showWarning(`Nenya refused to build the closed listing: ${error}`)

    deleting = true

    try {
      const closed = await sign(template)
      const deletion = await sign(makeListingDeletion(listing, deletionAt))
      const [closedKept, deletionKept] = await Promise.all([
        publishToRelays(closed),
        publishToRelays(deletion),
      ])

      if (!closedKept && !deletionKept) {
        showWarning("No relay accepted the deletion. Check your connection and try again.")
      } else {
        removed = true
        showInfo(
          deletionKept
            ? "Listing deleted. Relays were asked to remove it; some may keep a copy."
            : "Listing closed, but no relay accepted the deletion request. Tap Delete again later.",
        )
      }
    } catch (e) {
      showWarning(`The listing was not deleted: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      deleting = false
      confirmingDelete = false
    }
  }

  let bidSats = null
  let bidPrefilled = false
  let bidContent = ""
  let loading = false

  $: result = $listingEvents.length > 0 ? readListing($listingEvents[0]) : null
  $: listing = result?.ok ? result.listing : null
  $: bids = $bidEvents.map(event => readBid(event))
  // The bid form starts once at the listing's own price instead of 0.
  $: if (listing && !bidPrefilled) {
    bidSats = msatToSats(listing.priceMsat)
    bidPrefilled = true
  }

  const submitBid = async () => {
    const {template, error} = makeMarketBid({
      pubkey: $pubkey,
      coordinate: address,
      priceSats: bidSats,
      content: bidContent,
    })

    if (error) {
      return showWarning(`The bid was not published: ${error}`)
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
  {#if removed}
    <Card>
      <p>
        This listing was deleted and no longer shows in this app's market. Relays were asked to
        remove it; some may keep a copy, and other apps may still show it.
      </p>
      <Button class="btn mt-3" on:click={() => router.at("market").push()}
        >Back to the market</Button>
    </Card>
  {:else if !result}
    {#if loaded}
      <Card>
        <p class="text-neutral-400">This listing was not found on your relays.</p>
      </Card>
    {:else}
      <Spinner delay={500} />
    {/if}
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
        <span class="text-xs uppercase text-neutral-400">
          {isOpenListing(listing) ? listingActivity(listing) : listing.status}
        </span>
      </div>
    </div>
    {#if listing.status === "UNKNOWN"}
      <Card>
        <p class="text-neutral-400">
          This listing has a status this app does not recognise ("{listing.statusToken}"). It cannot
          be ordered or bid on here.
        </p>
      </Card>
    {:else if !isOpenListing(listing)}
      <Card>
        <p class="text-neutral-400">
          This listing is closed ({listing.status.toLowerCase()}). It can no longer be ordered or
          bid on.
        </p>
      </Card>
    {/if}
    {#if $signer && listing.authorPubkey === $pubkey}
      {#if confirmingDelete}
        <div
          bind:this={confirmBox}
          tabindex="-1"
          role="alertdialog"
          aria-labelledby="delete-question"
          class="outline-none">
          <Card>
            <p id="delete-question">
              Delete this listing? It is marked {listing.kind === 30404 ? "cancelled" : "sold"} so it
              leaves the market, and relays are asked to remove it. Some relays may keep a copy. Orders
              not yet accepted can no longer be accepted.
            </p>
            <div class="mt-3 flex flex-wrap gap-2">
              <Button class="btn btn-danger" loading={deleting} on:click={deleteListing}>
                Delete listing
              </Button>
              <Button class="btn" disabled={deleting} on:click={keepListing}>Keep it</Button>
            </div>
          </Card>
        </div>
      {:else}
        <div bind:this={deleteButton}>
          <Button class="btn btn-danger" on:click={askToDelete}>
            <i class="fa fa-trash" /> Delete
          </Button>
        </div>
      {/if}
    {/if}
    {#if listing.kind === 30402 && $signer && listing.authorPubkey !== $pubkey && isOpenListing(listing)}
      <Button class="btn btn-accent" disabled={!orderReady} on:click={orderThis}>
        <i class="fa fa-handshake" /> Order this
      </Button>
      {#if !orderReady}
        <p class="text-sm text-neutral-400">
          Ordering works with any login whose signer supports nip44.
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
            {#if listing.kind === 30404 && $signer && listing.authorPubkey === $pubkey && isOpenListing(listing)}
              <Button
                class="btn btn-accent mt-3"
                disabled={!orderReady}
                on:click={() => orderFromBid(bid.bid)}>
                <i class="fa fa-handshake" /> Order from this bid
              </Button>
            {/if}
            {#if listing.kind === 30402 && $signer && bid.bid.bidderPubkey === $pubkey && isOpenListing(listing)}
              <Button
                class="btn btn-accent mt-3"
                disabled={!orderReady || !(msatToSats(bid.bid.priceMsat) > 0)}
                on:click={() => orderFromBid(bid.bid)}>
                <i class="fa fa-handshake" /> Order at my bid price
              </Button>
            {/if}
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
    {#if bids.length > 0 && listing.kind === 30402 && $signer && listing.authorPubkey === $pubkey && isOpenListing(listing)}
      <p class="text-sm text-neutral-400">
        A bid on your offer becomes an order when its bidder taps "Order at my bid price". Accept it
        in My Orders.
      </p>
    {/if}
    {#if bids.length === 0}
      <p class="text-neutral-400">No bids yet.</p>
    {:else if listing.kind === 30404 && $signer && listing.authorPubkey === $pubkey && !orderReady && isOpenListing(listing)}
      <p class="text-sm text-neutral-400">
        Ordering works with any login whose signer supports nip44.
      </p>
    {/if}
    {#if $signer && listing.authorPubkey !== $pubkey && isOpenListing(listing)}
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
