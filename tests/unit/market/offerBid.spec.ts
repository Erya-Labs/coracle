import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {finalizeEvent} from "nostr-tools/pure"
import {FakeRelay, makeParty, stubFetch, tick} from "../../utils/marketParty"

const PNG = new Uint8Array(2048).map((_, i) => i % 251)

const both = async (a: any, b: any) => {
  tick()
  await a.sync()
  await b.sync()
}

// The seller posts an offer at 30 sats; the buyer bids a lower price on it.
const start = async (bidSats = 15) => {
  const relay = new FakeRelay()
  const seller = await makeParty(relay)
  const buyer = await makeParty(relay)
  const market: any = await import("src/domain/market")

  const offer = market.makeMarketOffer({
    pubkey: seller.pk,
    title: "A jpeg of a cat",
    summary: "",
    priceSats: 30,
  })

  if (offer.error) throw new Error(offer.error)

  const signedOffer = finalizeEvent(offer.template, seller.sk)
  const listing = market.readListing(signedOffer)

  if (!listing.ok) throw new Error(listing.reason)

  await relay.publish(signedOffer)

  const placed = market.makeMarketBid({
    pubkey: buyer.pk,
    coordinate: listing.listing.coordinate,
    priceSats: bidSats,
  })

  if (placed.error) throw new Error(placed.error)

  const signedBid = finalizeEvent(placed.template, buyer.sk)
  const bid = market.readBid(signedBid)

  if (!bid.ok) throw new Error(bid.reason)

  await relay.publish(signedBid)

  return {relay, seller, buyer, market, listing: listing.listing, bid: bid.bid}
}

describe("a trade from a bid on an offer", () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ["Date"], now: Date.UTC(2026, 10, 5, 12)})
    stubFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("settles a pretend trade at the bid's price, with the bidder as buyer", async () => {
    const {seller, buyer, listing, bid} = await start()

    const sent = await buyer.call((m: any) => m.proposeOrderForBid(listing, bid))

    expect(sent).toEqual({sent: true, words: ""})

    await both(buyer, seller)

    expect(seller.state()).toBe("PROPOSED")
    expect(seller.thread().buyerKey).toBe(buyer.pk)
    expect(seller.thread().providerKey).toBe(seller.pk)
    expect(buyer.thread().providerKey).toBe(seller.pk)
    expect(seller.thread().order.totalMsat).toBe("15000")

    await seller.call((m: any, t: any) => m.acceptOrder(t))
    await both(buyer, seller)
    await seller.call((m: any, t: any) => m.commitFile(t, PNG, "image/png"))
    await both(buyer, seller)

    expect(buyer.state()).toBe("COMMITTED")

    await seller.call((m: any, t: any) => m.sendBill(t))
    await both(buyer, seller)

    expect(buyer.state()).toBe("AWAITING_PAYMENT")

    await buyer.call((m: any, t: any) => m.payAndProve(t))
    await both(buyer, seller)

    expect(seller.state()).toBe("PAID")

    await seller.call((m: any, t: any) => m.releaseKey(t))
    await both(buyer, seller)
    await buyer.call((m: any, t: any) => m.verifyDelivery(t))

    expect(seller.state()).toBe("RELEASED")
    expect(buyer.state()).toBe("SETTLED")
    expect(Array.from(buyer.thread().delivered)).toEqual(Array.from(PNG))
  })

  it("lets nobody but the bidder order from a bid on an offer", async () => {
    const {relay, seller, listing, bid} = await start()
    const stranger = await makeParty(relay)

    expect((await stranger.call((m: any) => m.proposeOrderForBid(listing, bid))).sent).toBe(false)
    expect((await seller.call((m: any) => m.proposeOrderForBid(listing, bid))).sent).toBe(false)

    await seller.sync()

    expect(seller.thread()).toBeUndefined()
  })

  it("refuses a bid of 0 sats", async () => {
    const {buyer, market, listing} = await start()

    for (const priceSats of [0, -5, null, ""]) {
      const placed = market.makeMarketBid({
        pubkey: buyer.pk,
        coordinate: listing.coordinate,
        priceSats,
      })

      expect(placed.error).toBe("a bid needs a price above 0 sats")
    }
  })
})
