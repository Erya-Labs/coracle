import * as nenya from "nenya"
import type {ISigner} from "@welshman/signer"
import {schnorr} from "@noble/curves/secp256k1"
import {finalizeEvent, generateSecretKey, getPublicKey} from "nostr-tools/pure"
import {decrypt, encrypt, getConversationKey} from "nostr-tools/nip44"
import {writable} from "svelte/store"

// The whole private side of a trade: proposal, acceptance, bills, payment proofs,
// commitment, release, delivery checks. Every rule is the nenya library's; this file
// only moves its results around. Ported from the stage-1 demo page's trade flow.
//
// The signer is the logged-in session's, of any kind, as long as it supports nip44:
// nenya's sealAsync/openAsync drive the sealed channel through its promises, so an
// extension, a signer app and the dev test signer work alike. Remaining PoC shortcuts: the
// default bill is pretend (real BOLT-11, genuine preimage, nothing actually paid)
// unless the seller pastes a real invoice; the encrypted file and the payment voucher
// ride the relay, so two browser windows can trade with no other infrastructure.

const hex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")

const unhex = (s: string) => Uint8Array.from(s.match(/../g)!.map(h => parseInt(h, 16)))

const b64 = (bytes: Uint8Array) => {
  let s = ""

  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }

  return btoa(s)
}

const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

const sha256 = async (bytes: Uint8Array) =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))

const clock = () => Math.floor(Date.now() / 1000)

// A replayed message is judged at the moment this device first saw it, not at the moment of
// the reload: otherwise a bill or an acceptance that was fine when it arrived is refused for
// being old, and the whole order falls apart on reload.
let judgedAt: number | null = null

const FIRST_SEEN_KEY = "nenya-first-seen"

const firstSeen = (id: string, now = clock()) => {
  let all: any = {}

  try {
    all = JSON.parse(localStorage.getItem(FIRST_SEEN_KEY) || "{}")
  } catch {
    all = {}
  }

  if (all[id]) return all[id]

  all[id] = now
  localStorage.setItem(FIRST_SEEN_KEY, JSON.stringify(all))

  return all[id]
}

// --- keys, signer, environment -------------------------------------------------

// The order channel is sealed with nip44 end to end, so the signer must support it.
export const orderChannelCapable = (signer: ISigner | undefined) => Boolean(signer?.nip44)

// Throwaway signers for the wrap layer are minted locally, so these stay synchronous.
const makeSigner = (sk: Uint8Array) => {
  const pk = getPublicKey(sk)

  return new nenya.JsSigner(
    () => pk,
    serialisation => {
      try {
        const [, , created_at, kind, tags, content] = JSON.parse(serialisation)

        return finalizeEvent({kind, created_at, tags, content}, sk).sig
      } catch {
        return null
      }
    },
    (counterparty, plaintext) => {
      try {
        return encrypt(plaintext, getConversationKey(sk, counterparty))
      } catch {
        return null
      }
    },
    (counterparty, payload) => {
      let ck
      try {
        ck = getConversationKey(sk, counterparty)
      } catch {
        return null
      }
      try {
        return new nenya.JsDecryption(true, decrypt(payload, ck))
      } catch {
        return new nenya.JsDecryption(false)
      }
    },
  )
}

// Completes exactly once: with the signer's string, or null when it refused, failed or
// answered with anything else.
const settle = (
  ask: () => Promise<unknown>,
  complete: (value: any) => void,
  wrap = (s: string): any => s,
) =>
  Promise.resolve()
    .then(ask)
    .then(
      value => complete(typeof value === "string" ? wrap(value) : null),
      () => complete(null),
    )

// nenya's async signer: the same four calls in completion form, answered by the session signer.
export const makeAsyncSigner = (signer: ISigner) =>
  new nenya.JsAsyncSigner(
    complete => settle(() => signer.getPubkey(), complete),
    (serialisation, complete) =>
      settle(async () => {
        const [, , created_at, kind, tags, content] = JSON.parse(serialisation)

        return (await signer.sign({kind, created_at, tags, content}))?.sig
      }, complete),
    (counterparty, plaintext, complete) =>
      settle(() => signer.nip44.encrypt(counterparty, plaintext), complete),
    (counterparty, payload, complete) =>
      settle(
        () => signer.nip44.decrypt(counterparty, payload),
        complete,
        plaintext => new nenya.JsDecryption(true, plaintext),
      ),
  )

