# Running a real trade

This fork adds a [nenya](https://github.com/Erya-Labs/nenya) marketplace to Coracle: listings,
bids, and a full private order flow — bills, payment proofs, and a delivery the buyer's app
verifies before it will decrypt. This guide sets up a **real trade between two people**: real
keys, real relays, a real Lightning payment, a real file.

Read the honesty box first.

> **What is real and what is not.**
> Everything cryptographic is real: the sealed order channel, the fingerprint commitment, the
> payment-proof check, the verified delivery. Two notes:
> **(1) The signer.** A real NIP-07 signer extension drives the whole trade, as long as it
> supports nip44 encryption (recent nos2x, Alby): the library's async entry points sign and
> decrypt through `window.nostr`, so the extension will prompt — grant it lasting permission
> or the order polling gets noisy. The dev server (`pnpm run dev`) instead injects a
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
   while it is off the app fetches no marketplace data.

4. Pick relays. By default `.env.template` points at public relays; both people must share at
   least one **write-enabled relay that accepts kinds 1059, 30402, 30404, 1111 and 9876**
   (Relays → Add Relay). For a private trade, run your own —
   [`nak serve`](https://github.com/fiatjaf/nak) gives you one in one command — and have both
   sides join it. The encrypted file also travels as a relay event, so keep the deliverable
   under your relay's event size limit (roughly 100 KB on most public relays).

## The trade

**Seller:** Market → **+ Listing** → _Offer_ → describe the work and price it in sats → publish.

**Buyer:** open the offer → **Order this**. Both sides now work from **Market → Orders**; each
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

Every line in the order log that says **NENYA** is a check made by the library; the app never
judges anything itself. If a step is refused, the log quotes the library's reason.

## If something goes wrong

- A refused bill, proof, or delivery is not a bug — it is the library catching a mismatch.
  Read the quoted reason.
- Settings or messages reset after a reload → a signer extension is fighting the dev signer
  over `window.nostr`. Disable the extension for this site and log in again.
- Both sides hold signed, timestamped evidence of every step (the proposal, the acceptance,
  the commitment, the proof). A trade that stops leaves no ambiguity about who stopped it.
- Nenya never holds funds and there is no operator: a Lightning payment, once made, is final.
  Trade small amounts with people you have some reason to trust, and treat disputes as a
  reputational matter — the evidence is built for exactly that.
