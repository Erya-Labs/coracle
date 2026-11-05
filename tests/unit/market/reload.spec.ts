import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {FakeRelay, makeListing, makeParty, stubFetch, tick} from "../../utils/marketParty"

const PNG = new Uint8Array(2048).map((_, i) => i % 251)

const start = async () => {
  const relay = new FakeRelay()
  const seller = await makeParty(relay)
  const buyer = await makeParty(relay)
  const listing = await makeListing(seller)

  return {relay, seller, buyer, listing}
}

const both = async (a: any, b: any) => {
  tick()
  await a.sync()
  await b.sync()
}

const reopen = async (party: any) => {
  const again = await makeParty(party.relay, party)

  await again.sync()

  return again
}

const forget = (party: any) => party.storage.delete("nenya-first-seen")

const toCommitted = async ({seller, buyer, listing}: any, step = both) => {
  await buyer.call((m: any) => m.proposeOrder(listing))
  await step(buyer, seller)
  await seller.call((m: any, t: any) => m.acceptOrder(t))
  await step(buyer, seller)
  await seller.call((m: any, t: any) => m.commitFile(t, PNG, "image/png"))
  await step(buyer, seller)
}

const settled = async () => {
  const ctx = await start()
  const {seller, buyer} = ctx

  await toCommitted(ctx)
  await seller.call((m: any, t: any) => m.sendBill(t))
  await both(buyer, seller)
  await buyer.call((m: any, t: any) => m.payAndProve(t))
  await both(buyer, seller)
  await seller.call((m: any, t: any) => m.releaseKey(t))
  await both(buyer, seller)
  await buyer.call((m: any, t: any) => m.verifyDelivery(t))

  expect(buyer.state()).toBe("SETTLED")
  expect(seller.state()).toBe("RELEASED")

  return ctx
}

// A one-hour real invoice, paid; the seller has seen the proof.
const paidOneHourBill = async () => {
  const {billWriter} = await import("src/util/bolt11.js")
  const doc = await (await fetch("/vectors/bolt11/11-payment-encoding.md")).text()
  const preimage = crypto.getRandomValues(new Uint8Array(32))
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", preimage))
  const invoice = billWriter(doc, 3600).write(21000n, hash, Math.floor(Date.now() / 1000))
  const ctx = await start()
  const {seller, buyer} = ctx

  await toCommitted(ctx)
  await seller.call((m: any, t: any) => m.sendBill(t, invoice))
  await both(buyer, seller)
  await buyer.call((m: any, t: any) => m.payAndProve(t, Buffer.from(preimage).toString("hex")))
  await both(buyer, seller)

  expect(seller.state()).toBe("PAID")

  return ctx
}

describe("reopening the app", () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ["Date"], now: Date.UTC(2026, 10, 5, 12)})
    stubFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("keeps a finished trade's state at +25 hours and +3 days", async () => {
    const {seller, buyer} = await settled()

    for (const hours of [25, 72 - 25]) {
      tick(hours * 3600)

      const b2 = await reopen(buyer)
      const s2 = await reopen(seller)

      // The file itself is not fetched again, so the buyer's reload stops at the release.
      expect(b2.state()).toBe("RELEASED")
      expect(s2.state()).toBe("RELEASED")
    }
  })

  it("falls back at +25 hours once the first-seen times are gone", async () => {
    const {buyer} = await settled()

    tick(25 * 3600)
    forget(buyer)

    expect((await reopen(buyer)).state()).toBe("COMMITTED")
  })

  it("does not throw at +3 days once the first-seen times are gone", async () => {
    const {seller, buyer} = await settled()

    tick(3 * 86_400)
    forget(buyer)
    forget(seller)

    const b2 = await reopen(buyer)
    const s2 = await reopen(seller)

    // The proposal itself has expired by now, so the acceptance is refused too.
    expect(b2.state()).toBe("PROPOSED")
    expect(s2.state()).toBe("PROPOSED")
  })

  it("keeps a paid one-hour bill paid when the seller reopens two hours later", async () => {
    const {seller} = await paidOneHourBill()

    tick(2 * 3600)

    expect((await reopen(seller)).state()).toBe("PAID")
  })

  it("loses a paid one-hour bill on reopen once the first-seen times are gone", async () => {
    const {seller} = await paidOneHourBill()

    tick(2 * 3600)
    forget(seller)

    expect((await reopen(seller)).state()).toBe("COMMITTED")
  })

  it("replays messages stamped in the same second in trade order", async () => {
    const wrong = []

    for (let run = 0; run < 6; run++) {
      const ctx = await start()

      await toCommitted(ctx, async (a, b) => {
        await a.sync()
        await b.sync()
      })

      wrong.push((await reopen(ctx.buyer)).state() !== "COMMITTED")
    }

    expect(wrong).toEqual([false, false, false, false, false, false])
  })

  it("holds a message that arrives before its order until the order comes", async () => {
    const {relay, seller, buyer, listing} = await start()

    await buyer.call((m: any) => m.proposeOrder(listing))
    await both(buyer, seller)
    await seller.call((m: any, t: any) => m.acceptOrder(t))
    tick()

    const mine = relay.query([{kinds: [1059], "#p": [buyer.pk]}])
    const b2 = await makeParty(relay, buyer)

    expect(mine.length).toBe(2)

    await b2.call((m: any) => m.processWraps(mine.slice(1)))

    expect(b2.thread()).toBeUndefined()

    await b2.call((m: any) => m.processWraps(mine.slice(0, 1)))

    expect(b2.state()).toBe("ACCEPTED")
  })
})
