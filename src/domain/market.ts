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

export const makeMarketRequest = ({pubkey, title, summary, priceSats, content = ""}) => {
  const now = String(Math.floor(Date.now() / 1000))
  const result = nenya.buildListingRequest(
    new nenya.JsAuthoredListing(
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
      `Nenya marketplace request: ${title}`,
    ),
  )
  return result.ok ? {template: asTemplate(result.event)} : {error: buildWords(result)}
}

export const makeMarketBid = ({pubkey, coordinate, priceSats, content = ""}) => {
  const now = String(Math.floor(Date.now() / 1000))
  const result = nenya.buildBid(
    new nenya.JsAuthoredBid(pubkey, now, coordinate, satsToMsat(priceSats), content),
  )
  return result.ok ? {template: asTemplate(result.event)} : {error: buildWords(result)}
}
