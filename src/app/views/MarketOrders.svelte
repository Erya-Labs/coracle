<script lang="ts">
  import {onDestroy, onMount} from "svelte"
  import {Capacitor} from "@capacitor/core"
  import {Filesystem, Directory} from "@capacitor/filesystem"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import Card from "src/partials/Card.svelte"
  import Button from "src/partials/Button.svelte"
  import QRCode from "src/partials/QRCode.svelte"
  import {showInfo, showWarning} from "src/partials/Toast.svelte"
  import {msatToSats} from "src/domain"
  import {
    acceptOrder,
    allowFileHost,
    cancelOrder,
    commitFile,
    connectOrderChannel,
    MAX_FILE_MB,
    orderChannelCapable,
    orderThreads,
    payAndProve,
    processWraps,
    releaseKey,
    sendBill,
    verifyDelivery,
  } from "src/domain"
  import {env, myLoad, publishOrderEvent} from "src/engine"
  import {app, signer} from "src/engine/core"

  let timer
  let myPubkey = ""
  let ready = false
  const fileInputs = {}
  const verifying = new Set()

  const poll = async () => {
    const filters = [{kinds: [1059], "#p": [myPubkey]}]

    await myLoad({relays: env.DEFAULT_RELAYS, filters, skipCache: true}).catch(() => null)
    await processWraps(app.get().repository.query(filters))

    for (const thread of $orderThreads.values()) {
      if (
        roleIn(thread) === "buyer" &&
        thread.order?.state === "RELEASED" &&
        thread.release &&
        !thread.delivered &&
        !verifying.has(thread.orderId)
      ) {
        verifying.add(thread.orderId)
        verifyDelivery(thread).finally(() => verifying.delete(thread.orderId))
      }
    }
  }

  onMount(async () => {
    if (!orderChannelCapable($signer)) return

    myPubkey =
      (await connectOrderChannel(
        publishOrderEvent,
        async filters => {
          await myLoad({relays: env.DEFAULT_RELAYS, filters, skipCache: true}).catch(() => null)

          return app.get().repository.query(filters)
        },
        $signer,
      )) ?? ""

    if (!myPubkey) return

    ready = true
    poll()
    timer = setInterval(poll, 3000)
  })

  onDestroy(() => {
    clearInterval(timer)

    for (const url of Object.values(objectUrls)) URL.revokeObjectURL(url as string)
  })

  const roleIn = thread =>
    myPubkey === thread.providerKey ? "maker" : myPubkey === thread.buyerKey ? "buyer" : "watcher"

  const report = ({sent, words}, did) => (sent ? showInfo(did) : showWarning(`Not sent: ${words}`))

  const accept = async thread => report(await acceptOrder(thread), "Acceptance sent.")

  const messages = {}
  const committing = {}

  // Each order's handshake steps stay folded away until asked for. While folded, the latest
  // step still shows if it failed, so a current problem is never hidden.
  const showDetails: Record<string, boolean> = {}

  const toggleDetails = orderId => {
    showDetails[orderId] = !showDetails[orderId]
  }

  // A phone often gives no type for a file; its name's ending is the next best guess.
  const TYPES_BY_ENDING = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    heic: "image/heic",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    ogg: "audio/ogg",
    txt: "text/plain",
    md: "text/markdown",
    pdf: "application/pdf",
    zip: "application/zip",
    epub: "application/epub+zip",
  }

  const typeOf = (file: File) =>
    file.type ||
    TYPES_BY_ENDING[file.name.split(".").pop()?.toLowerCase() ?? ""] ||
    "application/octet-stream"

  // A file, or else a written message, delivered as plain text.
  const commit = async thread => {
    if (committing[thread.orderId]) return

    const file = fileInputs[thread.orderId]?.files?.[0]
    const message = messages[thread.orderId]?.trim()

    if (!file && !message) return showWarning("Pick a file or write a message first.")

    // Checked before reading, so a large video is not loaded into memory only to be refused.
    if (file && file.size > MAX_FILE_MB * 1024 * 1024) {
      return showWarning(`Not sent: the file is over ${MAX_FILE_MB} MB`)
    }

    committing[thread.orderId] = true

    try {
      const plain = file
        ? new Uint8Array(await file.arrayBuffer())
        : new TextEncoder().encode(messages[thread.orderId])
      const mimeType = file ? typeOf(file) : "text/plain"

      report(await commitFile(thread, plain, mimeType), "Locked, uploaded, and committed.")
    } catch (error) {
      showWarning(`Not sent: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      committing[thread.orderId] = false
    }
  }

  const invoices = {}
  const preimages = {}

  const bill = async thread => {
    const real = invoices[thread.orderId]?.trim()

    report(
      await sendBill(thread, real || ""),
      real ? "Your wallet's bill sent." : "Pretend bill and payment voucher sent.",
    )
  }

  const pay = async thread => {
    const real = preimages[thread.orderId]?.trim()

    report(
      await payAndProve(thread, real || ""),
      real ? "Payment proof sent." : "Paid (pretend) and payment proof sent.",
    )
  }

  const release = async thread => report(await releaseKey(thread), "Key sent to the buyer.")

  const cancellableStates = ["PROPOSED", "ACCEPTED", "COMMITTED", "AWAITING_PAYMENT"]
  const cancelSent = {}

  const cancel = async thread => {
    cancelSent[thread.orderId] = true

    const result = await cancelOrder(thread)

    cancelSent[thread.orderId] = result.sent
    report(result, "Cancellation sent.")
  }

  const mimeOf = thread => thread.commitment?.mimeType || "application/octet-stream"

  const kindOf = thread => {
    const [type] = mimeOf(thread).split("/")

    return ["image", "video", "audio", "text"].includes(type) ? type : "file"
  }

  // One object URL per delivery, made once instead of on every render.
  const objectUrls = {}

  const deliveredUrl = thread =>
    (objectUrls[thread.orderId] ??= URL.createObjectURL(
      new Blob([thread.delivered], {type: mimeOf(thread)}),
    ))

  // A long text shows its first 64 KB, decoded once; Save file keeps all of it.
  const PREVIEW_BYTES = 64 * 1024
  const texts = {}

  const deliveredText = thread =>
    (texts[thread.orderId] ??= new TextDecoder().decode(
      Uint8Array.from(thread.delivered.slice(0, PREVIEW_BYTES)),
    ))

  const EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/svg+xml": "svg",
    "text/plain": "txt",
    "audio/mpeg": "mp3",
    "video/quicktime": "mov",
    "application/octet-stream": "bin",
  }

  const fileName = thread => {
    const mime = mimeOf(thread).split(";")[0].toLowerCase()
    const subtype = (mime.split("/")[1] || "bin").replace(/[^a-z0-9]/g, "")

    return `nenya-${thread.orderId.slice(0, 8)}.${EXTENSIONS[mime] || subtype || "bin"}`
  }

  // In pieces, because one call with a whole large file overflows the call stack.
  const toBase64 = (bytes: Uint8Array) => {
    let binary = ""

    for (let at = 0; at < bytes.length; at += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
    }

    return btoa(binary)
  }

  // A long press on the delivery offers no save in the Android app, so save it on purpose:
  // to Documents in the app, as a download in a browser.
  const saveDelivery = async thread => {
    const name = fileName(thread)

    if (!Capacitor.isNativePlatform()) {
      const a = document.createElement("a")

      a.href = deliveredUrl(thread)
      a.download = name
      a.click()

      return
    }

    try {
      const status = await Filesystem.checkPermissions()

      if (status.publicStorage !== "granted") await Filesystem.requestPermissions()

      // In 1 MB pieces, so a large file never crosses to Android as one huge message.
      const bytes = Uint8Array.from(thread.delivered)
      const piece = 1024 * 1024

      await Filesystem.writeFile({
        path: name,
        data: toBase64(bytes.subarray(0, piece)),
        directory: Directory.Documents,
      })

      for (let at = piece; at < bytes.length; at += piece) {
        await Filesystem.appendFile({
          path: name,
          data: toBase64(bytes.subarray(at, at + piece)),
          directory: Directory.Documents,
        })
      }

      showInfo(`Saved to your Documents folder as ${name}.`)
    } catch (error) {
      showWarning(
        `The file was not saved: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
</script>

<FlexColumn>
  <div class="flex items-center gap-3">
    <i class="fa fa-handshake fa-lg text-accent" />
    <h2 class="staatliches text-2xl">Orders</h2>
  </div>
  {#if !ready}
    <Card>
      <p class="text-neutral-400">
        The order channel works with any login whose signer supports nip44. If your signer is asking
        for permission, approve it and reload.
      </p>
    </Card>
  {:else if $orderThreads.size === 0}
    <Card>
      <p class="py-8 text-center text-neutral-400">
        No orders yet. Open an offer in the market and choose "Order this", or open your own request
        and choose "Order from this bid".
      </p>
    </Card>
  {/if}
  {#each [...$orderThreads.values()] as thread (thread.orderId)}
    {@const open = Boolean(showDetails[thread.orderId])}
    {@const last = thread.log[thread.log.length - 1]}
    {@const lines = open ? thread.log : last && !last.ok ? [last] : []}
    <Card>
      <div class="flex items-center justify-between gap-4">
        <div class="flex min-w-0 flex-col">
          <span class="truncate font-bold">Order {thread.orderId.slice(0, 8)}…</span>
          <span class="text-sm text-neutral-400">
            You are the {roleIn(thread)} · {thread.order
              ? `${msatToSats(thread.order.totalMsat).toLocaleString()} sats`
              : ""}
          </span>
        </div>
        <span
          class="whitespace-nowrap rounded bg-neutral-800 px-2 py-1 text-xs uppercase text-tinted-400">
          {thread.order?.state ?? "…"}
        </span>
      </div>
      {#if thread.log.length > 0}
        <button
          type="button"
          class="mt-2 cursor-pointer text-sm text-tinted-400 underline"
          aria-expanded={open}
          on:click={() => toggleDetails(thread.orderId)}>
          {open ? "Hide details" : "Show details"}
        </button>
      {/if}
      {#if lines.length > 0}
        <div class="mt-2 flex flex-col gap-1">
          {#each lines as line}
            <p class="text-sm" class:text-neutral-400={line.ok} class:text-danger={!line.ok}>
              <span class="rounded bg-neutral-800 px-1 text-xs uppercase">
                {line.by === "nenya" ? "Nenya" : "App"}
              </span>
              <span class="text-xs text-tinted-500">{line.call}</span>
              {line.words}
            </p>
          {/each}
        </div>
      {/if}
      {#if roleIn(thread) === "maker"}
        {#if thread.order?.state === "PROPOSED"}
          <Button class="btn btn-accent mt-2" on:click={() => accept(thread)}>
            Accept the order
          </Button>
        {:else if thread.order?.state === "ACCEPTED"}
          <div class="mt-2 flex flex-col gap-2">
            <input type="file" bind:this={fileInputs[thread.orderId]} />
            <textarea
              class="rounded border border-solid border-neutral-600 bg-transparent px-3 py-2 text-sm"
              rows="3"
              bind:value={messages[thread.orderId]}
              placeholder="Or write a message to deliver instead of a file" />
            <p class="text-xs text-neutral-400">
              Any file up to {MAX_FILE_MB} MB. Place, time and camera details are removed from JPEG and
              PNG pictures before they are locked.
            </p>
            <Button
              class="btn btn-accent self-start"
              loading={committing[thread.orderId]}
              on:click={() => commit(thread)}>
              Lock, upload and commit
            </Button>
          </div>
        {:else if thread.order?.state === "COMMITTED" && !thread.requests.provider}
          <div class="mt-2 flex flex-col gap-2">
            <input
              class="rounded border border-solid border-neutral-600 bg-transparent px-3 py-2 text-sm"
              bind:value={invoices[thread.orderId]}
              placeholder="Real trade: paste a bolt11 invoice from your wallet for exactly {msatToSats(
                thread.order.priceMsat,
              ).toLocaleString()} sats (leave empty for a pretend bill)" />
            <Button class="btn btn-accent self-start" on:click={() => bill(thread)}>
              {invoices[thread.orderId]?.trim() ? "Send the bill" : "Send a pretend bill"}
            </Button>
          </div>
        {:else if thread.order?.state === "PAID" && !thread.release}
          <Button class="btn btn-accent mt-2" on:click={() => release(thread)}>
            Release the key
          </Button>
        {/if}
      {/if}
      {#if roleIn(thread) === "buyer"}
        {#if thread.order?.state === "AWAITING_PAYMENT" && !thread.settlements.provider && thread.requests.provider}
          <div class="mt-2 flex flex-col gap-2">
            {#if !thread.vouchers.provider}
              <p class="text-sm text-neutral-400">
                Paying is final. Nothing makes the seller send the key after you pay. This test
                build is for up to 1,000 sats.
              </p>
              {#if Number(thread.order.totalMsat) <= 1000000}
                <QRCode code={thread.requests.provider.invoice} />
              {/if}
              <input
                class="rounded border border-solid border-neutral-600 bg-transparent px-3 py-2 text-sm"
                bind:value={preimages[thread.orderId]}
                placeholder="Real trade: pay the bill in your wallet, then paste the payment preimage (64 hex characters)" />
            {/if}
            <Button class="btn btn-accent self-start" on:click={() => pay(thread)}>
              {thread.vouchers.provider
                ? `Pay ${msatToSats(thread.order.totalMsat).toLocaleString()} sats (pretend) and send proof`
                : "Send the payment proof"}
            </Button>
          </div>
        {/if}
        {#if cancellableStates.includes(thread.order?.state) && !thread.settlements.provider && !cancelSent[thread.orderId]}
          <div class="mt-2 flex flex-col gap-2">
            {#if thread.order.state === "AWAITING_PAYMENT"}
              <p class="text-sm text-neutral-400">
                Cancelling does not get back a payment you already made. If you paid, send the
                payment proof instead.
              </p>
            {/if}
            <Button class="btn btn-low self-start" on:click={() => cancel(thread)}>
              Cancel the order
            </Button>
          </div>
        {/if}
        {#if thread.order?.state === "RELEASED" && thread.unknownHost && !thread.hostAllowed && !thread.delivered}
          <div class="mt-2 flex flex-col gap-2">
            <p class="text-sm text-neutral-400">
              The seller put the file on {thread.unknownHost}, a host this app does not use by
              itself. Downloading it shows that host your internet address.
            </p>
            <Button class="btn btn-accent self-start" on:click={() => allowFileHost(thread)}>
              Download from {thread.unknownHost}
            </Button>
          </div>
        {/if}
        {#if thread.delivered}
          <div class="mt-2">
            <p class="mb-1 text-sm text-neutral-400">
              The delivery, unlocked only after every fingerprint matched:
            </p>
            {#if kindOf(thread) === "image"}
              <img
                class="max-h-64 rounded"
                src={deliveredUrl(thread)}
                alt="The delivered file, verified by nenya" />
            {:else if kindOf(thread) === "video"}
              <video class="max-h-64 rounded" controls src={deliveredUrl(thread)}>
                <track kind="captions" />
              </video>
            {:else if kindOf(thread) === "audio"}
              <audio controls src={deliveredUrl(thread)} />
            {:else if kindOf(thread) === "text"}
              <pre
                class="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-neutral-800 p-3 text-sm">{deliveredText(
                  thread,
                )}</pre>
              {#if thread.delivered.length > PREVIEW_BYTES}
                <p class="text-xs text-neutral-400">
                  Showing the first 64 KB of {thread.delivered.length.toLocaleString()} bytes. Save the
                  file to read all of it.
                </p>
              {/if}
            {:else}
              <p class="text-sm">
                A file ({mimeOf(thread)}, {thread.delivered.length.toLocaleString()} bytes). Save it
                to open it.
              </p>
            {/if}
            <Button class="btn btn-low mt-2" on:click={() => saveDelivery(thread)}>
              <i class="fa fa-download" />
              {kindOf(thread) === "image" ? "Save picture" : "Save file"}
            </Button>
          </div>
        {/if}
      {/if}
    </Card>
  {/each}
</FlexColumn>
