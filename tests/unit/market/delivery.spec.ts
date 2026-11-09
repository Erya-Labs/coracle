import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {FakeRelay, makeListing, makeParty, stubFetch, tick} from "../../utils/marketParty"

const file = (size: number) => new Uint8Array(size).map((_, i) => i % 251)

const both = async (a: any, b: any) => {
  tick()
  await a.sync()
  await b.sync()
}

const toAccepted = async (relay: FakeRelay) => {
  const seller = await makeParty(relay)
  const buyer = await makeParty(relay)
  const listing = await makeListing(seller)

  await buyer.call((m: any) => m.proposeOrder(listing))
  await both(buyer, seller)
  await seller.call((m: any, t: any) => m.acceptOrder(t))
  await both(buyer, seller)

  expect(buyer.state()).toBe("ACCEPTED")

  return {seller, buyer}
}

describe("delivering the locked file", () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ["Date"], now: Date.UTC(2026, 10, 5, 12)})
    stubFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("sends no commitment for a file the relay refused", async () => {
    const relay = new FakeRelay()
    const {seller, buyer} = await toAccepted(relay)
    const kept = relay.events.length

    relay.maxMessage = 4096

    const r = await seller.call((m: any, t: any) => m.commitFile(t, file(8192), "image/png"))
    await both(buyer, seller)

    expect(r).toEqual({sent: false, words: "no relay kept the locked file"})
    expect(relay.events.length).toBe(kept)
    expect(buyer.state()).toBe("ACCEPTED")
  })

  it("refuses a file over 40,000 bytes before uploading it", async () => {
    const relay = new FakeRelay(65536)
    const {seller, buyer} = await toAccepted(relay)
    const kept = relay.events.length

    const r = await seller.call((m: any, t: any) => m.commitFile(t, file(40_001), "image/png"))
    await both(buyer, seller)

    expect(r.sent).toBe(false)
    expect(r.words).toContain("40000 bytes")
    expect(relay.events.length).toBe(kept)
    expect(buyer.state()).toBe("ACCEPTED")
  })

  it("commits a 40,000-byte file on a relay that takes 65,536 bytes", async () => {
    const relay = new FakeRelay(65536)
    const {seller, buyer} = await toAccepted(relay)

    const r = await seller.call((m: any, t: any) => m.commitFile(t, file(40_000), "image/png"))
    await both(buyer, seller)

    expect(r.sent).toBe(true)
    expect(buyer.state()).toBe("COMMITTED")
  })

  it("answers not sent when a relay does not keep a message", async () => {
    const relay = new FakeRelay()
    const {buyer} = await toAccepted(relay)

    relay.maxMessage = 0

    const r = await buyer.call((m: any, t: any) => m.cancelOrder(t))

    expect(r).toEqual({sent: false, words: "no relay kept the message"})
  })
})

describe("committing again after a copy was not kept", () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ["Date"], now: Date.UTC(2026, 10, 5, 12)})
    stubFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  const keyHex = (party: any) =>
    JSON.parse(party.storage.get("nenya-order-secrets"))[party.thread().orderId].keyHex

  // Refuses the wraps addressed to one party, commits, then commits again with all kept.
  const commitTwice = async (relay: FakeRelay, seller: any, buyer: any, refused: string) => {
    relay.refuse = (e: any) => e.kind === 1059 && e.tags.some((t: string[]) => t[1] === refused)

    const first = await seller.call((m: any, t: any) => m.commitFile(t, file(2048), "image/png"))
    await both(buyer, seller)
    const key = keyHex(seller)
    const states = [buyer.state(), seller.state()]

    expect(first.sent).toBe(false)

    relay.refuse = () => false

    const second = await seller.call((m: any, t: any) => m.commitFile(t, file(99), "image/jpeg"))
    await both(buyer, seller)

    expect(second.sent).toBe(true)
    expect(keyHex(seller)).toBe(key)
    expect(buyer.thread().commitment.xHex).toBe(seller.thread().commitment.xHex)

    return states
  }

  it("sends the same commitment when the seller's own copy was not kept", async () => {
    const relay = new FakeRelay()
    const {seller, buyer} = await toAccepted(relay)

    expect(await commitTwice(relay, seller, buyer, seller.pk)).toEqual(["COMMITTED", "ACCEPTED"])

    const commits = buyer.thread().log.filter((l: any) => l.call === "stepOrderWithCommitment")

    expect(commits.length).toBe(1)

    await seller.call((m: any, t: any) => m.sendBill(t))
    await both(buyer, seller)
    await buyer.call((m: any, t: any) => m.payAndProve(t))
    await both(buyer, seller)
    await seller.call((m: any, t: any) => m.releaseKey(t))
    await both(buyer, seller)
    await buyer.call((m: any, t: any) => m.verifyDelivery(t))

    expect(buyer.state()).toBe("SETTLED")
    expect(Array.from(buyer.thread().delivered)).toEqual(Array.from(file(2048)))
  })

  it("sends the same commitment when the buyer's copy was not kept", async () => {
    const relay = new FakeRelay()
    const {seller, buyer} = await toAccepted(relay)

    await commitTwice(relay, seller, buyer, buyer.pk)

    expect(buyer.state()).toBe("COMMITTED")
  })
})