export const makeEnvironment = () =>
  new nenya.JsEnvironment(
    () => String(judgedAt ?? clock()),
    count => {
      try {
        return hex(crypto.getRandomValues(new Uint8Array(count)))
      } catch {
        return null
      }
    },
    (pubkey, message, signature) => {
      try {
        return schnorr.verify(signature, message, pubkey) ? "VALID" : "INVALID"
      } catch {
        return "INVALID"
      }
    },
    () => {
      try {
        return makeSigner(generateSecretKey())
      } catch {
        return null
      }
    },
  )

let state: any = null
let pending: ISigner | undefined

// Another signer is another person, so the old state and its threads are dropped.
const initState = async (signer: ISigner | undefined) => {
  if (state && state.source === signer) return state

  state = null
  pending = signer
  orderThreads.set(new Map())

  if (!signer?.nip44) return null

  const pk = await signer.getPubkey().catch(() => null)

  if (!pk || pending !== signer) return null

  const env = makeEnvironment()
  const records = new Map()
  const store = new nenya.JsPaymentRequestStore(
    (orderIdHex: string, payee: string) => records.get(`${orderIdHex}:${payee}`) ?? null,
    (record: any) => records.set(`${record.orderIdHex}:${record.payee}`, record),
  )

  state = {
    pk,
    source: signer,
    signer: makeAsyncSigner(signer),
    env,
    machine: new nenya.JsOrderMachine(env),
    store,
    seenWraps: new Set<string>(),
    opening: new Set<string>(),
    tries: new Map<string, number>(),
    seenRumors: new Set<string>(),
    waiting: [] as any[],
    held: [] as any[],
  }

  return state
}

// --- per-order secrets that only this window knows ------------------------------

const SECRETS_KEY = "nenya-order-secrets"

const secrets = (): any => {
  try {
    return JSON.parse(localStorage.getItem(SECRETS_KEY) || "{}")
  } catch {
    return {}
  }
}

const saveSecret = (orderId: string, patch: any) => {
  const all = secrets()

  all[orderId] = {...all[orderId], ...patch}
  localStorage.setItem(SECRETS_KEY, JSON.stringify(all))
}

// --- threads -------------------------------------------------------------------

export type OrderLine = {by: string; call: string; ok: boolean; words: string}

export const orderThreads = writable(new Map<string, any>())

const logLine = (thread: any, by: string, call: string, ok: boolean, words: string) => {
  thread.log = [...thread.log, {by, call, ok, words}]
}

const touch = (thread: any) =>
  orderThreads.update(m => {
    m.set(thread.orderId, thread)

    return new Map(m)
  })

const tagOf = (tags: string[][], name: string) => tags.find(t => t[0] === name)

const orderEvent = (type: string, f: any = {}) =>
  new nenya.JsOrderEvent(
    type,
    f.createdAt ?? null,
    f.orderIdHex ?? null,
    f.terms ?? null,
    f.statusToken ?? null,
    f.fromParty ?? null,
    f.commitment ?? null,
    f.release ?? null,
    f.proposalRumor ?? null,
    f.acceptanceRumor ?? null,
    f.providerPubkey ?? null,
    f.requests,
    f.settlements,
    f.servedBytesHex ?? null,
    f.plaintextBytesHex ?? null,
    f.maxServedBytes ?? null,
    f.deliveryFailure ?? null,
  )

const envelope = (counterparties: string[], content = "") =>
  new nenya.JsRumorEnvelope(
    state!.pk,
    String(clock()),
    counterparties.map(pk => [pk]),
    content,
  )

const buildWords = (result: any) =>
  [result.reason, result.tagReason, result.detail].filter(Boolean).join(" — ")

// --- publishing: the caller supplies publish/load so engine stays out of domain --

type Publish = (event: any) => Promise<{ok: boolean}>
type LoadByFilter = (filters: any[]) => Promise<any[]>

let publish: Publish = () => {
  throw new Error("order channel not connected")
}
let loadByFilter: LoadByFilter = async () => []

