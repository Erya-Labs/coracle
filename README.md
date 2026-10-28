# Nenya marketplace fork

This fork adds an opt-in **Market** section to Coracle, built on the
[nenya](https://github.com/Erya-Labs/nenya) marketplace library: offers and requests, bids,
and a private order flow — a sealed order channel, Lightning settlement, and a delivery the
buyer's client verifies before it will decrypt. How a trade works, with pictures:
[nenya's README](https://github.com/Erya-Labs/nenya#readme).

Try it:

1. `pnpm install && pnpm run dev`
2. Open the printed address → **Log In → Use Browser Extension**, then skip the profile
   search. A dev signer is wired in; if you run a real signer extension (nos2x, Alby, …),
   disable it for this site first — the two fight over `window.nostr`.
3. **Settings → Enable the marketplace** → Save. A Market item appears in the menu. While
   the setting is off, the app fetches no marketplace data at all.
4. Browse, post a listing, or run a full two-person trade:
   [MARKETPLACE.md](./MARKETPLACE.md).

The marketplace code is deliberately small and reviewable: [src/domain/market.ts](src/domain/market.ts)
(listings and bids), [src/domain/marketOrder.ts](src/domain/marketOrder.ts) (the order
channel — the only file that talks to nenya's private flow), the `Market*` views in
[src/app/views](src/app/views), and the vendored library in [vendor/nenya](vendor/nenya).

Everything below this line is Coracle's own README.

---

# What is this?

Coracle is a web client for the Nostr protocol focused on pushing the boundaries of what's unique about nostr, including relay selection and management, web-of-trust based moderation and content recommendations, and privacy protection. Check it out at [coracle.social](https://coracle.social).

If you like Coracle and want to support its development, you can donate sats via [Geyser](https://geyser.fund/project/coracle).

# Features

- [x] Threads/social
- [x] Profile search using NIP-50
- [x] Login via extension, nsecbunker, and pubkey
- [x] Profile sharing via QR codes
- [x] NIP 05 verification
- [x] NIP 65 relay selection and NIP 32 relay reviews
- [x] NIP 89 app recommendations
- [x] NIP 32 labeling and recommendations
- [x] NIP 99 classifieds
- [x] NIP 52 calendar events
- [x] NIP 87 closed groups
- [x] NIP 72 communities
- [x] NIP 89 client tag support
- [x] NIP 89 handler integration
- [x] NIP 32 labeling and collections
- [x] NIP 17 DMs
- [x] Private group calendars and listings
- [x] Cross-posting between communities and main feed
- [x] Bech32 entity search and scan
- [x] Mention, reply, and reaction notifications
- [x] Direct messages - NIP 04 and NIP 24
- [x] Note composition with mentions and topics
- [x] Content warnings, mute, and keyword mute
- [x] Profile pages, follow/unfollow, follow/follower count
- [x] Thread muting, collapse thread
- [x] Invoice, quote, mention, link, image, and video rendering
- [x] Installable as a progressive web app
- [x] Integrated media uploads via NIP 96
- [x] Lightning zaps and reactions
- [x] Feeds customizable by person, relay, and topic using NIP-51
- [x] AUTH (NIP-42) support for closed relays
- [x] Multiplextr support for reducing bandwidth
- [x] Profile and note metadata
- [x] White-labeling support
- [x] NIP 51 person lists
- [x] Exports/imports of user events
- [x] User profile editing
- [x] NIP XX encrypted read receipts for notifications
- [x] Topic and relay feeds
- [x] Onboarding workflow
- [x] Multi-account support
- [x] Notifications view
- [x] Web of trust scores for less spam and better group/feed suggestions
- [x] Customizable and shareable feeds and lists
- [x] Customizable invite links
- [x] Reporting via tagr-bot
- [x] Nostr Wallet Connect support
- [x] Date/time localization

You can find a more complete changelog [here](./CHANGELOG.md).

# Run Coracle locally:

- Clone the project repository: `git clone https://github.com/coracle-social/coracle.git`
- Navigate to the project directory: `cd coracle`
- Install dependencies: `pnpm i`
- Customize configuration in `.env` (optional, see below)
- Start the development server: `pnpm run dev`
- In order for `pnpm run build` to work, you'll need to run `pnpm i sharp --include=optional` first.

# Tests

- Run all tests: `pnpm run test`

# Building for Android

Make sure you have the android build tools in your path and run:

```
pnpm run build:android --keystorepath <path> --keystorepass <password> --keystorealias <alias> --keystorealiaspass <password>
```

# Customization

Coracle is intended to be fully white-labeled by groups of various kinds. The following environment variables can be set in `.env.local` to customize Coracle's appearance and behavior:

- `VITE_DARK_THEME` and `VITE_LIGHT_THEME` are comma-separate lists of key/value pairs defining theme colors.
- `VITE_DVM_RELAYS` is a comma-separated list of relays to use when making requests against DVMs.
- `VITE_SEARCH_RELAYS` is a comma-separated list of relays to use when using NIP 50 search.
- `VITE_DEFAULT_RELAYS` is a comma-separated list of relays to use as defaults/fallbacks.
- `VITE_DEFAULT_FOLLOWS` is a comma-separated list of hex pubkeys to fetch content from when the user isn't following anyone.
- `VITE_ONBOARDING_LISTS` is a comma-separated list of `kind:30003` person lists to populate onboarding with.
- `VITE_NIP96_URLS` is a comma-separated list of default upload providers.
- `VITE_DUFFLEPUD_URL` is a [Dufflepud](https://github.com/coracle-social/dufflepud) instance url, which helps Coracle with things like link previews and image uploads.
- `VITE_PLATFORM_ZAP_SPLIT` is a decimal between 0 and 1 defining the default zap split percent.
- `VITE_PLATFORM_PUBKEY` is the pubkey of the platform owner. This gets zapped when using the platform zap split.
- `VITE_ENABLE_ZAPS` can be set to `false` to disable zaps.
- `VITE_APP_NAME` is the app's name.
- `VITE_APP_URL` is the app's url. Used to generate open graph meta tags.
- `VITE_APP_LOGO` is the path for the app's logo relative to the `public` directory, starting with a leading slash. Used to generate favicons and manifest.
- `VITE_APP_WORDMARK_DARK` and `VITE_APP_WORDMARK_LIGHT` are paths for the app's wordmark relative to the `public` directory, starting with a leading slash.
- `VITE_APP_DESCRIPTION` is the app's description.
- `VITE_CLIENT_NAME` is the client's name. Only change this if you have forked Coracle.
- `VITE_CLIENT_ID` is the client's NIP 89 handler id. Only change this if you have forked Coracle.
- `VITE_BUILD_HASH` can be set during build to indicate the software version on the about page.
- `VITE_LOG_LEVEL` can be set to `info`, `warn`, or `error`. This controls how much shows up in the console.
- `VITE_ENABLE_MARKET` can be set to `false` to disable the marketplace tab.

See `.env` for default values.
