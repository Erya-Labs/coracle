// Dev-only test signer, injected by the vite dev server and never part of a build:
// provides a NIP-07 window.nostr backed by a throwaway key kept in localStorage, so
// the marketplace's order channel (which needs synchronous signing and nip44) can
// run locally. Treat the key as hot and disposable; never fund it or reuse it.
import {finalizeEvent, generateSecretKey, getPublicKey} from "/@id/nostr-tools"
import * as nip44 from "/@id/nostr-tools/nip44"
import * as nip04 from "/@id/nostr-tools/nip04"

let skHex = localStorage.getItem("e2e-test-sk")

if (!skHex) {
  skHex = Array.from(generateSecretKey())
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
  localStorage.setItem("e2e-test-sk", skHex)
}

const sk = Uint8Array.from(skHex.match(/../g).map(h => parseInt(h, 16)))

window.nostr = {
  getPublicKey: async () => getPublicKey(sk),
  signEvent: async e => finalizeEvent(e, sk),
  nip44: {
    encrypt: async (pk, plaintext) => nip44.encrypt(plaintext, nip44.getConversationKey(sk, pk)),
    decrypt: async (pk, payload) => nip44.decrypt(payload, nip44.getConversationKey(sk, pk)),
  },
  nip04: {
    encrypt: async (pk, plaintext) => nip04.encrypt(sk, pk, plaintext),
    decrypt: async (pk, payload) => nip04.decrypt(sk, pk, payload),
  },
}

// The nenya order channel needs synchronous signing and nip44, which a real NIP-07
// extension cannot provide; the dev key is exposed so the market views can build a
// synchronous signer. Dev only — this file is never committed.
window.__e2eSecretKeyHex = skHex

console.log("[e2e-signer] ready, pubkey", getPublicKey(sk))