export const connectOrderChannel = async (
  p: Publish,
  l: LoadByFilter,
  signer: ISigner | undefined,
) => {
  publish = p
  loadByFilter = l

  return (await initState(signer))?.pk ?? null
}

const sealOne = (event: any, to: string) =>
  new Promise<any>(resolve => nenya.sealAsync(event, to, state!.signer, resolve, state!.env))

const sendRumor = async (built: any, recipients: string[]) => {
  if (!built.ok) return {sent: false, words: buildWords(built)}

  const wraps = []

  for (const to of recipients) {
    const sealed = await sealOne(built.event, to)

    if (!sealed.ok) return {sent: false, words: buildWords(sealed)}

    wraps.push(JSON.parse(sealed.toRecipient.json))

    if (wraps.length === 1) wraps.push(JSON.parse(sealed.toSelf.json))
  }

  const kept = await Promise.all(wraps.map(wrap => publish(wrap)))

  if (!kept.every(k => k.ok)) return {sent: false, words: "no relay kept the message"}

  return {sent: true, words: ""}
}

// --- the encrypted file rides the relay as a plain event -------------------------

const BLOB_KIND = 9876

const uploadBlob = async (bytes: Uint8Array) => {
  const event = finalizeEvent(
    {kind: BLOB_KIND, created_at: clock(), tags: [], content: b64(bytes)},
    generateSecretKey(),
  )

  return (await publish(event)).ok ? `nostr-blob:${event.id}` : null
}

const downloadBlob = async (url: string) => {
  const id = url.replace("nostr-blob:", "")
  const events = await loadByFilter([{ids: [id]}])

  return events.length > 0 ? unb64(events[0].content) : null
}

// --- file locking (AES-256-GCM, same as the demo page) ---------------------------

const lockFile = async (plain: Uint8Array) => {
  const key = crypto.getRandomValues(new Uint8Array(32))
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"])
  const blob = new Uint8Array(
    await crypto.subtle.encrypt({name: "AES-GCM", iv: nonce, tagLength: 128}, cryptoKey, plain),
  )

  return {key, nonce, blob, x: hex(await sha256(blob)), ox: hex(await sha256(plain))}
}

const unlockFile = async (blob: Uint8Array, keyHex: string, nonceHex: string) => {
  try {
    const cryptoKey = await crypto.subtle.importKey("raw", unhex(keyHex), "AES-GCM", false, [
      "decrypt",
    ])

    return new Uint8Array(
      await crypto.subtle.decrypt(
        {name: "AES-GCM", iv: unhex(nonceHex), tagLength: 128},
        cryptoKey,
        blob,
      ),
    )
  } catch {
    return null
  }
}

// --- pretend lightning: real bills, genuine preimages, no money ------------------

let billWriterInstance: any = null

const getBillWriter = async () => {
  if (!billWriterInstance) {
    const {billWriter} = await import("src/util/bolt11.js")
    const doc = await fetch("/vectors/bolt11/11-payment-encoding.md").then(r => r.text())

    billWriterInstance = billWriter(doc)
  }

  return billWriterInstance
}

// --- the dispatcher: every incoming rumor, exactly as the demo handles them -------

const newThread = (orderId: string): any => ({
  orderId,
  item: "",
  buyerKey: null,
  providerKey: null,
  proposal: null,
  acceptance: null,
  order: null,
  acceptedOrder: null,
  sightings: [],
  requests: {},
  settlements: {},
  commitment: null,
  commitmentRumor: null,
  fileUrl: null,
  release: null,
  vouchers: {},
  paid: {},
  delivered: null,
  downloads: 0,
  log: [],
})

const feeSighting = (point: string, tags: string[][]) =>
  new nenya.JsFeeTermSighting(point, tagOf(tags, "fee") ?? null)

const agreedTerms = (thread: any) => {
  const o = thread.acceptedOrder

  return new nenya.JsOrderTerms(
    o.priceMsat,
    o.feeBasisPoints ?? null,
    o.expirationSeconds ?? null,
    o.deliverBySeconds ?? null,
  )
}

const neededPayees = (thread: any) =>
  thread.order?.feePayeeRequired ? ["provider", "fee"] : ["provider"]

