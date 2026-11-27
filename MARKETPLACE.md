# Running a real trade

This fork adds a [nenya](https://github.com/Erya-Labs/nenya) marketplace to Coracle: listings,
bids, and a full private order flow — bills, payment proofs, and a delivery the buyer's app
verifies before it will decrypt. This guide sets up a **real trade between two people**: real
keys, real relays, a real Lightning payment, a real file.

Read the honesty box first.

> **What is real and what is not.**
> Everything cryptographic is real: the sealed order channel, the fingerprint commitment, the
> payment-proof check, the verified delivery. Two notes:
> **(1) The signer.** Any login whose signer supports nip44 drives the whole trade — an
> extension, a signer app or a key: the library's async entry points sign and decrypt
> through it, so an extension or signer app will prompt — grant it lasting permission or the
> order polling gets noisy. The dev server (`pnpm run dev`) instead injects a
> throwaway-key test signer so one person can rehearse both sides in two browser windows;
> that key is a real nostr key, but treat it as hot and disposable.
> **(2) The default bill is pretend.** If the seller doesn't paste a real invoice, the app
> writes a valid-format Lightning bill nobody can actually pay, and "paying" it is simulated.
> For a real trade, use the real-invoice path below — then the money is real and so is the proof.

## Setup (both people)

1. Clone this fork, then:

   ```
   pnpm install
   pnpm run dev
   ```

2. Open the printed address. The dev signer is already wired in; click **Log In →
   Use Browser Extension**, then **skip** the profile search (the key is new).

   If a real signer extension (nos2x, Alby, …) is installed, disable it for this site
   first. Both it and the dev signer claim `window.nostr`, and whatever one key encrypts
   the other cannot read — which shows up as settings and messages silently resetting.

3. Turn the marketplace on: **Settings → Enable the marketplace**. It is off by default, and
   while it is off the app fetches no marketplace data. A build can turn it on by default with
   `VITE_ENABLE_MARKET=true` in `.env`.

4. Pick relays. By default `.env.template` points at public relays; both people must share at
   least one **write-enabled relay that accepts kinds 1059, 30402, 30404, 1111 and 9876**
   (Relays → Add Relay). For a private trade, run your own —
   [`nak serve`](https://github.com/fiatjaf/nak) gives you one in one command — and have both
   sides join it. The encrypted file also travels as a relay event, so the deliverable can be
   at most 40 KB; the app refuses a bigger file, and refuses to commit to a file no relay kept.

## The trade

**Seller:** Market → **Create** → _Offer_ → describe the work and price it in sats → publish.

**Buyer:** open the offer → **Order this**. Both sides now work from **Market → My Orders**; each
window refreshes itself every few seconds.

1. **Seller — Accept the order.** The acceptance repeats every term; the buyer's app verifies
   that, not the buyer.
2. **Seller — Lock, upload and commit.** Pick the finished file. It is encrypted in your
   browser, uploaded as ciphertext, and its fingerprints are sent to the buyer. From this
   moment the file cannot be swapped.
3. **Seller — the bill.** In your own Lightning wallet, create an invoice for **exactly** the
   listed price (the library refuses any other amount), paste it into the invoice field, and
   send. Leave the field empty only if you want a pretend run.
4. **Buyer — pay and prove.** Pay the invoice in your wallet, copy the **payment preimage**
   (wallets show it on the payment detail screen, sometimes as "secret" or "proof of payment"),
   paste it, and send. The seller's app checks it against the bill's payment hash — a wrong
   secret is refused.
5. **Seller — Release the key.** Enabled once the payment proof verified.
6. **Buyer — nothing.** Your app downloads the ciphertext, checks its fingerprint against the
   commitment **before decrypting**, decrypts, checks the content fingerprint too, and only
   then shows the file. The order ends **SETTLED**.

Every step marked **Nenya** in an order's details is a check made by the library; the app never
judges anything itself. [Order steps and codes](#order-steps-and-codes) explains each step and
each problem code.

## Finding listings and orders

- **Market** shows open listings only. Search matches every word typed against a listing's
  title, summary, description and topics. **Sort by date** shows the newest first, **Sort by
  price** the cheapest first, and **Reverse order** flips either.
- **My Orders** has a search box (listing title, order number, state, role or amount) and
  filters: **All**, **Open**, **Closed**, **Updates**, and one filter for each order state that
  has orders. **Closed** covers settled, cancelled, expired and disputed orders, and a seller's
  orders once the key is released.
- **Updates** lists the orders that a message from the other person changed since their details
  were last opened. Opening an order's details, or **Mark all as seen**, clears its update. The
  app looks for messages only while **My Orders** is open; it sends no phone notifications.

## Deleting a listing

The author of a listing can delete it from the listing's page with **Delete**. The app publishes
the listing again marked `sold` (an offer) or `cancelled` (a request), then a NIP-09 deletion
request naming its coordinate, as NENYA-1 §5.6 requires. The market hides closed and deleted
listings. A deletion request is advisory: relays may keep a copy, and a client that already
fetched the listing may still show it. Orders already started from the listing stay in My
Orders, but an order not yet accepted can no longer be accepted.

## Order steps and codes

Each order card on the **My Orders** screen lists the steps of its handshake under **Show details**.
A step that passed shows its name. A step that failed shows a three-digit code instead, followed by
the Nenya library's reason when there is one. The same guide is in the app under **My Orders → Step
guide**.

**Nenya** marks a check made by the Nenya library; **App** marks something this app did. Hovering
over a line in a desktop browser shows its full account.

### Steps

| Step       | By    | Meaning                                                                                                                                                    |
| ---------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPEN`     | Nenya | The buyer's order was read and checked, and the order was opened at the agreed price.                                                                      |
| `ACCEPT`   | Nenya | The seller accepted the order. The acceptance repeats every term of the order exactly.                                                                     |
| `STRIP`    | App   | Before locking a JPEG or PNG picture, the seller's app removed details such as place, time and camera. Other pictures, video and audio are sent unchanged. |
| `COMMIT`   | Nenya | The seller locked the file, uploaded it and sent its fingerprints. From this point the file cannot be swapped.                                             |
| `BILL`     | Nenya | The seller's Lightning bill was checked against the agreed price and stored. Only this bill can settle the order.                                          |
| `BILLS`    | Nenya | Every bill the order needs has arrived. The order now waits for payment.                                                                                   |
| `VOUCHER`  | App   | A practice payment arrived. No money moved.                                                                                                                |
| `PROOF`    | Nenya | The buyer's payment secret (the preimage) matches the bill. This proves the bill was paid.                                                                 |
| `PAID`     | Nenya | Every needed payment is proven. The order is paid.                                                                                                         |
| `KEY`      | Nenya | The seller released the key that unlocks the file, and it matches the commitment.                                                                          |
| `HOST`     | App   | The file is on a file host this app does not use by default. Downloading it shows that host your internet address, so the app asks first.                  |
| `DOWNLOAD` | App   | The locked file was downloaded.                                                                                                                            |
| `CHECK`    | Nenya | The downloaded file matches the fingerprint the seller committed to. Only then is it unlocked.                                                             |
| `DELIVER`  | Nenya | The unlocked file matches what the seller committed to. The order is complete.                                                                             |
| `STATUS`   | Nenya | Another status message arrived, such as a cancellation.                                                                                                    |

### Problem codes

Codes are grouped like HTTP status codes: the first digit names the stage.

| Codes | Stage                |
| ----- | -------------------- |
| 1xx   | Order and acceptance |
| 2xx   | Commitment           |
| 3xx   | Bill                 |
| 4xx   | Payment              |
| 5xx   | Key                  |
| 6xx   | Delivery             |
| 9xx   | Waiting              |

| Code  | Name               | What happened                                                                                                                           | What to do                                                                                                                                                                             |
| ----- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `101` | Order refused      | The buyer's order could not be opened, for example because it does not match the listing.                                               | The buyer orders again from the listing.                                                                                                                                               |
| `102` | Acceptance refused | The seller's acceptance was refused: it changed a term of the order, or it came after the order's deadline. The reason code says which. | The buyer cancels the order and orders again.                                                                                                                                          |
| `103` | Status ignored     | A status message cannot move the order by itself; only the matching step can. The order is unchanged.                                   | Nothing to do.                                                                                                                                                                         |
| `201` | Commitment refused | The seller's commitment does not match the order.                                                                                       | Take a screenshot and contact the other person.                                                                                                                                        |
| `301` | Bill refused       | The seller's bill does not meet the agreed terms. The reason code says why.                                                             | If the seller's order still shows the bill form, the seller sends a new bill for exactly the price, with the amount filled in. Otherwise the buyer cancels the order and orders again. |
| `302` | Bills incomplete   | The order could not move on to payment with the bills it has.                                                                           | Take a screenshot and contact the other person.                                                                                                                                        |
| `303` | Fee bill refused   | The fee bill does not meet the agreed fee. The reason code says why.                                                                    | Take a screenshot and contact the other person.                                                                                                                                        |
| `401` | Proof refused      | The payment secret does not prove that the bill was paid.                                                                               | The buyer copies the preimage again from the wallet's payment details and sends it. The payment hash is not the preimage.                                                              |
| `402` | Fee proof refused  | The payment secret does not prove that the fee bill was paid.                                                                           | The buyer copies the fee payment's preimage again and sends it.                                                                                                                        |
| `403` | Payment incomplete | The order could not be marked paid with the proofs it has.                                                                              | Take a screenshot and contact the other person.                                                                                                                                        |
| `501` | Key refused        | The seller's key message was refused, or it does not match the commitment. When it does not match, the order moves to DISPUTED.         | Take a screenshot and contact the other person.                                                                                                                                        |
| `601` | Download failed    | The locked file could not be downloaded from the file host. After five failures the app stops trying until the page is reloaded.        | Check the internet connection, then reload the page. If it still fails, the file host may be down.                                                                                     |
| `602` | File mismatch      | The downloaded file does not match the committed fingerprint. It was not unlocked, and the order moves to DISPUTED.                     | Take a screenshot and contact the other person.                                                                                                                                        |
| `603` | Unlock failed      | The released key did not unlock the file. The order moves to DISPUTED.                                                                  | Take a screenshot and contact the other person.                                                                                                                                        |
| `604` | Delivery refused   | The unlocked file does not match what the seller committed to. The order can move to DISPUTED.                                          | Take a screenshot and contact the other person.                                                                                                                                        |
| `900` | On hold            | A message arrived before the order was ready for it. It is kept and tried again each time the order moves on, up to two more times.     | Nothing to do. If the order does not move on, take a screenshot and contact the other person.                                                                                          |

### Reason codes

A code in capitals after a problem code is the Nenya library's own reason. The most common ones are
below; the full set is defined in the [Nenya library](https://github.com/Erya-Labs/Nenya).

| Reason                              | Meaning                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `INVOICE_AMOUNT_MISMATCH`           | The bill is not for exactly the agreed price.                                  |
| `INVOICE_AMOUNT_MISSING`            | The bill has no amount. Make one with the amount filled in.                    |
| `INVOICE_EXPIRED`                   | The bill had expired when it was checked.                                      |
| `INVOICE_STATIC_ADDRESS`            | A Lightning address was sent instead of a one-time invoice.                    |
| `REQUEST_ALREADY_STORED`            | This order already has a bill. The first bill still stands; pay that one.      |
| `PREIMAGE_MISMATCH`                 | The secret does not match the bill. Often the payment hash was pasted instead. |
| `PREIMAGE_MALFORMED`                | The secret is not 64 lowercase hexadecimal characters.                         |
| `ACCEPTANCE_DEADLINE_PASSED`        | The seller accepted after the order's deadline.                                |
| `RELEASE_DOES_NOT_MATCH_COMMITMENT` | The key message does not match the file the seller committed to.               |
| `WRONG_STATE_FOR_EVENT`             | The message came before the order was ready for it.                            |

## If something goes wrong

- A refused bill, proof, or delivery is not a bug — it is the library catching a mismatch.
  Look up its code and reason in [Order steps and codes](#order-steps-and-codes).
- A buyer can end an order with **Cancel the order**
  until they press **Send the payment proof**, even if that proof is then refused. A
  cancellation does not get back a payment already made.
- Settings or messages reset after a reload → a signer extension is fighting the dev signer
  over `window.nostr`. Disable the extension for this site and log in again.
- Both sides hold signed, timestamped evidence of every step (the proposal, the acceptance,
  the commitment, the proof). A trade that stops leaves no ambiguity about who stopped it.
- Nenya never holds funds and there is no operator: a Lightning payment, once made, is final.
  Trade small amounts with people you have some reason to trust, and treat disputes as a
  reputational matter — the evidence is built for exactly that.
