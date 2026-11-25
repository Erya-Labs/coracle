import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {
  FakeRelay,
  fileHost,
  makeListing,
  makeParty,
  stubFetchWithFileHost,
  tick,
} from "../../utils/marketParty"

const file = (size: number) => new Uint8Array(size).map((_, i) => (i * 7) % 251)

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

  return {seller, buyer}
}

// Commit, bill, pay, release, check: the whole delivery of one file.
const deliver = async (relay: FakeRelay, plain: Uint8Array, mimeType: string) => {
  const {seller, buyer} = await toAccepted(relay)
  const committed = await seller.call((m: any, t: any) => m.commitFile(t, plain, mimeType))

  await both(buyer, seller)
  await seller.call((m: any, t: any) => m.sendBill(t))
  await both(buyer, seller)
  await buyer.call((m: any, t: any) => m.payAndProve(t))
  await both(buyer, seller)
  await seller.call((m: any, t: any) => m.releaseKey(t))
  await both(buyer, seller)

  return {seller, buyer, committed}
}

describe("delivering through a Blossom file host", () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ["Date"], now: Date.UTC(2026, 10, 5, 12)})
    stubFetchWithFileHost()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it("settles a 200 KB file kept by the file host, not the relay", async () => {
    const relay = new FakeRelay(65536)
    const plain = file(200_000)
    const {seller, buyer, committed} = await deliver(relay, plain, "application/pdf")

    expect(committed).toEqual({sent: true, words: ""})

    const x = seller.thread().commitment.xHex

    expect(buyer.thread().fileUrl).toBe(`https://nostr.download/${x}`)
    expect(fileHost.blobs.has(x)).toBe(true)
    expect(relay.events.some(e => e.kind === 9876)).toBe(false)

    await buyer.call((m: any, t: any) => m.verifyDelivery(t))

    expect(buyer.state()).toBe("SETTLED")
    expect(Array.from(buyer.thread().delivered)).toEqual(Array.from(plain))
  })

  it("authorises the upload with a key made for the file, not the seller's", async () => {
    const relay = new FakeRelay()
    const {seller} = await deliver(relay, file(5000), "image/gif")

    expect(fileHost.uploads.length).toBe(1)
    expect(fileHost.uploads[0].pubkey).not.toBe(seller.pk)
  })

  it("delivers a written message as plain text", async () => {
    const relay = new FakeRelay()
    const message = "Lesson one: breathe through your nose.\nLesson two: ✨ patience."
    const {buyer} = await deliver(relay, new TextEncoder().encode(message), "text/plain")

    await buyer.call((m: any, t: any) => m.verifyDelivery(t))

    expect(buyer.state()).toBe("SETTLED")
    expect(buyer.thread().commitment.mimeType).toBe("text/plain")
    expect(new TextDecoder().decode(buyer.thread().delivered)).toBe(message)
  })

  it("falls back to the relay for a small file when the file host is down", async () => {
    const relay = new FakeRelay(65536)

    fileHost.down = true

    const plain = file(30_000)
    const {buyer} = await deliver(relay, plain, "image/png")

    expect(buyer.thread().fileUrl.startsWith("nostr-blob:")).toBe(true)

    await buyer.call((m: any, t: any) => m.verifyDelivery(t))

    expect(buyer.state()).toBe("SETTLED")
    expect(Array.from(buyer.thread().delivered)).toEqual(Array.from(plain))
  })

  it("refuses a file the file host swapped after the commitment", async () => {
    const relay = new FakeRelay()
    const {seller, buyer} = await deliver(relay, file(50_000), "application/zip")
    const x = seller.thread().commitment.xHex
    const swapped = Uint8Array.from(fileHost.blobs.get(x)!)

    swapped[100] ^= 0xff
    fileHost.blobs.set(x, swapped)

    await buyer.call((m: any, t: any) => m.verifyDelivery(t))

    expect(buyer.state()).toBe("DISPUTED")
    expect(buyer.thread().delivered).toBeFalsy()
  })

  it("removes a photo's place and camera details before locking it", async () => {
    const relay = new FakeRelay()
    const gps = new TextEncoder().encode("GPS 35.6895N 139.6917E Pixel 9")
    const exif = new Uint8Array([
      ...new TextEncoder().encode("Exif\0\0"),
      ...[0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      ...gps,
    ])
    const jpeg = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0xe1,
      (exif.length + 2) >> 8,
      (exif.length + 2) & 0xff,
      ...exif,
      0xff,
      0xda,
      0x00,
      0x08,
      1,
      2,
      3,
      4,
      5,
      6,
      0x11,
      0x22,
      0x33,
      0xff,
      0xd9,
    ])
    const {seller, buyer} = await deliver(relay, jpeg, "image/jpeg")

    await buyer.call((m: any, t: any) => m.verifyDelivery(t))

    const got = new TextDecoder("latin1").decode(buyer.thread().delivered)

    expect(buyer.state()).toBe("SETTLED")
    expect(got).not.toContain("GPS")
    expect(got.endsWith("\x11\x22\x33\xff\xd9")).toBe(true)
    expect(seller.thread().log.some((l: any) => l.call === "strip" && l.ok)).toBe(true)
  })

  it("names a JPEG sent with no type by its first bytes", async () => {
    const relay = new FakeRelay()
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x10, 0x20, 0xff, 0xd9])
    const {buyer} = await deliver(relay, jpeg, "application/octet-stream")

    expect(buyer.thread().commitment.mimeType).toBe("image/jpeg")
  })

  it("does not send a picture it cannot clean", async () => {
    const relay = new FakeRelay()
    const {seller} = await toAccepted(relay)
    const truncated = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x40, 0x45, 0x78])

    const r = await seller.call((m: any, t: any) => m.commitFile(t, truncated, "image/jpeg"))

    expect(r.sent).toBe(false)
    expect(r.words).toContain("could not be read")
    expect(fileHost.uploads.length).toBe(0)
  })

  it("locks and uploads the file once when it is committed twice at the same time", async () => {
    const relay = new FakeRelay()
    const {seller} = await toAccepted(relay)

    const [first, second] = await seller.call((m: any, t: any) =>
      Promise.all([
        m.commitFile(t, file(60_000), "application/pdf"),
        m.commitFile(t, file(60_000), "application/pdf"),
      ]),
    )

    expect(first.sent).toBe(true)
    expect(second).toEqual({
      sent: false,
      words: "this order's file is still being locked and uploaded",
    })
    expect(fileHost.uploads.length).toBe(1)
  })

  it("stops a download that runs past the committed size", async () => {
    const relay = new FakeRelay()
    const {seller, buyer} = await deliver(relay, file(50_000), "application/pdf")
    const x = seller.thread().commitment.xHex
    const longer = new Uint8Array(fileHost.blobs.get(x)!.length + 10)

    longer.set(fileHost.blobs.get(x)!)
    fileHost.blobs.set(x, longer)

    await buyer.call((m: any, t: any) => m.verifyDelivery(t))

    expect(buyer.state()).toBe("RELEASED")
    expect(buyer.thread().delivered).toBeFalsy()
    expect(buyer.thread().downloads).toBe(1)
  })

  it("asks before fetching a file from a host this app does not use by itself", async () => {
    const relay = new FakeRelay()
    const {seller, buyer} = await toAccepted(relay)
    const plain = file(70_000)

    // The first commitment never reaches the buyer; the second names another host.
    relay.refuse = (e: any) => e.kind === 1059 && e.tags.some((t: string[]) => t[1] === buyer.pk)
    await seller.call((m: any, t: any) => m.commitFile(t, plain, "application/pdf"))
    relay.refuse = () => false

    const secrets = JSON.parse(seller.storage.get("nenya-order-secrets")!)
    const saved = secrets[seller.thread().orderId]

    saved.url = `https://other.example/${saved.x}`
    seller.storage.set("nenya-order-secrets", JSON.stringify(secrets))

    await seller.call((m: any, t: any) => m.commitFile(t, plain, "application/pdf"))
    await both(buyer, seller)
    await seller.call((m: any, t: any) => m.sendBill(t))
    await both(buyer, seller)
    await buyer.call((m: any, t: any) => m.payAndProve(t))
    await both(buyer, seller)
    await seller.call((m: any, t: any) => m.releaseKey(t))
    await both(buyer, seller)
    await buyer.call((m: any, t: any) => m.verifyDelivery(t))

    expect(buyer.state()).toBe("RELEASED")
    expect(buyer.thread().unknownHost).toBe("other.example")
    expect(fileHost.gets.some(url => url.startsWith("https://other.example/"))).toBe(false)

    await buyer.call((m: any, t: any) => m.allowFileHost(t))
    await buyer.call((m: any, t: any) => m.verifyDelivery(t))

    expect(buyer.state()).toBe("SETTLED")
    expect(Array.from(buyer.thread().delivered)).toEqual(Array.from(plain))
  })
})