// The library keeps a bill or a proof whatever the order's state, so a bill that came before
// the commitment, or a proof before the seller's own copy of it, moves the order on later.
const stepPayments = (thread: any) => {
  const needed = neededPayees(thread)

  if (thread.order?.state === "COMMITTED" && needed.every(p => thread.requests[p])) {
    const step = nenya.stepOrder(
      state!.machine,
      thread.order,
      orderEvent("payment_requests_received", {requests: needed.map(p => thread.requests[p])}),
    )

    if (step.ok) thread.order = step.order

    logLine(
      thread,
      "nenya",
      "stepOrder(payment_requests_received)",
      step.ok,
      step.ok ? `All bills in. Order: ${thread.order.state}.` : buildWords(step),
    )
  }

  if (thread.order?.state === "AWAITING_PAYMENT" && needed.every(p => thread.settlements[p])) {
    const step = nenya.stepOrder(
      state!.machine,
      thread.order,
      orderEvent("receipts_verified", {settlements: needed.map(p => thread.settlements[p])}),
    )

    if (step.ok) thread.order = step.order

    logLine(
      thread,
      "nenya",
      "stepOrder(receipts_verified)",
      step.ok,
      step.ok
        ? `Every needed payment is evidenced. Order: ${thread.order.state}.`
        : buildWords(step),
    )
  }
}

// Refusals that only mean the order is not there yet: the message waits for the order to move.
const WAITS = ["WRONG_STATE_FOR_EVENT", "RELEASE_ORDER_NOT_PAID", "NO_STORED_REQUEST"]

const waits = (result: any) => !result.ok && WAITS.includes(result.reason)

