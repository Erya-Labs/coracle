// The pretend wallet's bill writer: invoices in the real BOLT-11 format (with a stale signature, see
// below), each derived from an official example
// invoice in the vendored BOLT #11 document (nenya-core/src/commonTest/resources/vectors/bolt11/
// 11-payment-encoding.md, CC-BY-4.0, see that directory's PROVENANCE.md).
//
// This is a JavaScript port of the JVM test program's
// nenya-demo/app/src/main/kotlin/dev/eryalabs/nenya/demo/app/bill/Bolt11Derivation.kt and
// VendoredBolt11.kt. It takes one example apart, changes the amount, the payment hash, the
// timestamp and the expiry, and puts it back together with the bech32 checksum recomputed. No
// invoice is typed by hand. The signature is carried across unchanged and no longer commits to the
// contents; nothing in Nenya or in this page verifies an invoice signature (the evidence of payment
// is the preimage, never the invoice signature).
//
// What stops this inventing its own dialect: selfCheck() requires compose(decompose(x)) === x,
// character for character, for every all-lowercase valid example in the document. The checksum is
// recomputed, never copied, so a match means the alphabet, the checksum constant, the split point
// and the bit order are right. The library's own reader (Bolt11Invoice.parse, reached through
// buildPaymentRequest and the payment-request door) is what then reads every bill.
//
// No DOM, no Node API: plain ES module.

const ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l" // BIP-173's bech32 character set
const TIMESTAMP_GROUPS = 7
const SIGNATURE_GROUPS = 104
const CHECKSUM_GROUPS = 6
export const HASH_GROUPS = 52
const SEPARATOR = "1"
const CHECKSUM_CONSTANT = 1 // BIP-173 (bech32), not bech32m: BOLT-11 never moved
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
const AMOUNT = /^[0-9]+[munp]?$/

// Appendix C's multiplier table, as millisatoshis per unit (numerator / denominator), coarsest first.
// Same rows as nenya-core's Bolt11Multiplier.
const MULTIPLIERS = [
  {letter: "", num: 100_000_000_000n, den: 1n}, // whole bitcoin
  {letter: "m", num: 100_000_000n, den: 1n},
  {letter: "u", num: 100_000n, den: 1n},
  {letter: "n", num: 100n, den: 1n},
  {letter: "p", num: 1n, den: 10n},
]

function groupsOf(characters) {
  return [...characters].map(c => {
    const g = ALPHABET.indexOf(c)
    if (g < 0) throw new Error(`'${c}' is not a bech32 character`)
    return g
  })
}

function charactersOf(groups) {
  return groups
    .map(g => {
      if (!(g >= 0 && g <= 31)) throw new Error(`a bech32 group is five bits; found ${g}`)
      return ALPHABET[g]
    })
    .join("")
}

function polymod(values) {
  let checksum = 1
  for (const value of values) {
    const top = checksum >>> 25
    checksum = ((checksum & 0x1ffffff) << 5) ^ value
    for (let bit = 0; bit < 5; bit++) if ((top >>> bit) & 1) checksum ^= GENERATOR[bit]
  }
  return checksum >>> 0
}

function checksum(hrp, dataGroups) {
  const values = []
  for (const ch of hrp) values.push(ch.charCodeAt(0) >> 5)
  values.push(0)
  for (const ch of hrp) values.push(ch.charCodeAt(0) & 31)
  values.push(...dataGroups)
  for (let i = 0; i < CHECKSUM_GROUPS; i++) values.push(0)
  const pm = polymod(values) ^ CHECKSUM_CONSTANT
  let out = ""
  for (let i = 0; i < CHECKSUM_GROUPS; i++)
    out += ALPHABET[(pm >>> (5 * (CHECKSUM_GROUPS - 1 - i))) & 31]
  return out
}

function groupsOfBytes(bytes) {
  const out = []
  let acc = 0
  let bits = 0
  for (const byte of bytes) {
    acc = ((acc << 8) | byte) & 0xffff
    bits += 8
    while (bits >= 5) {
      bits -= 5
      out.push((acc >> bits) & 31)
    }
  }
  if (bits > 0) out.push((acc << (5 - bits)) & 31)
  return out
}

