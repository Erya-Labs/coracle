import {vi} from "vitest"
import {get} from "svelte/store"
import {readFileSync} from "node:fs"
import {join} from "node:path"
import {finalizeEvent, generateSecretKey, getPublicKey, verifyEvent} from "nostr-tools/pure"
import {Nip01Signer} from "@welshman/signer"

// Two people trading in one test: a relay in memory, and each party with its own copy
// of the order module, its own signer and its own localStorage.

const matches = (e: any, f: any) => {
  if (f.ids && !f.ids.includes(e.id)) return false
  if (f.kinds && !f.kinds.includes(e.kind)) return false
  if (f.authors && !f.authors.includes(e.pubkey)) return false
  if (f["#d"] && !e.tags.some((t: string[]) => t[0] === "d" && f["#d"].includes(t[1]))) return false
  if (f["#p"] && !e.tags.some((t: string[]) => t[0] === "p" && f["#p"].includes(t[1]))) return false
  return true
}

// Refuses any message over its size limit, as a real relay does.
export class FakeRelay {
  events: any[] = []

  constructor(public maxMessage = Infinity) {}

  publish = async (e: any) => {
    if (JSON.stringify(["EVENT", e]).length > this.maxMessage) return {ok: false}
    if (!verifyEvent(e)) throw new Error(`relay: bad signature on kind ${e.kind}`)
    if (!this.events.find(x => x.id === e.id)) this.events.push(e)

    return {ok: true}
  }

  query = (filters: any[]) => this.events.filter(e => filters.some(f => matches(e, f)))
}

export const stubFetch = () =>
  vi.stubGlobal(
    "fetch",
    async (url: string) => new Response(readFileSync(join(process.cwd(), "public", url))),
  )

export const tick = (seconds = 60) => vi.setSystemTime(Date.now() + seconds * 1000)

export const makeParty = async (relay: FakeRelay) => {
  const sk = generateSecretKey()
  const pk = getPublicKey(sk)
  const storage = new Map<string, string>()
  const enter = () =>
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
    })

  vi.resetModules()
  enter()

  const mod: any = await import("src/domain/marketOrder")
  const signer = new Nip01Signer(Buffer.from(sk).toString("hex"))

  await mod.connectOrderChannel(relay.publish, async (f: any[]) => relay.query(f), signer)

  const thread = () => [...get(mod.orderThreads as any).values()][0] as any

  return {
    sk,
    pk,
    relay,
    mod,
    enter,
    thread,
    state: () => thread()?.order?.state,
    sync: async () => {
      enter()
      await mod.processWraps(relay.query([{kinds: [1059], "#p": [pk]}]))
    },
    call: async (fn: (m: any, t: any) => any) => {
      enter()
      return fn(mod, thread())
    },
  }
}

export const makeListing = async (seller: any) => {
  const market: any = await import("src/domain/market")
  const {template, error} = market.makeMarketOffer({
    pubkey: seller.pk,
    title: "Lighthouse",
    summary: "",
    priceSats: 21,
  })

  if (error) throw new Error(error)

  const signed = finalizeEvent(template, seller.sk)
  const read = market.readListing(signed)

  if (!read.ok) throw new Error(read.reason)

  await seller.relay.publish(signed)

  return read.listing
}