// Answers the refusal's words when the message waits, and nothing when it was handled.
const handle = (rumor: any): string | void => {
  const orderId = rumor.orderIdHex
  const tags: string[][] = rumor.event.tags.map((t: string[]) => [...t])
  const threads = new Map(getThreads())

  if (rumor.kindNumber === 14) {
    // Chat doubles as the pretend payment rail: a voucher from the bill's issuer.
    // A chat rumor carries its order id in the "order" tag rather than on the rumor.
    const chatOrderId = orderId || tagOf(tags, "order")?.[1]

    try {
      const voucher = JSON.parse(rumor.event.content)

      if (voucher.lnsim && chatOrderId && threads.has(chatOrderId)) {
        const thread = threads.get(chatOrderId)

        thread.vouchers[voucher.payee] = voucher
        logLine(
          thread,
          "app",
          "voucher",
          true,
          `A pretend-lightning voucher arrived for the ${voucher.payee} bill.`,
        )
        touch(thread)
      }
    } catch {
      return
    }

    return
  }

  if (rumor.kindNumber === 16 && rumor.messageType === "PROPOSAL") {
    // The first proposal under an order id wins.
    if (threads.has(orderId)) return

    const read = nenya.decodeProposal(rumor)

    if (!read.ok) return

    const item = read.proposal.itemCoordinate
    const named = item.split(":")[1] ?? null

    // My own proposal names the listing I chose; anyone else's must name me.
    if (rumor.author !== state!.pk && named !== state!.pk) return

    const thread = newThread(orderId)

    thread.item = item
    thread.buyerKey = rumor.author
    thread.providerKey = named
    thread.proposal = rumor
    thread.sightings = [nenya.proposalFeeSighting(rumor).sighting]

    const opened = nenya.openOrderFromProposal(state!.machine, rumor)

    if (opened.ok) thread.order = opened.order

    logLine(
      thread,
      "nenya",
      "openOrderFromProposal",
      opened.ok,
      opened.ok
        ? `Nenya opened the order: ${thread.order.totalMsat} msat total, state ${thread.order.state}.`
        : buildWords(opened),
    )
    touch(thread)

    return
  }

  const thread = threads.get(orderId)

  if (!thread) return

  if (rumor.kindNumber === 16 && rumor.messageType === "STATUS_UPDATE") {
    const status = tagOf(tags, "status")?.[1]
    const step = nenya.stepOrderWithStatusUpdate(
      state!.machine,
      thread.order,
      thread.proposal,
      rumor,
      thread.providerKey,
    )

    if (waits(step)) return buildWords(step)

    if (status === "accepted") {
      if (step.ok) {
        thread.order = step.order
        thread.acceptedOrder = step.order
        thread.acceptance = rumor
        thread.sightings.push(nenya.acceptanceFeeSighting(rumor).sighting)
      }

      logLine(
        thread,
        "nenya",
        "stepOrderWithStatusUpdate(accepted)",
        step.ok,
        step.ok
          ? `Nenya checked the acceptance repeats every term exactly. Order: ${thread.order.state}.`
          : `Nenya refused the acceptance: ${buildWords(step)}`,
      )
    } else {
      if (step.order) thread.order = step.order

      logLine(
        thread,
        "nenya",
        "stepOrderWithStatusUpdate",
        step.ok,
        step.ok
          ? `Status "${status}" moved the order to ${thread.order.state}.`
          : `Nenya: a bare status decides nothing (${buildWords(step)}).`,
      )
    }

    touch(thread)

    return
  }

  if (rumor.kindNumber === 16 && rumor.messageType === "DELIVERY_COMMITMENT") {
    const step = nenya.stepOrderWithCommitment(
      state!.machine,
      thread.order,
      thread.proposal,
      rumor,
      thread.providerKey,
    )

    if (waits(step)) return buildWords(step)

    if (step.ok) {
      const read = nenya.decodeCommitment(rumor)

      thread.order = step.order
      thread.commitmentRumor = rumor
      thread.fileUrl = read.commitment.url
      thread.commitment = read.commitment.commitment
    }

    logLine(
      thread,
      "nenya",
      "stepOrderWithCommitment",
      step.ok,
      step.ok
        ? `The maker committed to the file's fingerprints before any payment. Order: ${thread.order.state}.`
        : buildWords(step),
    )
    stepPayments(thread)
    touch(thread)

    return
  }

  const isBill = rumor.kindNumber === 16 && rumor.messageType === "PAYMENT_REQUEST"

  // Bills and payment proofs are checked against the acceptance, so with none they wait.
  if ((isBill || rumor.kindNumber === 17) && !thread.acceptance) {
    return "a bill or payment proof came before any acceptance"
  }

  if (isBill) {
    const payee = tagOf(tags, "payee")?.[1] ?? "provider"
    const accepted = nenya.acceptPaymentRequest(
      rumor,
      thread.proposal,
      thread.acceptance,
      thread.providerKey,
      state!.store,
      state!.env,
      thread.sightings.slice(),
    )

    if (waits(accepted)) return buildWords(accepted)

    logLine(
      thread,
      "nenya",
      "acceptPaymentRequest",
      accepted.ok,
      accepted.ok
        ? `Nenya checked the ${payee} bill against the agreed terms and stored it.`
        : `Nenya refused the bill: ${buildWords(accepted)}`,
    )

    if (!accepted.ok) {
      touch(thread)

      return
    }

    thread.requests[payee] = accepted.request

    if (payee === "fee") thread.sightings.push(feeSighting("FEE_PAYMENT_REQUEST", tags))

    stepPayments(thread)
    touch(thread)

    return
  }

  if (rumor.kindNumber === 17) {
    const payee = tagOf(tags, "payee")?.[1] ?? "provider"
    const result =
      payee === "fee"
        ? nenya.verifyFeeReceipt(rumor, state!.store, thread.order, thread.sightings.slice())
        : nenya.verifySettlement(rumor, state!.store, agreedTerms(thread))
    const good = result.ok && result.settlement?.evidenced

    if (waits(result)) return buildWords(result)

    logLine(
      thread,
      "nenya",
      payee === "fee" ? "verifyFeeReceipt" : "verifySettlement",
      Boolean(good),
      good
        ? `The payment proof is genuine: the secret matches the bill's payment fingerprint.`
        : `Nenya refused the payment proof: ${buildWords(result)}`,
    )

    if (!good) {
      touch(thread)

      return
    }

    thread.settlements[payee] = result.settlement
    stepPayments(thread)
    touch(thread)

    return
  }

  if (rumor.kindNumber === 15) {
    const read = (n: string) => tagOf(tags, n)?.[1] ?? null
    const step = nenya.stepOrderWithRelease(
      state!.machine,
      thread.order,
      thread.proposal,
      rumor,
      thread.providerKey,
    )

    if (waits(step)) return buildWords(step)

    if (step.order) thread.order = step.order

    if (step.ok) {
      thread.release = {keyHex: read("decryption-key"), nonceHex: read("decryption-nonce")}
    }

    logLine(
      thread,
      "nenya",
      "stepOrderWithRelease",
      step.ok,
      step.ok
        ? `The key message matches the commitment. Order: ${thread.order.state}.`
        : `Nenya refused the key message: ${buildWords(step)} — order: ${thread.order.state}.`,
    )
    touch(thread)
  }
}

