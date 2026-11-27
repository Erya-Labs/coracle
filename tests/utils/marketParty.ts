import {vi} from "vitest"
import {get} from "svelte/store"
import {readFileSync} from "node:fs"
import {createHash} from "node:crypto"
import {join} from "node:path"
import {finalizeEvent, generateSecretKey, getPublicKey, verifyEvent} from "nostr-tools/pure"
import {Nip01Signer} from "@welshman/signer"

// Two people trading in one test: a relay in memory, and each party with its own copy
// of the order module, its own signer and its own localStorage.

const matches = (e: any, f: any) => {
  if (f.ids && !f.ids.includes(e.id)) return false
  if (f.kinds && !f.kinds.includes(e.kind)) return false
  if (f.authors && !f.authors.includes(e.pubkey)) return false
  for (const key of Object.keys(f).filter(k => k.startsWith("#"))) {
    const name = key.slice(1)

    if (!e.tags.some((t: string[]) => t[0] === name && f[key].includes(t[1]))) return false
  }

  return true
}

// Refuses any message over its size limit, as a real relay does.
export class FakeRelay {
  events: any[] = []

  constructor(public maxMessage = Infinity) {}

  refuse = (e: any) => false

  publish = async (e: any) => {
    if (this.refuse(e)) return {ok: false}
    if (JSON.stringify(["EVENT", e]).length > this.maxMessage) return {ok: false}
    if (!verifyEvent(e)) throw new Error(`relay: bad signature on kind ${e.kind}`)
    if (!this.events.find(x => x.id === e.id)) this.events.push(e)

    return {ok: true}
  }

  query = (filters: any[]) => this.events.filter(e => filters.some(f => matches(e, f)))
}

// The app's own files only: with no file host reachable, a locked file falls back to the relay.
export const stubFetch = () =>
  vi.stubGlobal(
    "fetch",
    async (url: string) => new Response(readFileSync(join(process.cwd(), "public", url))),
  )

// A Blossom file host in memory (BUD-01 GET /<sha256>, BUD-02 PUT /upload), next to the app's
// own files. It checks the upload's authorisation event as a real host does.
export const fileHost = {
  blobs: new Map<string, Uint8Array>(),
  down: false,
  uploads: [] as any[],
  gets: [] as string[],
}

export const stubFetchWithFileHost = () => {
  fileHost.blobs.clear()
  fileHost.uploads = []
  fileHost.gets = []
  fileHost.down = false

  vi.stubGlobal("fetch", async (url: string, init: any = {}) => {
    if (!url.startsWith("https://")) {
      return new Response(readFileSync(join(process.cwd(), "public", url)))
    }

    if (fileHost.down) throw new TypeError("Failed to fetch")

    if (init.method === "PUT" && url.endsWith("/upload")) {
      const bytes = new Uint8Array(init.body)
      const x = createHash("sha256").update(bytes).digest("hex")
      const auth = JSON.parse(atob(String(init.headers.Authorization).replace(/^Nostr /, "")))
      const tag = (name: string) => auth.tags.find((t: string[]) => t[0] === name)?.[1]

      if (!verifyEvent(auth) || auth.kind !== 24242 || tag("t") !== "upload" || tag("x") !== x) {
        return new Response("bad authorization", {status: 401})
      }

      fileHost.blobs.set(x, bytes)
      fileHost.uploads.push(auth)

      const base = url.replace(/\/upload$/, "")

      return new Response(
        JSON.stringify({url: `${base}/${x}.bin`, sha256: x, size: bytes.length}),
        {status: 201},
      )
    }

    fileHost.gets.push(url)

    const blob = fileHost.blobs.get(url.split("/").pop()!.replace(/\..*$/, ""))

    return blob ? new Response(blob) : new Response("not found", {status: 404})
  })
}

export const tick = (seconds = 60) => vi.setSystemTime(Date.now() + seconds * 1000)

// Pass an earlier party's key and storage to reopen the app as that person.
export const makeParty = async (
  relay: FakeRelay,
  keep?: {sk: Uint8Array; storage: Map<string, string>},
) => {
  const sk = keep?.sk ?? generateSecretKey()
  const pk = getPublicKey(sk)
  const storage = keep?.storage ?? new Map<string, string>()
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
    storage,
    relay,
    signer,
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