function bytesOf(groups) {
  const out = []
  let acc = 0
  let bits = 0
  for (const g of groups) {
    acc = ((acc << 5) | g) & 0xffff
    bits += 5
    while (bits >= 8) {
      bits -= 8
      out.push((acc >> bits) & 0xff)
    }
  }
  return Uint8Array.from(out)
}

function groupsOfNumber(value, size) {
  if (!(size >= 1 && size <= 12)) throw new Error(`${size} groups is not a number this writes`)
  if (!(value >= 0 && value < 2 ** (5 * size)))
    throw new Error(`${value} does not fit in ${size} groups`)
  const out = []
  for (let i = 0; i < size; i++) out.push(Math.floor(value / 2 ** (5 * (size - 1 - i))) % 32)
  return out
}

function smallestGroupsOfNumber(value) {
  let size = 1
  while (size < 12 && value >= 2 ** (5 * size)) size++
  return groupsOfNumber(value, size)
}

/** An invoice taken apart at its LAST separator: hrp, 7 timestamp groups, tagged fields, signature. */
export function decompose(invoice) {
  const at = invoice.lastIndexOf(SEPARATOR)
  if (at < 0) throw new Error("no separator in the invoice")
  const hrp = invoice.slice(0, at)
  const data = invoice.slice(at + 1)
  const floor = TIMESTAMP_GROUPS + SIGNATURE_GROUPS + CHECKSUM_GROUPS
  if (data.length < floor) throw new Error(`a data part cannot be shorter than ${floor} characters`)
  const body = groupsOf(data.slice(0, data.length - CHECKSUM_GROUPS))
  const timestamp = body.slice(0, TIMESTAMP_GROUPS)
  const signature = body.slice(body.length - SIGNATURE_GROUPS)
  const middle = body.slice(TIMESTAMP_GROUPS, body.length - SIGNATURE_GROUPS)
  const fields = []
  let i = 0
  while (i < middle.length) {
    if (i + 3 > middle.length) throw new Error("a tagged field is cut short")
    const type = ALPHABET[middle[i]]
    const length = middle[i + 1] * 32 + middle[i + 2]
    if (i + 3 + length > middle.length)
      throw new Error(`tagged field '${type}' runs past the signature`)
    fields.push({type, groups: middle.slice(i + 3, i + 3 + length)})
    i += 3 + length
  }
  return {hrp, timestamp, fields, signature, checksum: data.slice(data.length - CHECKSUM_GROUPS)}
}

/** Parts back into an invoice string, with the checksum RECOMPUTED (never the one decompose read). */
export function compose(parts) {
  const groups = [...parts.timestamp]
  for (const field of parts.fields) {
    const length = field.groups.length
    if (length >= 1024) throw new Error("a field length is ten bits")
    groups.push(ALPHABET.indexOf(field.type), Math.floor(length / 32), length % 32, ...field.groups)
  }
  groups.push(...parts.signature)
  return parts.hrp + SEPARATOR + charactersOf(groups) + checksum(parts.hrp, groups)
}

function networkPrefix(hrp) {
  const at = hrp.search(/[0-9]/)
  return at < 0 ? hrp : hrp.slice(0, at)
}

function fieldsOf(parts, type) {
  return parts.fields.filter(f => f.type === type)
}

/** The bill rules nenya's own reader applies: mainnet, one payment hash, a secret, one description. */
function usable(parts) {
  if (networkPrefix(parts.hrp) !== "lnbc") return false
  if (fieldsOf(parts, "p").filter(f => f.groups.length === HASH_GROUPS).length !== 1) return false
  if (!fieldsOf(parts, "s").some(f => f.groups.length === HASH_GROUPS)) return false
  const descriptions =
    fieldsOf(parts, "d").length +
    fieldsOf(parts, "h").filter(f => f.groups.length === HASH_GROUPS).length
  return descriptions === 1
}

/** Millisatoshis written the way Appendix C writes an amount: coarsest unit that divides exactly. */
export function writtenAmount(msat) {
  const value = BigInt(msat)
  if (value <= 0n) throw new Error("BOLT-11 writes no amount of zero or less")
  for (const row of MULTIPLIERS) {
    const scaled = value * row.den
    if (scaled % row.num !== 0n) continue
    return `${scaled / row.num}${row.letter}`
  }
  throw new Error(`${msat} msat is not a whole number of units under Appendix C's table`)
}