const getThreads = () => {
  let value: Map<string, any> = new Map()

  orderThreads.update(m => ((value = m), m))

  return value
}

// Two messages first seen in the same second run in the order a trade makes them.
const tradeStep = (rumor: any) => {
  if (rumor.messageType === "PROPOSAL") return 0
  if (rumor.messageType === "STATUS_UPDATE") return 1
  if (rumor.messageType === "DELIVERY_COMMITMENT") return 2
  if (rumor.messageType === "PAYMENT_REQUEST") return 3
  if (rumor.kindNumber === 14) return 4
  if (rumor.kindNumber === 17) return 5
  if (rumor.kindNumber === 15) return 6

  return 7
}

const openOne = (wrapJson: string) =>
  new Promise<any>(resolve => nenya.openAsync(wrapJson, state!.signer, resolve, state!.env))

// A signer that declined or timed out may answer on a later poll.
const RETRIED = ["COULD_NOT_DECRYPT_WRAP", "COULD_NOT_DECRYPT_SEAL"]

export const processWraps = async (events: any[]) => {
  if (!state) return

  // One clock reading for the whole batch: a slow signer must not spread it over several
  // seconds, or the order the relay sent the wraps in would replace trade order.
  const now = clock()
  const opened = []

  for (const wrap of events) {
    if (state.seenWraps.has(wrap.id) || state.opening.has(wrap.id)) continue

    state.opening.add(wrap.id)

    const result = await openOne(JSON.stringify(wrap))
    const tries = (state.tries.get(wrap.id) ?? 0) + 1

    state.opening.delete(wrap.id)

    if (!result.ok && RETRIED.includes(result.reason) && tries < 3) {
      state.tries.set(wrap.id, tries)
      continue
    }

    state.tries.delete(wrap.id)
    state.seenWraps.add(wrap.id)

    if (!result.ok) continue

    const rumor = result.rumor

    if (state.seenRumors.has(rumor.idHex)) continue

    state.seenRumors.add(rumor.idHex)
    firstSeen(rumor.idHex, now)
    opened.push(rumor)
  }

  // In the order this device first saw them, never by the sender's clock.
  const waiting = [...state.waiting, ...opened].sort(
    (a, b) => firstSeen(a.idHex) - firstSeen(b.idHex) || tradeStep(a) - tradeStep(b),
  )

  state.waiting = []

  // A message whose order has not arrived yet waits for the next batch.
  for (const rumor of waiting) {
    if (rumor.messageType !== "PROPOSAL" && !getThreads().has(orderOf(rumor))) {
      state.waiting.push(rumor)
      continue
    }

    run(rumor, 1)
  }
}

const orderOf = (rumor: any) => rumor.orderIdHex || tagOf(rumor.event.tags, "order")?.[1]

// A message refused only because its order was not ready is held, and handed back in each time
// that order moves on, for at most 3 tries in all.
const run = (rumor: any, tries: number) => {
  const orderId = orderOf(rumor)
  const thread = getThreads().get(orderId)
  const before = thread?.order?.state
  let words

  judgedAt = firstSeen(rumor.idHex)

  try {
    words = handle(rumor)
  } finally {
    judgedAt = null
  }

  if (words) {
    if (tries === 1) {
      logLine(thread, "app", "wait", false, `Held until the order moves on: ${words}`)
      touch(thread)
    }

    if (tries < 3) state.held.push({rumor, tries: tries + 1})

    return
  }

  if (getThreads().get(orderId)?.order?.state === before) return

  const again = state.held.filter((h: any) => orderOf(h.rumor) === orderId)

  state.held = state.held.filter((h: any) => orderOf(h.rumor) !== orderId)
  again.forEach((h: any) => run(h.rumor, h.tries))
}

