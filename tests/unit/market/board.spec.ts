import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {finalizeEvent, generateSecretKey, getPublicKey} from "nostr-tools/pure"
import {
  isOpenListing,
  listingDeletionFilters,
  listingFilter,
  makeListingDeletion,
  makeListingRemoval,
  makeMarketOffer,
  makeMarketRequest,
  readListing,
  removalTimes,
  searchListings,
  sortListings,
} from "src/domain/market"

const sk = generateSecretKey()
const pubkey = getPublicKey(sk)

const signed = (template: any) => finalizeEvent(template, sk)

const listingFrom = (make: any, fields: any) => {
  const {template, error} = make({pubkey, summary: "", ...fields})

  if (error) throw new Error(error)

  const read = readListing(signed(template) as any)

  if (!read.ok) throw new Error(read.reason)

  return read.listing
}

describe("the market board", () => {
  beforeEach(() => {
    vi.useFakeTimers({toFake: ["Date"], now: Date.UTC(2026, 10, 27, 12)})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const listings = () => {
    const cat = listingFrom(makeMarketOffer, {title: "A jpeg of a cat", priceSats: 21})

    vi.advanceTimersByTime(60_000)

    const poem = listingFrom(makeMarketRequest, {
      title: "Write me a poem",
      priceSats: 500,
      content: "About the sea",
    })

    vi.advanceTimersByTime(60_000)

    const logo = listingFrom(makeMarketOffer, {title: "Logo design", priceSats: 100})

    return {cat, poem, logo}
  }

  it("sorts newest first by date and cheapest first by price, and reverses either", () => {
    const {cat, poem, logo} = listings()
    const all = [cat, poem, logo]
    const titles = (sorted: any[]) => sorted.map(l => l.title)

    expect(titles(sortListings(all, {by: "date", reverse: false}))).toEqual([
      "Logo design",
      "Write me a poem",
      "A jpeg of a cat",
    ])
    expect(titles(sortListings(all, {by: "date", reverse: true}))).toEqual([
      "A jpeg of a cat",
      "Write me a poem",
      "Logo design",
    ])
    expect(titles(sortListings(all, {by: "price", reverse: false}))).toEqual([
      "A jpeg of a cat",
      "Logo design",
      "Write me a poem",
    ])
    expect(titles(sortListings(all, {by: "price", reverse: true}))).toEqual([
      "Write me a poem",
      "Logo design",
      "A jpeg of a cat",
    ])
  })

  it("finds listings by every word typed, in the title, description or topics", () => {
    const {cat, poem, logo} = listings()
    const all = [cat, poem, logo]
    const titles = (q: string) => searchListings(all, q).map(l => l.title)

    expect(titles("")).toHaveLength(3)
    expect(titles("CAT")).toEqual(["A jpeg of a cat"])
    expect(titles("sea")).toEqual(["Write me a poem"])
    expect(titles("poem sea")).toEqual(["Write me a poem"])
    expect(titles("poem cat")).toEqual([])
    expect(titles("wts")).toEqual(["A jpeg of a cat", "Logo design"])
  })

  it("closes an offer as sold and a request as cancelled, under the same address", () => {
    const {cat, poem} = listings()

    for (const [listing, status] of [
      [cat, "SOLD"],
      [poem, "CANCELLED"],
    ]) {
      const {template, error} = makeListingRemoval(listing)

      expect(error).toBeUndefined()

      const read = readListing(signed(template) as any)

      expect(read.ok).toBe(true)
      expect(read.listing.status).toBe(status)
      expect(read.listing.coordinate).toBe(listing.coordinate)
      expect(read.listing.title).toBe(listing.title)
      expect(read.listing.priceMsat).toBe(listing.priceMsat)
      expect(Number(read.listing.createdAtSeconds)).toBeGreaterThan(
        Number(listing.createdAtSeconds),
      )
      expect(isOpenListing(listing)).toBe(true)
      expect(isOpenListing(read.listing)).toBe(false)
    }
  })

  it("dates the deletion request after the open listing and before the closed one", () => {
    const {cat} = listings()
    const {deletionAt, closedAt} = removalTimes(cat)
    const closed = signed(makeListingRemoval(cat, closedAt).template)
    const deletion = makeListingDeletion(cat, deletionAt)

    expect(deletion.kind).toBe(5)
    expect(deletion.created_at).toBeGreaterThan(Number(cat.createdAtSeconds))
    expect(deletion.created_at).toBeLessThan(closed.created_at)
    expect(deletion.tags).toContainEqual(["a", cat.coordinate])
    expect(deletion.tags).toContainEqual(["e", cat.idHex])
    expect(deletion.tags).toContainEqual(["k", "30402"])
  })

  it("closes a listing whose side topic another client wrote in capitals", () => {
    const {template} = makeMarketOffer({pubkey, title: "Shouted", summary: "", priceSats: 5})
    const tags = template.tags.map((t: string[]) =>
      t[0] === "t" && t[1] === "wts" ? ["t", "WTS"] : t,
    )
    const read = readListing(signed({...template, tags}) as any)

    expect(read.ok).toBe(true)

    const {error} = makeListingRemoval(read.listing)

    expect(error).toBeUndefined()
  })

  it("asks only each listing's author for deletion requests", () => {
    const other = "b".repeat(64)
    const filters = listingDeletionFilters([
      `30402:${pubkey}:one`,
      `30404:${other}:two`,
      `30404:${pubkey}:three`,
    ])

    expect(filters).toEqual([
      {kinds: [5], authors: [pubkey], "#a": [`30402:${pubkey}:one`, `30404:${pubkey}:three`]},
      {kinds: [5], authors: [other], "#a": [`30404:${other}:two`]},
    ])
  })

  it("keeps a d value that contains a colon whole", () => {
    expect(listingFilter(`30402:${pubkey}:art:v2`)).toEqual({
      kinds: [30402],
      authors: [pubkey],
      "#d": ["art:v2"],
    })
  })
})
