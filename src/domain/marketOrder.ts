import * as nenya from "nenya"
import {finalizeEvent, generateSecretKey, getPublicKey} from "nostr-tools/pure"
import {decrypt, encrypt, getConversationKey} from "nostr-tools/nip44"
import {writable} from "svelte/store"

// The whole private side of a trade: proposal, acceptance, bills, payment proofs,
// commitment, release, delivery checks. Every rule is the nenya library's; this file
// only moves its results around. Ported from the stage-1 demo page's trade flow.
//
// PoC constraints, on purpose: the signer needs a raw key (nenya's signer callbacks
// are synchronous, which a NIP-07 extension cannot be), so this only works with the
// dev test signer; money is pretend (bills are real BOLT-11, preimages are genuine
// proofs, nothing is actually paid); the encrypted file and the payment voucher ride
// the relay, so two browser windows can trade with no other infrastructure.

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

// --- keys, signer, environment -------------------------------------------------

const skHex = () => (window as any).__e2eSecretKeyHex as string | undefined

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

const state = (() => {
  const sk = skHex() ? unhex(skHex()!) : null

  if (!sk) return null

  const signer = makeSigner(sk)
  const env = new nenya.JsEnvironment(
    () => String(clock()),
    count => {
      try {
        return hex(crypto.getRandomValues(new Uint8Array(count)))
      } catch {
        return null
      }
    },
    null,
    () => {
      try {
        return makeSigner(generateSecretKey())
      } catch {
        return null
      }
    },
  )

  const records = new Map()
  const store = new nenya.JsPaymentRequestStore(
    (orderIdHex: string, payee: string) => records.get(`${orderIdHex}:${payee}`) ?? null,
    (record: any) => records.set(`${record.orderIdHex}:${record.payee}`, record),
  )

  return {
    sk,
    pk: getPublicKey(sk),
    signer,
    env,
    machine: new nenya.JsOrderMachine(env),
    store,
    seenWraps: new Set<string>(),
    seenRumors: new Set<string>(),
  }
})()

export const orderChannelReady = Boolean(state)

export const myOrderPubkey = state?.pk

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

type Publish = (event: any) => void
type LoadByFilter = (filters: any[]) => Promise<any[]>

let publish: Publish = () => {
  throw new Error("order channel not connected")
}
let loadByFilter: LoadByFilter = async () => []

export const connectOrderChannel = (p: Publish, l: LoadByFilter) => {
  publish = p
  loadByFilter = l
}

const sendRumor = (built: any, recipients: string[]) => {
  if (!built.ok) return {sent: false, words: buildWords(built)}

  const wraps = []

  for (const to of recipients) {
    const sealed = nenya.seal(built.event, to, state!.signer, state!.env)

    if (!sealed.ok) return {sent: false, words: buildWords(sealed)}

    wraps.push(JSON.parse(sealed.toRecipient.json))

    if (wraps.length === 1) wraps.push(JSON.parse(sealed.toSelf.json))
  }

  for (const wrap of wraps) publish(wrap)

  return {sent: true, words: ""}
}

// --- the encrypted file rides the relay as a plain event -------------------------

const BLOB_KIND = 9876

