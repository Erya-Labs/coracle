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

  it("sends only the first real bill again after a send that looked failed", async () => {
    const preimage = crypto.getRandomValues(new Uint8Array(32))
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", preimage))
    const right = await billFor(21000n, hash)
    const other = await billFor(21000n, crypto.getRandomValues(new Uint8Array(32)))
    const ctx = await start()
    const {relay, seller, buyer} = ctx

    await toCommitted(ctx)

    relay.refuse = (e: any) => e.kind === 1059 && e.tags.some((t: string[]) => t[1] === seller.pk)

    expect((await seller.call((m: any, t: any) => m.sendBill(t, right))).sent).toBe(false)
    await both(buyer, seller)

    expect(buyer.state()).toBe("AWAITING_PAYMENT")

    relay.refuse = () => false

    for (const field of [other, ""]) {
      const result = await seller.call((m: any, t: any) => m.sendBill(t, field))

      expect(result.sent).toBe(false)
      expect(result.words).toContain("already sent")
    }

    expect((await seller.call((m: any, t: any) => m.sendBill(t, right))).sent).toBe(true)
    await both(buyer, seller)

    expect(seller.thread().requests.provider.invoice).toBe(right)

    await buyer.call((m: any, t: any) => m.payAndProve(t, Buffer.from(preimage).toString("hex")))
    await both(buyer, seller)

    expect(seller.state()).toBe("PAID")

    await finish(ctx)
  })

  it("keeps the guard on the bill that went out, after a reload and in a second tab", async () => {
    const preimage = crypto.getRandomValues(new Uint8Array(32))
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", preimage))
    const wrong = await billFor(99000n, hash)
    const right = await billFor(21000n, hash)
    const other = await billFor(21000n, crypto.getRandomValues(new Uint8Array(32)))
    const ctx = await start()
    const {relay, seller, buyer} = ctx

    await toCommitted(ctx)
    await seller.call((m: any, t: any) => m.sendBill(t, wrong))
    await both(buyer, seller)

    expect(lastWords(seller)).toContain("INVOICE_AMOUNT_MISMATCH")

    relay.refuse = (e: any) => e.kind === 1059 && e.tags.some((t: string[]) => t[1] === seller.pk)

    expect((await seller.call((m: any, t: any) => m.sendBill(t, right))).sent).toBe(false)
    await both(buyer, seller)

    expect(buyer.state()).toBe("AWAITING_PAYMENT")

    relay.refuse = () => false

    const reopened = await makeParty(relay, {sk: seller.sk, storage: seller.storage})

    await reopened.sync()

    const tab = await makeParty(relay, {sk: seller.sk, storage: seller.storage})

    await tab.sync()

    for (const party of [reopened, tab, seller]) {
      for (const field of [other, ""]) {
        const result = await party.call((m: any, t: any) => m.sendBill(t, field))

        expect(result.sent).toBe(false)
        expect(result.words).toContain("already sent")
      }
    }

    expect((await tab.call((m: any, t: any) => m.sendBill(t, right))).sent).toBe(true)
    await both(buyer, tab)

    expect(tab.thread().requests.provider.invoice).toBe(right)

    await tab.call((m: any, t: any) => m.sendBill(t, right))
    await both(buyer, tab)

    expect(lastWords(tab)).toContain("REQUEST_ALREADY_STORED")
    expect((await tab.call((m: any, t: any) => m.sendBill(t, other))).words).toContain(
      "already sent",
    )

    await buyer.call((m: any, t: any) => m.payAndProve(t, Buffer.from(preimage).toString("hex")))
    await both(buyer, tab)

    expect(tab.state()).toBe("PAID")

    await finish({seller: tab, buyer})
  })

  it("saves no bill when the signer declined to seal it", async () => {
    const hash = crypto.getRandomValues(new Uint8Array(32))
    const right = await billFor(21000n, hash)
    const other = await billFor(21000n, crypto.getRandomValues(new Uint8Array(32)))
    const ctx = await start()
    const {seller, buyer} = ctx
    const sign = seller.signer.sign

    await toCommitted(ctx)

    seller.signer.sign = async () => {
      throw new Error("declined")
    }

    expect((await seller.call((m: any, t: any) => m.sendBill(t, other))).sent).toBe(false)

    seller.signer.sign = sign

    expect((await seller.call((m: any, t: any) => m.sendBill(t, right))).sent).toBe(true)
    await both(buyer, seller)

    expect(buyer.state()).toBe("AWAITING_PAYMENT")
    expect(buyer.thread().requests.provider.invoice).toBe(right)
  })

  it("lets one of two bills sent at once go out, and ignores a bill refused from the buyer", async () => {
    const right = await billFor(21000n, crypto.getRandomValues(new Uint8Array(32)))
    const other = await billFor(21000n, crypto.getRandomValues(new Uint8Array(32)))
    const ctx = await start()
    const {seller, buyer} = ctx

    await toCommitted(ctx)

    const results = await seller.call((m: any, t: any) =>
      Promise.all([m.sendBill(t, right), m.sendBill(t, other)]),
    )

    expect(results.map((r: any) => r.sent)).toEqual([true, false])
    expect(results[1].words).toContain("already sent")

    const forged = await buyer.call((m: any, t: any) =>
      m.sendBill({...t, buyerKey: seller.pk}, right),
    )

    expect(forged.sent).toBe(true)

    await both(buyer, seller)

    expect(lastWords(seller)).toContain("Nenya refused the bill")
    expect((await seller.call((m: any, t: any) => m.sendBill(t, other))).words).toContain(
      "already sent",
    )
    expect(buyer.thread().requests.provider.invoice).toBe(right)
  })
})