// --- the actions each role takes, in order ---------------------------------------

export const proposeOrder = async (listing: any) => {
  const orderId = hex(crypto.getRandomValues(new Uint8Array(32)))
  const terms = new nenya.JsOrderTerms(
    listing.priceMsat,
    listing.feeBasisPoints ?? null,
    String(clock() + 2 * 86_400),
    listing.deliverBySeconds ?? null,
  )
  const built = nenya.buildProposalAgainst(
    listing,
    state!.env,
    envelope([listing.authorPubkey]),
    orderId,
    terms,
    listing.feeRecipient ?? null,
  )

  return sendRumor(built, [listing.authorPubkey])
}

export const acceptOrder = async (thread: any) => {
  const [kind, author, ...d] = thread.item.split(":")
  const events = await loadByFilter([
    {kinds: [parseInt(kind)], authors: [author], "#d": [d.join(":")]},
  ])
  const read = events.length > 0 ? nenya.decodeListing(JSON.stringify(events[0])) : null

  if (!read?.ok) return {sent: false, words: "the listing this order is for could not be read"}

  const built = nenya.buildAgreementAgainst(
    read.listing,
    state!.env,
    envelope([thread.buyerKey]),
    thread.proposal,
  )

  return sendRumor(built, [thread.buyerKey])
}

export const cancelOrder = async (thread: any) => {
  // A cancellation recovers no payment, so a buyer who sent a proof can no longer cancel.
  if (secrets()[thread.orderId]?.paidPreimageHex) {
    return {sent: false, words: "a payment proof was already sent for this order"}
  }

  const built = nenya.buildStatusUpdate(envelope([thread.providerKey]), thread.orderId, "cancelled")

  return sendRumor(built, [thread.providerKey])
}

// The locked file rides the relay as one event, and relays cap an event's size.
const MAX_FILE_BYTES = 40_000

export const commitFile = async (thread: any, plain: Uint8Array, mimeType: string) => {
  // Committing again resends the very same rumor, so the buyer never sees a second key.
  let saved = secrets()[thread.orderId]

  if (!saved?.url) {
    if (plain.length > MAX_FILE_BYTES) {
      return {sent: false, words: `the file is over ${MAX_FILE_BYTES} bytes, too big for a relay`}
    }

    const locked = await lockFile(plain)
    const url = await uploadBlob(locked.blob)

    if (!url) return {sent: false, words: "no relay kept the locked file"}

    saved = {
      keyHex: hex(locked.key),
      nonceHex: hex(locked.nonce),
      x: locked.x,
      ox: locked.ox,
      size: String(locked.blob.length),
      mimeType,
      url,
      at: String(clock()),
    }
    saveSecret(thread.orderId, saved)
  }

  const built = nenya.buildCommitment(
    new nenya.JsRumorEnvelope(state!.pk, saved.at, [[thread.buyerKey]]),
    thread.orderId,
    new nenya.JsCommitment(saved.x, saved.ox, saved.mimeType, saved.size),
    saved.url,
  )

  return sendRumor(built, [thread.buyerKey])
}

export const sendBill = async (thread: any, realInvoice = "") => {
  // With a real invoice from the seller's own wallet, the trade is a real one: the
  // buyer pays it in their wallet and proves it with the preimage the wallet shows.
  // Without one, the demo writes a pretend bill and vouchers its preimage across.
  let invoice = realInvoice.trim()
  let preimage: Uint8Array | null = null

  if (!invoice) {
    const writer = await getBillWriter()

    preimage = crypto.getRandomValues(new Uint8Array(32))
    invoice = writer.write(BigInt(thread.order.priceMsat), await sha256(preimage), clock())
  }

  const built = nenya.buildPaymentRequest(
    envelope([thread.buyerKey]),
    thread.orderId,
    "provider",
    invoice,
  )
  const sent = await sendRumor(built, [thread.buyerKey])

  if (!sent.sent || !preimage) return sent

  const voucher = JSON.stringify({lnsim: 1, payee: "provider", invoice, preimageHex: hex(preimage)})

  return sendRumor(nenya.buildChat(envelope([thread.buyerKey], voucher), thread.orderId), [
    thread.buyerKey,
  ])
}