function withAmount(parts, written) {
  if (!(written === "" || AMOUNT.test(written)))
    throw new Error(`'${written}' is not an Appendix C amount`)
  return {...parts, hrp: networkPrefix(parts.hrp) + written}
}

function withTimestamp(parts, seconds) {
  return {...parts, timestamp: groupsOfNumber(seconds, TIMESTAMP_GROUPS)}
}

function withPaymentHash(parts, hash) {
  if (hash.length !== 32) throw new Error("a payment hash is 32 bytes")
  const groups = groupsOfBytes(hash)
  const at = parts.fields.findIndex(f => f.type === "p")
  if (at < 0) throw new Error("no tagged field 'p' to replace")
  const fields = parts.fields.slice()
  fields[at] = {type: "p", groups}
  return {...parts, fields}
}

function withExpiry(parts, seconds) {
  return {
    ...parts,
    fields: [
      ...parts.fields.filter(f => f.type !== "x"),
      {type: "x", groups: smallestGroupsOfNumber(seconds)},
    ],
  }
}

/** The valid examples of the vendored document, in document order: { heading, invoice }. */
export function validExamples(text) {
  const lines = text.split("\n").map(l => l.replace(/\r$/, ""))
  const start = title => {
    const found = lines.flatMap((l, i) => (l === title ? [i] : []))
    if (found.length !== 1)
      throw new Error(`expected exactly one '${title}' line, found ${found.length}`)
    return found[0]
  }
  const from = start("# Examples")
  const until = start("# Examples of Invalid Invoices")
  if (!(from < until && until < start("# Authors")))
    throw new Error("the example sections are out of order")
  const HEADING = /^> #{1,3} (.+)$/
  const BARE_QUOTE = /^> ?$/
  const INVOICE = /^(> )?([0-9A-Za-z]+)$/
  const headings = []
  for (let i = from + 1; i < until; i++) if (HEADING.test(lines[i])) headings.push(i)
  if (headings.length !== 16)
    throw new Error(`expected 16 valid examples, found ${headings.length}`)
  return headings.map((at, n) => {
    const next = n + 1 < headings.length ? headings[n + 1] : until
    const heading = HEADING.exec(lines[at])[1]
    let i = at + 1
    while (i < next && (lines[i] === "" || BARE_QUOTE.test(lines[i]))) i++
    const match = i < next ? INVOICE.exec(lines[i]) : null
    if (!match) throw new Error(`heading '${heading}' is not followed by an invoice line`)
    return {heading, invoice: match[2]}
  })
}

/**
 * The bill writer, built from the vendored document's text. The base is the first valid example
 * that can carry a bill under the rules above, chosen by rule rather than by number.
 */
export function billWriter(documentText, expirySeconds = 86_400) {
  const examples = validExamples(documentText)
  const chosen = examples.find(e => {
    try {
      return usable(decompose(e.invoice))
    } catch {
      return false
    }
  })
  if (!chosen) throw new Error("no vendored BOLT-11 example can carry a bill")
  const base = decompose(chosen.invoice)
  return {
    /** The opening words of the example every bill is derived from. */
    baseHeading: chosen.heading.split(" ").filter(Boolean).slice(0, 8).join(" "),
    /** compose(decompose(x)) === x over every all-lowercase valid example: { passed, total }. */
    selfCheck() {
      const lower = examples.filter(e => e.invoice === e.invoice.toLowerCase())
      const passed = lower.filter(e => compose(decompose(e.invoice)) === e.invoice).length
      return {passed, total: lower.length}
    },
    /** One bill: amountMsat (bigint or decimal string) against a 32-byte payment hash. */
    write(amountMsat, paymentHash, timestampSeconds) {
      let parts = withAmount(base, writtenAmount(amountMsat))
      parts = withTimestamp(parts, timestampSeconds)
      parts = withPaymentHash(parts, paymentHash)
      parts = withExpiry(parts, expirySeconds)
      return compose(parts)
    },
    /** The payment hash a bill carries, read back by this port (for display; Nenya reads its own). */
    paymentHashOf(invoice) {
      const p = fieldsOf(decompose(invoice), "p").find(f => f.groups.length === HASH_GROUPS)
      return p ? bytesOf(p.groups).slice(0, 32) : null
    },
  }
}
