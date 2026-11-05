import {afterEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import * as nenya from "nenya"
import {finalizeEvent, generateSecretKey, getPublicKey, verifyEvent} from "nostr-tools/pure"
import {decrypt, encrypt, getConversationKey} from "nostr-tools/nip44"
import {npubEncode} from "nostr-tools/nip19"
import {Nip01Signer, Nip07Signer, Nip55Signer, setNip55Plugin} from "@welshman/signer"
import type {ISigner} from "@welshman/signer"
import {
  connectOrderChannel,
  makeAsyncSigner,
  makeEnvironment,
  orderThreads,
} from "../../../src/domain/marketOrder"

const TEXT = "50% off, order #7? yes"

const bytesToHex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex")

const crypt = (sk: Uint8Array) => ({
  encrypt: async (peer: string, text: string) => encrypt(text, getConversationKey(sk, peer)),
  decrypt: async (peer: string, payload: string) => decrypt(payload, getConversationKey(sk, peer)),
})

const nip07 = (sk: Uint8Array) => {
  vi.stubGlobal("window", {
    nostr: {
      getPublicKey: async () => getPublicKey(sk),
      signEvent: async (e: any) => finalizeEvent(e, sk),
      nip44: crypt(sk),
    },
  })

  return new Nip07Signer()
}

const nip55 = (sk: Uint8Array, plugin: any = {}) => {
  const npub = npubEncode(getPublicKey(sk))
  const {encrypt, decrypt} = crypt(sk)

  setNip55Plugin({
    setPackageName: async () => {},
    getInstalledSignerApps: async () => ({apps: []}),
    getPublicKey: async () => ({npub}),
    signEvent: async (_: string, json: string) => ({
      event: JSON.stringify(finalizeEvent(JSON.parse(json), sk)),
    }),
    nip44Encrypt: async (_: string, text: string, __: string, peer: string) => ({
      result: await encrypt(peer, text),
    }),
    nip44Decrypt: async (_: string, payload: string, __: string, peer: string) => ({
      result: await decrypt(peer, payload),
    }),
    ...plugin,
  } as any)

  return new Nip55Signer("test.signer")
}

const chat = async (from: ISigner, to: string) => {
  const envelope = new nenya.JsRumorEnvelope(
    await from.getPubkey(),
    String(Math.floor(Date.now() / 1000)),
    [[to]],
    TEXT,
  )

  return nenya.buildChat(envelope).event!
}

const seal = async (from: ISigner, to: string) =>
  new Promise<any>(async resolve =>
    nenya.sealAsync(await chat(from, to), to, makeAsyncSigner(from), resolve, makeEnvironment()),
  )

const open = (json: string, me: ISigner) =>
  new Promise<any>(resolve =>
    nenya.openAsync(json, makeAsyncSigner(me), resolve, makeEnvironment()),
  )

// The seal is inside the wrap, encrypted to the recipient by the wrap's throwaway key.
const sealInside = (wrapJson: string, sk: Uint8Array) => {
  const wrap = JSON.parse(wrapJson)

  return JSON.parse(decrypt(wrap.content, getConversationKey(sk, wrap.pubkey)))
}

afterEach(() => {
  vi.unstubAllGlobals()
  setNip55Plugin(undefined)
})

const kinds: [string, (sk: Uint8Array) => ISigner][] = [
  ["Nip01Signer", sk => new Nip01Signer(bytesToHex(sk))],
  ["Nip07Signer", nip07],
  ["Nip55Signer", sk => nip55(sk)],
]

describe.each(kinds)("the order channel over %s", (_, make) => {
  it("seals to a peer who opens it, with a valid seal signature", async () => {
    const sk = generateSecretKey()
    const peerSk = generateSecretKey()
    const peer = new Nip01Signer(bytesToHex(peerSk))

    const sealed = await seal(make(sk), getPublicKey(peerSk))

    expect(sealed.ok).toBe(true)

    const inner = sealInside(sealed.toRecipient.json, peerSk)

    expect(inner.pubkey).toBe(getPublicKey(sk))
    expect(verifyEvent(inner)).toBe(true)

    const opened = await open(sealed.toRecipient.json, peer)

    expect(opened.ok).toBe(true)
    expect(opened.rumor.content).toBe(TEXT)
  })

  it("opens what a peer sealed to it", async () => {
    const sk = generateSecretKey()
    const peer = new Nip01Signer(bytesToHex(generateSecretKey()))

    const sealed = await seal(peer, getPublicKey(sk))
    const opened = await open(sealed.toRecipient.json, make(sk))

    expect(opened.ok).toBe(true)
    expect(opened.rumor.content).toBe(TEXT)
  })
})

describe("a signer that does not answer properly", () => {
  it("fails the seal when the signer app answers with no event", async () => {
    const signer = nip55(generateSecretKey(), {signEvent: async () => ({event: null})})

    const sealed = await seal(signer, getPublicKey(generateSecretKey()))

    expect(sealed.ok).toBe(false)
  })

  it("reports a rejected decrypt as a failed decrypt, not a refusal", async () => {
    const sk = generateSecretKey()
    const peer = new Nip01Signer(bytesToHex(generateSecretKey()))
    const sealed = await seal(peer, getPublicKey(sk))
    const signer = nip55(sk, {
      nip44Decrypt: async () => {
        throw new Error("declined")
      },
    })

    const opened = await open(sealed.toRecipient.json, signer)

    expect(opened.ok).toBe(false)
    expect(opened.reason).toBe("COULD_NOT_DECRYPT_WRAP")
  })
})

describe("connectOrderChannel", () => {
  it("keeps the threads for the same signer and empties them for another", async () => {
    const noop = () => {}
    const load = async () => []
    const a = new Nip01Signer(bytesToHex(generateSecretKey()))
    const b = new Nip01Signer(bytesToHex(generateSecretKey()))

    expect(await connectOrderChannel(noop, load, a)).toBe(await a.getPubkey())

    orderThreads.set(new Map([["order", {}]]))

    expect(await connectOrderChannel(noop, load, a)).toBe(await a.getPubkey())
    expect(get(orderThreads).size).toBe(1)

    expect(await connectOrderChannel(noop, load, b)).toBe(await b.getPubkey())
    expect(get(orderThreads).size).toBe(0)
  })
})
