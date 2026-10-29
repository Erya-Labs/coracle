<script lang="ts">
  import {onDestroy, onMount} from "svelte"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import Card from "src/partials/Card.svelte"
  import Button from "src/partials/Button.svelte"
  import {showInfo, showWarning} from "src/partials/Toast.svelte"
  import {msatToSats} from "src/domain"
  import {
    acceptOrder,
    commitFile,
    connectOrderChannel,
    orderChannelCapable,
    orderThreads,
    payAndProve,
    processWraps,
    releaseKey,
    sendBill,
    verifyDelivery,
  } from "src/domain"
  import {env, myLoad} from "src/engine"
  import {app, publisher} from "src/engine/core"

  let timer
  let myPubkey = ""
  let ready = false
  const fileInputs = {}
  const verifying = new Set()

  const poll = async () => {
    const filters = [{kinds: [1059], "#p": [myPubkey]}]

    await myLoad({relays: env.DEFAULT_RELAYS, filters, skipCache: true}).catch(() => null)
    await processWraps(app.get().repository.query(filters))
  }

  onMount(async () => {
    if (!orderChannelCapable()) return

    myPubkey =
      (await connectOrderChannel(
        event => publisher.get().publish({event, relays: env.DEFAULT_RELAYS}),
        async filters => {
          await myLoad({relays: env.DEFAULT_RELAYS, filters, skipCache: true}).catch(() => null)

          return app.get().repository.query(filters)
        },
      )) ?? ""

    if (!myPubkey) return

    ready = true
    poll()
    timer = setInterval(poll, 3000)
  })

  onDestroy(() => clearInterval(timer))

  const roleIn = thread =>
    myPubkey === thread.providerKey ? "maker" : myPubkey === thread.buyerKey ? "buyer" : "watcher"

  const report = ({sent, words}, did) =>
    sent ? showInfo(did) : showWarning(`Nenya refused: ${words}`)

  const accept = async thread => report(await acceptOrder(thread), "Acceptance sent.")

  const commit = async thread => {
    const file = fileInputs[thread.orderId]?.files?.[0]

    if (!file) return showWarning("Pick the file to deliver first.")

    const plain = new Uint8Array(await file.arrayBuffer())

    report(
      await commitFile(thread, plain, file.type || "image/png"),
      "Locked, uploaded, and committed.",
    )
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

  $: for (const thread of $orderThreads.values()) {
    if (
      roleIn(thread) === "buyer" &&
      thread.order?.state === "RELEASED" &&
      thread.release &&
      !thread.delivered &&
      !verifying.has(thread.orderId)
    ) {
      verifying.add(thread.orderId)
      verifyDelivery(thread)
    }
  }

  const pictureUrl = thread =>
    URL.createObjectURL(
      new Blob([thread.delivered], {type: thread.release?.release?.fileType || "image/png"}),
    )
</script>

<FlexColumn>
  <div class="flex items-center gap-3">
    <i class="fa fa-handshake fa-lg text-accent" />
    <h2 class="staatliches text-2xl">Orders</h2>
  </div>
  {#if !ready}
    <Card>
      <p class="text-neutral-400">
        The order channel needs a NIP-07 signer with nip44 encryption — a recent nos2x or Alby, or
        this build's dev test signer. If your extension is asking for permission, approve it and
        reload.
      </p>
    </Card>
  {:else if $orderThreads.size === 0}
    <Card>
      <p class="py-8 text-center text-neutral-400">
        No orders yet. Open an offer in the market and choose "Order this".
      </p>
    </Card>
  {/if}
  {#each [...$orderThreads.values()] as thread (thread.orderId)}
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
      <div class="mt-2 flex flex-col gap-1">
        {#each thread.log as line}
          <p class="text-sm" class:text-neutral-400={line.ok} class:text-danger={!line.ok}>
            <span class="rounded bg-neutral-800 px-1 text-xs uppercase">
              {line.by === "nenya" ? "Nenya" : "App"}
            </span>
            <span class="text-xs text-tinted-500">{line.call}</span>
            {line.words}
          </p>
        {/each}
      </div>
      {#if roleIn(thread) === "maker"}
        {#if thread.order?.state === "PROPOSED"}
          <Button class="btn btn-accent mt-2" on:click={() => accept(thread)}>
            Accept the order
          </Button>
        {:else if thread.order?.state === "ACCEPTED"}
          <div class="mt-2 flex items-center gap-2">
            <input type="file" accept="image/*" bind:this={fileInputs[thread.orderId]} />
            <Button class="btn btn-accent" on:click={() => commit(thread)}>
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
              Send the bill
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
        {#if thread.delivered}
          <div class="mt-2">
            <p class="mb-1 text-sm text-neutral-400">
              The delivery, unlocked only after every fingerprint matched:
            </p>
            <img
              class="max-h-64 rounded"
              src={pictureUrl(thread)}
              alt="The delivered file, verified by nenya" />
          </div>
        {/if}
      {/if}
    </Card>
  {/each}
</FlexColumn>
