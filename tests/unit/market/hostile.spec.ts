import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import * as nenya from "nenya"
import {Nip01Signer} from "@welshman/signer"
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

const toCommitted = async ({seller, buyer, listing}: any) => {
  await buyer.call((m: any) => m.proposeOrder(listing))
  await both(buyer, seller)
  await seller.call((m: any, t: any) => m.acceptOrder(t))
  await both(buyer, seller)
  await seller.call((m: any, t: any) => m.commitFile(t, PNG, "image/png"))
  await both(buyer, seller)

  expect(seller.state()).toBe("COMMITTED")
}

const toPaid = async (ctx: any) => {
  const {seller, buyer} = ctx

  await toCommitted(ctx)
  await seller.call((m: any, t: any) => m.sendBill(t))
  await both(buyer, seller)
  await buyer.call((m: any, t: any) => m.payAndProve(t))
  await both(buyer, seller)

  expect(seller.state()).toBe("PAID")
}

// Seals a rumor the order module would never send, as the given party.
const sealAs = (party: any, event: any, to: string) =>
  new Promise<void>((resolve, reject) => {
    party.enter()

    const signer = party.mod.makeAsyncSigner(new Nip01Signer(Buffer.from(party.sk).toString("hex")))

    nenya.sealAsync(
      event,
      to,
      signer,
      (r: any) => {
        if (!r.ok) return reject(new Error(`seal refused: ${r.reason}`))

        party.relay.publish(JSON.parse(r.toRecipient.json)).then(() => resolve())
      },
      party.mod.makeEnvironment(),
    )
  })

describe("an order under attack", () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ["Date"], now: Date.UTC(2026, 10, 5, 12)})
    stubFetch()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("keeps the first proposal when a second one under the same order id is cheaper", async () => {
    const ctx = await start()
    const {seller, buyer, listing} = ctx

    await toCommitted(ctx)

    const before = seller.thread()
    const price = before.order.priceMsat
    const commitment = before.commitment
    const now = String(Math.floor(Date.now() / 1000))
    const built = nenya.buildProposal(
      new nenya.JsRumorEnvelope(buyer.pk, now, [[seller.pk]], ""),
      before.orderId,
      listing.coordinate,
      new nenya.JsOrderTerms("1000", null, String(Number(now) + 3600), null),
      null,
    )

    expect(built.ok).toBe(true)
    expect(price).not.toBe("1000")

    await sealAs(buyer, built.event, seller.pk)
    tick()
    await seller.sync()

    const after = seller.thread()

    expect(after.order.priceMsat).toBe(price)
    expect(after.commitment).toBe(commitment)
    expect(seller.state()).toBe("COMMITTED")
  })

  it("keeps the first proposal on reopen when a second one is back-dated before it", async () => {
    const ctx = await start()
    const {seller, buyer, listing} = ctx

    await toCommitted(ctx)

    const before = seller.thread()
    const back = String(Number(before.proposal.createdAtSeconds) - 1)
    const built = nenya.buildProposal(
      new nenya.JsRumorEnvelope(buyer.pk, back, [[seller.pk]], ""),
      before.orderId,
      listing.coordinate,
      new nenya.JsOrderTerms("1000", null, String(Number(back) + 3600), null),
      null,
    )

    expect(built.ok).toBe(true)

    await sealAs(buyer, built.event, seller.pk)
    tick()
    await seller.sync()

    const again = await makeParty(seller.relay, seller)

    await again.sync()

    expect(again.thread().order.priceMsat).toBe(before.order.priceMsat)
    expect(again.thread().commitment.xHex).toBe(before.commitment.xHex)
    expect(again.state()).toBe("COMMITTED")
  })

  it("ignores a proposal sent to me that names someone else's listing", async () => {
    const {relay, seller} = await start()
    const other = await makeParty(relay)
    const stranger = await makeParty(relay)
    const elsewhere = await makeListing(other)
    const now = String(Math.floor(Date.now() / 1000))
    const built = nenya.buildProposal(
      new nenya.JsRumorEnvelope(stranger.pk, now, [[seller.pk]], ""),
      "ab".repeat(32),
      elsewhere.coordinate,
      new nenya.JsOrderTerms(elsewhere.priceMsat, null, String(Number(now) + 3600), null),
      null,
    )

    expect(built.ok).toBe(true)

    await sealAs(stranger, built.event, seller.pk)
    tick()
    await seller.sync()

    expect(seller.thread()).toBeUndefined()
  })

  it("does not accept an order whose listing cannot be found", async () => {
    const {relay, seller, buyer, listing} = await start()

    await buyer.call((m: any) => m.proposeOrder(listing))
    await both(buyer, seller)

    relay.events = relay.events.filter(e => e.kind !== listing.kind)

    const result = await seller.call((m: any, t: any) => m.acceptOrder(t))

    expect(result.sent).toBe(false)
    expect(seller.state()).toBe("PROPOSED")
  })

  it("does not release the key before a verified payment", async () => {
    const ctx = await start()
    const {relay, seller} = ctx

    await toCommitted(ctx)

    const count = relay.events.length
    const result = await seller.call((m: any, t: any) => m.releaseKey(t))

    expect(result.sent).toBe(false)
    expect(relay.events.length).toBe(count)
  })

  it("does not release the key against a payment for another order", async () => {
    const paid = await start()
    const other = await start()

    await toPaid(paid)
    await toCommitted(other)

    const count = other.relay.events.length
    const result = await other.seller.call((m: any, t: any) => {
      t.settlements.provider = paid.seller.thread().settlements.provider

      return m.releaseKey(t)
    })

    expect(result.sent).toBe(false)
    expect(result.words).not.toBe("")
    expect(result.words).not.toBe("no verified payment yet")
    expect(other.relay.events.length).toBe(count)
    expect(other.seller.state()).toBe("COMMITTED")
  })

  it("does not let a stranger who knows the order id cancel it", async () => {
    const ctx = await start()
    const {relay, seller, buyer, listing} = ctx
    const stranger = await makeParty(relay)

    await buyer.call((m: any) => m.proposeOrder(listing))
    await both(buyer, seller)

    const orderId = seller.thread().orderId

    await stranger.call((m: any) => m.cancelOrder({orderId, providerKey: seller.pk}))
    await both(buyer, seller)

    expect(seller.state()).toBe("PROPOSED")

    await buyer.call((m: any, t: any) => m.cancelOrder(t))
    await both(buyer, seller)

    expect(seller.state()).toBe("CANCELLED")
  })
})