const uploadBlob = (bytes: Uint8Array) => {
  const event = finalizeEvent(
    {kind: BLOB_KIND, created_at: clock(), tags: [], content: b64(bytes)},
    state!.sk,
  )

  publish(event)

  return `nostr-blob:${event.id}`
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
  terms: null,
  order: null,
  acceptedOrder: null,
  sightings: [],
  requests: {},
  settlements: {},
  commitment: null,
  fileUrl: null,
  release: null,
  vouchers: {},
  paid: {},
  delivered: null,
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

const handle = (rumor: any) => {
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
    const item = tagOf(tags, "item")?.[1] ?? ""
    const fee = tagOf(tags, "fee")
    const thread = newThread(orderId)

    thread.item = item
    thread.buyerKey = rumor.author
    thread.providerKey = item.split(":")[1] ?? null
    thread.proposal = rumor
    thread.sightings = [feeSighting("ORDER_PROPOSAL", tags)]
    thread.terms = new nenya.JsOrderTerms(
      tagOf(tags, "amount_msat")?.[1],
      fee ? Number(fee[1]) : null,
      tagOf(tags, "expiration")?.[1] ?? null,
      tagOf(tags, "deliver_by")?.[1] ?? null,
    )

    const opened = nenya.openOrder(state!.machine, orderId, thread.terms, rumor.createdAtSeconds)

    if (opened.ok) thread.order = opened.order

    logLine(
      thread,
      "nenya",
      "openOrder",
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

    if (status === "accepted") {
      thread.acceptance = rumor
      thread.sightings.push(feeSighting("ACCEPTANCE", tags))

      const step = nenya.stepOrder(
        state!.machine,
        thread.order,
        orderEvent("acceptance_received", {
          createdAt: rumor.createdAtSeconds,
          proposalRumor: thread.proposal,
          acceptanceRumor: rumor,
          providerPubkey: thread.providerKey,
        }),
      )

      if (step.ok) {
        thread.order = step.order
        thread.acceptedOrder = step.order
      } else {
        thread.acceptance = null
      }

      logLine(
        thread,
        "nenya",
        "stepOrder(acceptance_received)",
        step.ok,
        step.ok
          ? `Nenya checked the acceptance repeats every term exactly. Order: ${thread.order.state}.`
          : `Nenya refused the acceptance: ${buildWords(step)}`,
      )
    } else {
      const step = nenya.stepOrder(
        state!.machine,
        thread.order,
        orderEvent("status_update", {
          createdAt: rumor.createdAtSeconds,
          statusToken: status,
          fromParty: roleOf(thread, rumor.author),
        }),
      )

      if (step.order) thread.order = step.order

      logLine(
        thread,
        "nenya",
        "stepOrder(status_update)",
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
    const read = (n: string) => tagOf(tags, n)?.[1] ?? null

    thread.fileUrl = read("url")
    thread.commitment = new nenya.JsCommitment(read("x")!, read("ox")!, read("m")!, read("size")!)

    const step = nenya.stepOrder(
      state!.machine,
      thread.order,
      orderEvent("delivery_committed", {
        createdAt: rumor.createdAtSeconds,
        commitment: thread.commitment,
        fromParty: roleOf(thread, rumor.author),
      }),
    )

    if (step.ok) thread.order = step.order

    logLine(
      thread,
      "nenya",
      "stepOrder(delivery_committed)",
      step.ok,
      step.ok
        ? `The maker committed to the file's fingerprints before any payment. Order: ${thread.order.state}.`
        : buildWords(step),
    )
    touch(thread)

    return
  }

  if (rumor.kindNumber === 16 && rumor.messageType === "PAYMENT_REQUEST") {
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

    const needed = neededPayees(thread)

    if (thread.order.state === "COMMITTED" && needed.every(p => thread.requests[p])) {
      const step = nenya.stepOrder(
        state!.machine,
        thread.order,
        orderEvent("payment_requests_received", {
          createdAt: rumor.createdAtSeconds,
          requests: needed.map(p => thread.requests[p]),
        }),
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

    const needed = neededPayees(thread)

    if (thread.order.state === "AWAITING_PAYMENT" && needed.every(p => thread.settlements[p])) {
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

    touch(thread)

    return
  }

  if (rumor.kindNumber === 15) {
    const read = (n: string) => tagOf(tags, n)?.[1] ?? null
    const release = new nenya.JsRelease(read("x")!, read("ox")!, read("file-type"), read("size")!)

    thread.release = {
      release,
      keyHex: read("decryption-key"),
      nonceHex: read("decryption-nonce"),
    }

    const step = nenya.stepOrder(
      state!.machine,
      thread.order,
      orderEvent("deliverable_released", {
        createdAt: rumor.createdAtSeconds,
        release,
        fromParty: roleOf(thread, rumor.author),
        orderIdHex: orderId,
      }),
    )

    if (step.order) thread.order = step.order

    logLine(
      thread,
      "nenya",
      "stepOrder(deliverable_released)",
      step.ok,
      step.ok
        ? `The key message matches the commitment. Order: ${thread.order.state}.`
        : `Nenya refused the key message: ${buildWords(step)} — order: ${thread.order.state}.`,
    )
    touch(thread)
  }
}

const roleOf = (thread: any, pk: string) =>
  pk === thread.providerKey ? "PROVIDER" : pk === thread.buyerKey ? "BUYER" : null

const getThreads = () => {
  let value: Map<string, any> = new Map()

  orderThreads.update(m => ((value = m), m))

  return value
}

export const processWraps = (events: any[]) => {
  if (!state) return

  const opened = []

  for (const wrap of events) {
    if (state.seenWraps.has(wrap.id)) continue

    state.seenWraps.add(wrap.id)

    const result = nenya.open(JSON.stringify(wrap), state.signer, state.env)

    if (!result.ok) continue

    const rumor = result.rumor

    if (state.seenRumors.has(rumor.idHex)) continue

    state.seenRumors.add(rumor.idHex)
    opened.push(rumor)
  }

  opened.sort((a, b) =>
    a.createdAtSeconds === b.createdAtSeconds
      ? a.idHex.localeCompare(b.idHex)
      : Number(a.createdAtSeconds) - Number(b.createdAtSeconds),
  )

  for (const rumor of opened) handle(rumor)
}

// --- the actions each role takes, in order ---------------------------------------

export const proposeOrder = (listing: any) => {
  const orderId = hex(crypto.getRandomValues(new Uint8Array(32)))
  const terms = new nenya.JsOrderTerms(
    listing.priceMsat,
    listing.feeBasisPoints ?? null,
    String(clock() + 2 * 86_400),
    listing.deliverBySeconds ?? null,
  )
  const built = nenya.buildProposal(
    envelope([listing.authorPubkey]),
    orderId,
    listing.coordinate,
    terms,
    listing.feeRecipient ?? null,
  )

  return sendRumor(built, [listing.authorPubkey])
}

export const acceptOrder = (thread: any) => {
  const built = nenya.buildStatusUpdate(
    envelope([thread.buyerKey]),
    thread.orderId,
    "accepted",
    thread.item,
    thread.terms,
    null,
  )

  return sendRumor(built, [thread.buyerKey])
}

export const commitFile = async (thread: any, plain: Uint8Array, mimeType: string) => {
  const locked = await lockFile(plain)
  const url = uploadBlob(locked.blob)

  saveSecret(thread.orderId, {
    keyHex: hex(locked.key),
    nonceHex: hex(locked.nonce),
    x: locked.x,
    ox: locked.ox,
    size: String(locked.blob.length),
    mimeType,
  })

  const built = nenya.buildCommitment(
    envelope([thread.buyerKey]),
    thread.orderId,
    new nenya.JsCommitment(locked.x, locked.ox, mimeType, String(locked.blob.length)),
    url,
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
  const sent = sendRumor(built, [thread.buyerKey])

  if (!sent.sent || !preimage) return sent

  const voucher = JSON.stringify({lnsim: 1, payee: "provider", invoice, preimageHex: hex(preimage)})

  return sendRumor(nenya.buildChat(envelope([thread.buyerKey], voucher), thread.orderId), [
    thread.buyerKey,
  ])
}

export const payAndProve = (thread: any, realPreimageHex = "") => {
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

export const releaseKey = (thread: any) => {
  const secret = secrets()[thread.orderId]

  if (!secret?.keyHex) return {sent: false, words: "this window never locked the file"}

  const built = nenya.buildRelease(
    envelope([thread.buyerKey]),
    thread.orderId,
    new nenya.JsRelease(secret.x, secret.ox, secret.mimeType, secret.size),
    secret.keyHex,
    secret.nonceHex,
  )

  return sendRumor(built, [thread.buyerKey])
}

export const verifyDelivery = async (thread: any) => {
  const blob = await downloadBlob(thread.fileUrl)

  if (!blob) {
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
    const failure = {
      SERVED_BYTES_MISMATCH: "SERVED_BYTES_HASH_MISMATCH",
      PLAINTEXT_BYTES_MISMATCH: "PLAINTEXT_BYTES_HASH_MISMATCH",
    }[step.reason as string]

    if (failure) {
      const report = nenya.stepOrder(
        state!.machine,
        thread.order,
        orderEvent("delivery_refused", {deliveryFailure: failure}),
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
