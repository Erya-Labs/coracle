// Names and codes for the steps of an order's handshake.
//
// Each step has a one-word name. Each way a step can fail has a three-digit code, grouped like
// HTTP status codes: the first digit names the stage. The My Orders screen shows only the name or
// code and a few words. The step guide in the app (MarketSteps.svelte) and MARKETPLACE.md
// explain each one, and a unit test keeps MARKETPLACE.md in step with this file.

export type StepName =
  | "OPEN"
  | "ACCEPT"
  | "STATUS"
  | "STRIP"
  | "COMMIT"
  | "BILL"
  | "BILLS"
  | "VOUCHER"
  | "PROOF"
  | "PAID"
  | "KEY"
  | "HOST"
  | "DOWNLOAD"
  | "CHECK"
  | "UNLOCK"
  | "DELIVER"
  | "WAIT"

export type Step = {name: StepName; by: "Nenya" | "App"; about: string}

export type Fault = {code: number; step: StepName; title: string; about: string; next: string}

export type Stage = {codes: string; stage: string}

export type Reason = {reason: string; about: string}

// The words a line shows: a step name, or a code when the step failed.
export type Shown = {name: StepName; short: string; code?: number; reason?: string}

export const STEPS: Step[] = [
  {
    name: "OPEN",
    by: "Nenya",
    about: "The buyer's order was read and checked, and the order was opened at the agreed price.",
  },
  {
    name: "ACCEPT",
    by: "Nenya",
    about: "The seller accepted the order. The acceptance repeats every term of the order exactly.",
  },
  {
    name: "STRIP",
    by: "App",
    about:
      "Before locking a JPEG or PNG picture, the seller's app removed details such as place, time and camera. Other pictures, video and audio are sent unchanged.",
  },
  {
    name: "COMMIT",
    by: "Nenya",
    about:
      "The seller locked the file, uploaded it and sent its fingerprints. From this point the file cannot be swapped.",
  },
  {
    name: "BILL",
    by: "Nenya",
    about:
      "The seller's Lightning bill was checked against the agreed price and stored. Only this bill can settle the order.",
  },
  {
    name: "BILLS",
    by: "Nenya",
    about: "Every bill the order needs has arrived. The order now waits for payment.",
  },
  {
    name: "VOUCHER",
    by: "App",
    about: "A practice payment arrived. No money moved.",
  },
  {
    name: "PROOF",
    by: "Nenya",
    about:
      "The buyer's payment secret (the preimage) matches the bill. This proves the bill was paid.",
  },
  {
    name: "PAID",
    by: "Nenya",
    about: "Every needed payment is proven. The order is paid.",
  },
  {
    name: "KEY",
    by: "Nenya",
    about: "The seller released the key that unlocks the file, and it matches the commitment.",
  },
  {
    name: "HOST",
    by: "App",
    about:
      "The file is on a file host this app does not use by default. Downloading it shows that host your internet address, so the app asks first.",
  },
  {
    name: "DOWNLOAD",
    by: "App",
    about: "The locked file was downloaded.",
  },
  {
    name: "CHECK",
    by: "Nenya",
    about:
      "The downloaded file matches the fingerprint the seller committed to. Only then is it unlocked.",
  },
  {
    name: "DELIVER",
    by: "Nenya",
    about: "The unlocked file matches what the seller committed to. The order is complete.",
  },
  {
    name: "STATUS",
    by: "Nenya",
    about: "Another status message arrived, such as a cancellation.",
  },
]

export const STAGES: Stage[] = [
  {codes: "1xx", stage: "Order and acceptance"},
  {codes: "2xx", stage: "Commitment"},
  {codes: "3xx", stage: "Bill"},
  {codes: "4xx", stage: "Payment"},
  {codes: "5xx", stage: "Key"},
  {codes: "6xx", stage: "Delivery"},
  {codes: "9xx", stage: "Waiting"},
]

const ASK = "Take a screenshot and contact the other person."

