import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {finalizeEvent} from "nostr-tools/pure"
import {FakeRelay, makeParty, stubFetch, tick} from "../../utils/marketParty"

const PNG = new Uint8Array(2048).map((_, i) => i % 251)

const both = async (a: any, b: any) => {
  tick()
  await a.sync()
  await b.sync()
}

// The requester posts a request; the maker bids on it.
const start = async (bidSats = 21) => {
  const relay = new FakeRelay()
  const requester = await makeParty(relay)
  const maker = await makeParty(relay)
  const market: any = await import("src/domain/market")

  const request = market.makeMarketRequest({
    pubkey: requester.pk,
    title: "A picture of a cat",
    summary: "",
    priceSats: 30,
  })

  if (request.error) throw new Error(request.error)

  const signedRequest = finalizeEvent(request.template, requester.sk)
  const listing = market.readListing(signedRequest)

  if (!listing.ok) throw new Error(listing.reason)

  await relay.publish(signedRequest)

  const placed = market.makeMarketBid({
    pubkey: maker.pk,
    coordinate: listing.listing.coordinate,
    priceSats: bidSats,
  })

  if (placed.error) throw new Error(placed.error)

  const signedBid = finalizeEvent(placed.template, maker.sk)
  const bid = market.readBid(signedBid)

  if (!bid.ok) throw new Error(bid.reason)

  await relay.publish(signedBid)

  return {relay, requester, maker, listing: listing.listing, bid: bid.bid}
}

describe("a trade from a request and a bid", () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ["Date"], now: Date.UTC(2026, 10, 5, 12)})
    stubFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("settles a pretend trade with the requester as buyer and the bidder as maker", async () => {
    const {requester, maker, listing, bid} = await start()

    const sent = await requester.call((m: any) => m.proposeOrderForBid(listing, bid))

    expect(sent).toEqual({sent: true, words: ""})

    await both(requester, maker)

    expect(maker.state()).toBe("PROPOSED")
    expect(maker.thread().buyerKey).toBe(requester.pk)
    expect(maker.thread().providerKey).toBe(maker.pk)
    expect(requester.thread().providerKey).toBe(maker.pk)
    expect(maker.thread().order.totalMsat).toBe("21000")

    await maker.call((m: any, t: any) => m.acceptOrder(t))
    await both(requester, maker)
    await maker.call((m: any, t: any) => m.commitFile(t, PNG, "image/png"))
    await both(requester, maker)

    expect(requester.state()).toBe("COMMITTED")

    await maker.call((m: any, t: any) => m.sendBill(t))
    await both(requester, maker)

    expect(requester.state()).toBe("AWAITING_PAYMENT")

    await requester.call((m: any, t: any) => m.payAndProve(t))
    await both(requester, maker)

    expect(maker.state()).toBe("PAID")

    await maker.call((m: any, t: any) => m.releaseKey(t))
    await both(requester, maker)
    await requester.call((m: any, t: any) => m.verifyDelivery(t))

    expect(maker.state()).toBe("RELEASED")
    expect(requester.state()).toBe("SETTLED")
    expect(Array.from(requester.thread().delivered)).toEqual(Array.from(PNG))
  })

  it("lets nobody but the request's author order from a bid on it", async () => {
    const {relay, maker, listing, bid} = await start()
    const stranger = await makeParty(relay)

    const sent = await stranger.call((m: any) => m.proposeOrderForBid(listing, bid))

    expect(sent.sent).toBe(false)

    await maker.sync()

    expect(maker.thread()).toBeUndefined()
  })
})
