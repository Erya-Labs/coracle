import * as nenya from "nenya"
import {CLASSIFIED} from "@welshman/util"
import type {TrustedEvent} from "@welshman/util"

// Every marketplace rule comes from the nenya library (see vendor/nenya): events are
// decoded, built and judged there, never here. A result's `ok` and `reason` are the
// library's own words.

export const MARKET_REQUEST = 30404

export const MARKET_BID = 1111

export const marketFilters = [{kinds: [CLASSIFIED, MARKET_REQUEST], "#t": ["nenya"]}]

export const bidFilters = (coordinate: string) => [{kinds: [MARKET_BID], "#A": [coordinate]}]

const env = new nenya.JsEnvironment(() => String(Math.floor(Date.now() / 1000)))

export const readListing = (event: TrustedEvent) => nenya.decodeListing(JSON.stringify(event))

export const readBid = (event: TrustedEvent) => nenya.decodeBid(JSON.stringify(event))

export const listingActivity = (listing: any) => nenya.listingActivity(listing, env)

export const bidActivity = (bid: any) => nenya.bidActivity(bid, env)

export const satsToMsat = (sats: number) => String(Math.round(sats) * 1000)

export const msatToSats = (msat: string) => Math.floor(parseInt(msat) / 1000)

const asTemplate = (event: any) => ({
  kind: event.kind,
  content: event.content,
  tags: event.tags.map((tag: string[]) => [...tag]),
  created_at: parseInt(event.createdAtSeconds),
})

const buildWords = (result: any) =>
  [result.reason, result.tagReason, result.detail].filter(Boolean).join(" — ")

const authoredListing = ({pubkey, title, summary, priceSats, content}) => {
  const now = String(Math.floor(Date.now() / 1000))

  return new nenya.JsAuthoredListing(
    pubkey,
    now,
    `nenya-${now}`,
    title,
    satsToMsat(priceSats),
    content,
    summary || null,
    now,
    null,
    null,
    [],
    [],
    null,
    `Nenya marketplace listing: ${title}`,
  )
}

export const makeMarketRequest = ({pubkey, title, summary, priceSats, content = ""}) => {
  const result = nenya.buildListingRequest(
    authoredListing({pubkey, title, summary, priceSats, content}),
  )

  return result.ok ? {template: asTemplate(result.event)} : {error: buildWords(result)}
}

export const makeMarketOffer = ({pubkey, title, summary, priceSats, content = ""}) => {
  const result = nenya.buildListingOffer(
    authoredListing({pubkey, title, summary, priceSats, content}),
  )

  return result.ok ? {template: asTemplate(result.event)} : {error: buildWords(result)}
}

export const makeMarketBid = ({pubkey, coordinate, priceSats, content = ""}) => {
  // A bid of nothing can never be billed, so it is refused before nenya builds it.
  if (!(Number(priceSats) > 0)) return {error: "a bid needs a price above 0 sats"}

  const now = String(Math.floor(Date.now() / 1000))
  const result = nenya.buildBid(
    new nenya.JsAuthoredBid(pubkey, now, coordinate, satsToMsat(priceSats), content),
  )
  return result.ok ? {template: asTemplate(result.event)} : {error: buildWords(result)}
}

// --- the board: which listings show, and in what order ----------------------------------

// A listing republished as sold, awarded, fulfilled or cancelled is closed. The board shows
// only open ones; a listing whose deletion request reached this app is dropped by the event
// store before it gets here.
export const isOpenListing = (listing: any) => listing.status === "ACTIVE"

export type ListingSort = {by: "date" | "price"; reverse: boolean}

const sortKey = (listing: any, by: ListingSort["by"]) =>
  BigInt(by === "price" ? listing.priceMsat : listing.createdAtSeconds)

// Newest first by date and cheapest first by price; `reverse` flips either.
export const sortListings = (listings: any[], {by, reverse}: ListingSort) => {
  const sorted = [...listings].sort((a, b) => {
    const x = sortKey(a, by)
    const y = sortKey(b, by)
    const order = x === y ? 0 : x < y ? -1 : 1

    return by === "date" ? -order : order
  })

  return reverse ? sorted.reverse() : sorted
}

// Every word of the query must appear in the title, summary, description or topics.
export const searchListings = (listings: any[], query: string) => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)

  if (words.length === 0) return listings

  return listings.filter(listing => {
    const text = [listing.title, listing.summary, listing.content, ...listing.topics]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()

    return words.every(word => text.includes(word))
  })
}

// --- removing a listing -------------------------------------------------------------------

// Un-listing takes two events (NENYA-1 §5.6): the listing again, marked sold (an offer) or
// cancelled (a request), and a NIP-09 deletion request naming its coordinate. A relay may keep
// the old version, so the closed status is what every reader can rely on, and no one may be
// told that a deletion is permanent.
const BOARD_TOPICS = ["nenya", "wts", "request"]

// The deletion request is dated just after the listing it deletes and just before the closed
// version, so a relay that honours it removes the open versions and keeps the closed one.
export const removalTimes = (listing: any) => {
  const deletionAt = Math.max(Math.floor(Date.now() / 1000), parseInt(listing.createdAtSeconds) + 1)

  return {deletionAt, closedAt: deletionAt + 1}
}

// A listing's own address, split so that a d value containing ":" stays whole.
export const listingFilter = (coordinate: string) => {
  const [kind, author, ...d] = coordinate.split(":")

  return {kinds: [parseInt(kind)], authors: [author], "#d": [d.join(":")]}
}

export const makeListingRemoval = (
  listing: any,
  closedAt: number = removalTimes(listing).closedAt,
) => {
  const createdAt = String(closedAt)
  const isRequest = listing.kind === MARKET_REQUEST
  const authored = new nenya.JsAuthoredListing(
    listing.authorPubkey,
    createdAt,
    listing.dValue,
    listing.title,
    listing.priceMsat,
    listing.content,
    listing.summary,
    listing.publishedAtSeconds,
    isRequest ? "cancelled" : "sold",
    listing.mimeType,
    [...listing.topics].filter((topic: string) => !BOARD_TOPICS.includes(topic.toLowerCase())),
    [...listing.images].map((image: string[]) => [...image]),
    listing.expirationSeconds,
    listing.alt,
    listing.nenyaVersion ?? undefined,
    [...listing.pubkeyRefs].map((ref: string[]) => [...ref]),
    listing.feeBasisPoints,
    listing.feeRecipient,
    listing.license,
    listing.deliverBySeconds,
    [...listing.unknownTags].map((tag: string[]) => [...tag]),
  )
  const result = isRequest ? nenya.buildListingRequest(authored) : nenya.buildListingOffer(authored)

  return result.ok ? {template: asTemplate(result.event)} : {error: buildWords(result)}
}

// NIP-09 is not a marketplace event, so the library has no builder for it. See removalTimes
// for its date.
export const makeListingDeletion = (listing: any, createdAt: number) => ({
  kind: 5,
  content: "",
  created_at: createdAt,
  tags: [
    ["a", listing.coordinate],
    ["e", listing.idHex],
    ["k", String(listing.kind)],
  ],
})

// Only a listing's own author can delete it, so only the authors' deletion requests are asked
// for; anyone else's would be thrown away and could crowd out the real ones.
export const listingDeletionFilters = (coordinates: string[]) => {
  const byAuthor = new Map<string, string[]>()

  for (const coordinate of coordinates) {
    const author = coordinate.split(":")[1]

    byAuthor.set(author, [...(byAuthor.get(author) ?? []), coordinate])
  }

  return [...byAuthor].map(([author, coords]) => ({kinds: [5], authors: [author], "#a": coords}))
}