export const FAULTS: Fault[] = [
  {
    code: 101,
    step: "OPEN",
    title: "Order refused",
    about:
      "The buyer's order could not be opened, for example because it does not match the listing.",
    next: "The buyer orders again from the listing.",
  },
  {
    code: 102,
    step: "ACCEPT",
    title: "Acceptance refused",
    about:
      "The seller's acceptance was refused: it changed a term of the order, or it came after the order's deadline. The reason code says which.",
    next: "The buyer cancels the order and orders again.",
  },
  {
    code: 103,
    step: "STATUS",
    title: "Status ignored",
    about:
      "A status message cannot move the order by itself; only the matching step can. The order is unchanged.",
    next: "Nothing to do.",
  },
  {
    code: 201,
    step: "COMMIT",
    title: "Commitment refused",
    about: "The seller's commitment does not match the order.",
    next: ASK,
  },
  {
    code: 301,
    step: "BILL",
    title: "Bill refused",
    about: "The seller's bill does not meet the agreed terms. The reason code says why.",
    next: "If the seller's order still shows the bill form, the seller sends a new bill for exactly the price, with the amount filled in. Otherwise the buyer cancels the order and orders again.",
  },
  {
    code: 302,
    step: "BILLS",
    title: "Bills incomplete",
    about: "The order could not move on to payment with the bills it has.",
    next: ASK,
  },
  {
    code: 303,
    step: "BILL",
    title: "Fee bill refused",
    about: "The fee bill does not meet the agreed fee. The reason code says why.",
    next: ASK,
  },
  {
    code: 401,
    step: "PROOF",
    title: "Proof refused",
    about: "The payment secret does not prove that the bill was paid.",
    next: "The buyer copies the preimage again from the wallet's payment details and sends it. The payment hash is not the preimage.",
  },
  {
    code: 402,
    step: "PROOF",
    title: "Fee proof refused",
    about: "The payment secret does not prove that the fee bill was paid.",
    next: "The buyer copies the fee payment's preimage again and sends it.",
  },
  {
    code: 403,
    step: "PAID",
    title: "Payment incomplete",
    about: "The order could not be marked paid with the proofs it has.",
    next: ASK,
  },
  {
    code: 501,
    step: "KEY",
    title: "Key refused",
    about:
      "The seller's key message was refused, or it does not match the commitment. When it does not match, the order moves to DISPUTED.",
    next: ASK,
  },
  {
    code: 601,
    step: "DOWNLOAD",
    title: "Download failed",
    about:
      "The locked file could not be downloaded from the file host. After five failures the app stops trying until the page is reloaded.",
    next: "Check the internet connection, then reload the page. If it still fails, the file host may be down.",
  },
  {
    code: 602,
    step: "CHECK",
    title: "File mismatch",
    about:
      "The downloaded file does not match the committed fingerprint. It was not unlocked, and the order moves to DISPUTED.",
    next: ASK,
  },
  {
    code: 603,
    step: "UNLOCK",
    title: "Unlock failed",
    about: "The released key did not unlock the file. The order moves to DISPUTED.",
    next: ASK,
  },
  {
    code: 604,
    step: "DELIVER",
    title: "Delivery refused",
    about:
      "The unlocked file does not match what the seller committed to. The order can move to DISPUTED.",
    next: ASK,
  },
  {
    code: 900,
    step: "WAIT",
    title: "On hold",
    about:
      "A message arrived before the order was ready for it. It is kept and tried again each time the order moves on, up to two more times.",
    next: "Nothing to do. If the order does not move on, take a screenshot and contact the other person.",
  },
]

export const REASONS: Reason[] = [
  {
    reason: "INVOICE_AMOUNT_MISMATCH",
    about: "The bill is not for exactly the agreed price.",
  },
  {
    reason: "INVOICE_AMOUNT_MISSING",
    about: "The bill has no amount. Make one with the amount filled in.",
  },
  {
    reason: "INVOICE_EXPIRED",
    about: "The bill had expired when it was checked.",
  },
  {
    reason: "INVOICE_STATIC_ADDRESS",
    about: "A Lightning address was sent instead of a one-time invoice.",
  },
  {
    reason: "REQUEST_ALREADY_STORED",
    about: "This order already has a bill. The first bill still stands; pay that one.",
  },
  {
    reason: "PREIMAGE_MISMATCH",
    about: "The secret does not match the bill. Often the payment hash was pasted instead.",
  },
  {
    reason: "PREIMAGE_MALFORMED",
    about: "The secret is not 64 lowercase hexadecimal characters.",
  },
  {
    reason: "ACCEPTANCE_DEADLINE_PASSED",
    about: "The seller accepted after the order's deadline.",
  },
  {
    reason: "RELEASE_DOES_NOT_MATCH_COMMITMENT",
    about: "The key message does not match the file the seller committed to.",
  },
  {
    reason: "WRONG_STATE_FOR_EVENT",
    about: "The message came before the order was ready for it.",
  },
]

export const NENYA_REPOSITORY = "https://github.com/Erya-Labs/Nenya"

export const faultOf = (code: number) => FAULTS.find(f => f.code === code)

// A library reason is an upper-case code such as INVOICE_EXPIRED. Anything else is not shown.
export const reasonCode = (value: unknown) =>
  typeof value === "string" && /^[A-Z][A-Z0-9_]+$/.test(value) ? value : undefined

export const done = (name: StepName, short: string): Shown => ({name, short})

export const failed = (code: number, reason?: unknown): Shown => {
  const fault = faultOf(code)

  if (!fault) throw new Error(`unknown order step code ${code}`)

  return {name: fault.step, short: fault.title, code, reason: reasonCode(reason)}
}

export const sizeWords = (bytes: number) =>
  bytes < 1024
    ? `${bytes} bytes`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`