export const payAndProve = async (thread: any, realPreimageHex = "") => {
  const stored = thread.requests.provider

  if (!stored) return {sent: false, words: "no accepted bill yet"}

  let preimageHex = realPreimageHex.trim().toLowerCase()

  if (!preimageHex) {
    const voucher = thread.vouchers.provider

    if (!voucher)
      return {sent: false, words: "no voucher yet — for a real bill, paste the preimage"}
    if (voucher.invoice !== stored.invoice) {
      return {sent: false, words: "the voucher's bill is not the bill nenya accepted"}
    }

    preimageHex = voucher.preimageHex
  }

  saveSecret(thread.orderId, {paidPreimageHex: preimageHex})

  const built = nenya.buildReceipt(
    envelope([thread.providerKey]),
    thread.orderId,
    "provider",
    stored.invoice,
    preimageHex,
  )

  return sendRumor(built, [thread.providerKey])
}

export const releaseKey = async (thread: any) => {
  const secret = secrets()[thread.orderId]

  if (!secret?.keyHex) return {sent: false, words: "this window never locked the file"}

  // The library takes the settlement itself and throws on none.
  if (!thread.settlements.provider) return {sent: false, words: "no verified payment yet"}

  const built = nenya.buildReleaseAfterPayment(
    envelope([thread.buyerKey]),
    thread.commitmentRumor,
    thread.settlements.provider,
    secret.keyHex,
    secret.nonceHex,
  )

  return sendRumor(built, [thread.buyerKey])
}

export const verifyDelivery = async (thread: any) => {
  if (thread.downloads >= 5) return

  const blob = await downloadBlob(thread.fileUrl)

  if (!blob) {
    thread.downloads++
    logLine(thread, "app", "download", false, "The locked file could not be downloaded.")
    touch(thread)

    return
  }

  logLine(thread, "app", "download", true, `Downloaded the locked file (${blob.length} bytes).`)

  const served = nenya.verifyServedBytes(thread.commitment, hex(blob), null)

  logLine(
    thread,
    "nenya",
    "verifyServedBytes",
    served.ok,
    served.ok
      ? "The downloaded file matches the commitment. Only now may it be unlocked."
      : `Nenya refused the downloaded file before anything was unlocked: ${buildWords(served)}`,
  )

  if (!served.ok) {
    const step = nenya.stepOrder(
      state!.machine,
      thread.order,
      orderEvent("delivery_refused", {deliveryFailure: "SERVED_BYTES_HASH_MISMATCH"}),
    )

    if (step.order) thread.order = step.order

    touch(thread)

    return
  }

  const plain = await unlockFile(blob, thread.release.keyHex, thread.release.nonceHex)

  if (!plain) {
    const step = nenya.stepOrder(
      state!.machine,
      thread.order,
      orderEvent("delivery_refused", {deliveryFailure: "BLOB_DID_NOT_DECRYPT"}),
    )

    if (step.order) thread.order = step.order

    logLine(thread, "app", "unlock", false, "The key did not unlock the file.")
    touch(thread)

    return
  }

  const step = nenya.stepOrder(
    state!.machine,
    thread.order,
    orderEvent("delivery_verified", {
      commitment: thread.commitment,
      servedBytesHex: hex(blob),
      plaintextBytesHex: hex(plain),
    }),
  )

  if (step.ok) {
    thread.order = step.order
    thread.delivered = plain
  } else if (thread.order.state === "RELEASED") {
    if (step.deliveryFailure) {
      const report = nenya.stepOrder(
        state!.machine,
        thread.order,
        orderEvent("delivery_refused", {deliveryFailure: step.deliveryFailure}),
      )

      if (report.order) thread.order = report.order
    }
  }

  logLine(
    thread,
    "nenya",
    "stepOrder(delivery_verified)",
    step.ok,
    step.ok
      ? `Both fingerprints match the promise. Order: ${thread.order.state}.`
      : `Nenya refused the delivery: ${buildWords(step)} — order: ${thread.order.state}.`,
  )
  touch(thread)
}
