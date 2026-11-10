import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {FakeRelay, makeListing, makeParty, stubFetch, tick} from "../../utils/marketParty"

const PNG = new Uint8Array(2048).map((_, i) => i % 251)

const start = async () => {
  const relay = new FakeRelay()
  const seller = await makeParty(relay)
  const buyer = await makeParty(relay)
  const listing = await makeListing(seller)

  return {seller, buyer, listing}
}

const both = async (a: any, b: any) => {
  tick()
  await a.sync()
  await b.sync()
}

// Proposal, acceptance and commitment, with both sides synced after each.
const toCommitted = async ({seller, buyer, listing}: any) => {
  await buyer.call((m: any) => m.proposeOrder(listing))
  await both(buyer, seller)
  await seller.call((m: any, t: any) => m.acceptOrder(t))
  await both(buyer, seller)
  await seller.call((m: any, t: any) => m.commitFile(t, PNG, "image/png"))
  await both(buyer, seller)

  expect(buyer.state()).toBe("COMMITTED")
}

const finish = async ({seller, buyer}: any) => {
  await seller.call((m: any, t: any) => m.releaseKey(t))
  await both(buyer, seller)
  await buyer.call((m: any, t: any) => m.verifyDelivery(t))

  expect(seller.state()).toBe("RELEASED")
  expect(buyer.state()).toBe("SETTLED")
  expect(Array.from(buyer.thread().delivered)).toEqual(Array.from(PNG))
}

const lastWords = (party: any) => party.thread().log.at(-1).words

const billFor = async (msat: bigint, hash: Uint8Array) => {
  const {billWriter} = await import("src/util/bolt11.js")
  const doc = await (await fetch("/vectors/bolt11/11-payment-encoding.md")).text()

  return billWriter(doc).write(msat, hash, Math.floor(Date.now() / 1000))
}

describe("a trade between two parties", () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ["Date"], now: Date.UTC(2026, 10, 5, 12)})
    stubFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("settles a pretend trade with the exact file", async () => {
    const ctx = await start()
    const {seller, buyer} = ctx

    await toCommitted(ctx)
    await seller.call((m: any, t: any) => m.sendBill(t))
    await both(buyer, seller)

    expect(buyer.state()).toBe("AWAITING_PAYMENT")
    expect(buyer.thread().requests.provider.invoice).toBe(buyer.thread().vouchers.provider.invoice)

    await buyer.call((m: any, t: any) => m.payAndProve(t))
    await both(buyer, seller)

    expect(seller.state()).toBe("PAID")

    await finish(ctx)
  })

  it("refuses a wrong-amount bill and a wrong preimage, then settles a real invoice", async () => {
    const preimage = crypto.getRandomValues(new Uint8Array(32))
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", preimage))
    const wrong = await billFor(99000n, hash)
    const right = await billFor(21000n, hash)
    const ctx = await start()
    const {seller, buyer} = ctx

    await toCommitted(ctx)
    await seller.call((m: any, t: any) => m.sendBill(t, wrong))
    await both(buyer, seller)

    expect(buyer.state()).toBe("COMMITTED")
    expect(lastWords(buyer)).toContain("INVOICE_AMOUNT_MISMATCH")

    await seller.call((m: any, t: any) => m.sendBill(t, right))
    await both(buyer, seller)

    expect(buyer.state()).toBe("AWAITING_PAYMENT")
    expect(buyer.thread().requests.provider.invoice).toBe(right)

    await buyer.call((m: any, t: any) => m.payAndProve(t, "00".repeat(32)))
    await both(buyer, seller)

    expect(seller.state()).toBe("AWAITING_PAYMENT")
    expect(lastWords(seller)).toContain("PREIMAGE_MISMATCH")

    await buyer.call((m: any, t: any) => m.payAndProve(t, Buffer.from(preimage).toString("hex")))
    await both(buyer, seller)

    expect(seller.state()).toBe("PAID")

    await finish(ctx)
  })

  it("reads a pasted bill in capitals with a lightning: prefix", async () => {
    const hash = crypto.getRandomValues(new Uint8Array(32))
    const wrong = await billFor(99000n, hash)
    const right = await billFor(21000n, hash)
    const ctx = await start()
    const {seller, buyer} = ctx

    await toCommitted(ctx)

    for (const address of [
      "Someone@Example.com",
      "LIGHTNING:LNURL1DP68GURN8GHJ7UM9WFMXJCM99E3K7MF0V9CXJ0M385EKVCENXC6R2C35XVUKXEFCV5MKVV34X5EKZD3EV56NYD3HXQURZEPEXEJXXEPNXSCRVWFNV9NXZCN9XQ6XYEFHVGCXXCMYXYMNSERXFQ5FNS",
    ]) {
      const result = await seller.call((m: any, t: any) => m.sendBill(t, address))

      expect(result.sent).toBe(false)
      expect(result.words).toContain("INVOICE_STATIC_ADDRESS")
    }

    expect((await seller.call((m: any, t: any) => m.sendBill(t, " lightning: "))).sent).toBe(false)

    await seller.call((m: any, t: any) => m.sendBill(t, " LIGHTNING:" + wrong.toUpperCase() + " "))
    await both(buyer, seller)

    expect(buyer.state()).toBe("COMMITTED")
    expect(lastWords(buyer)).toContain("INVOICE_AMOUNT_MISMATCH")

    await seller.call((m: any, t: any) => m.sendBill(t, " LIGHTNING:" + right.toUpperCase() + " "))
    await both(buyer, seller)

    expect(buyer.state()).toBe("AWAITING_PAYMENT")
    expect(buyer.thread().requests.provider.invoice).toBe(right)
    expect(buyer.thread().vouchers.provider).toBeUndefined()
  })
})
