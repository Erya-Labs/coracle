<script lang="ts">
  import Heading from "src/partials/Heading.svelte"
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import Field from "src/partials/Field.svelte"
  import Input from "src/partials/Input.svelte"
  import Textarea from "src/partials/Textarea.svelte"
  import Button from "src/partials/Button.svelte"
  import {showInfo, showWarning} from "src/partials/Toast.svelte"
  import {router} from "src/app/util/router"
  import {uniq} from "@welshman/lib"
  import {makeMarketOffer, makeMarketRequest} from "src/domain"
  import {env, sign} from "src/engine"
  import {getWriteRelays, pubkey, publisher} from "src/engine/core"

  let side = "request"
  let title = ""
  let summary = ""
  let priceSats = 100000
  let content = ""
  let loading = false

  const submit = async () => {
    const make = side === "offer" ? makeMarketOffer : makeMarketRequest
    const {template, error} = make({
      pubkey: $pubkey,
      title,
      summary,
      priceSats,
      content,
    })

    if (error) {
      return showWarning(`Nenya refused to build the ${side}: ${error}`)
    }

    loading = true

    try {
      const event = await sign(template)

      publisher
        .get()
        .publish({event, relays: uniq([...getWriteRelays($pubkey), ...env.DEFAULT_RELAYS])})
      showInfo(`Your ${side} has been published!`)
      router.pop()
    } finally {
      loading = false
    }
  }
</script>

<form on:submit|preventDefault={submit}>
  <FlexColumn>
    <Heading class="text-center">Post a listing</Heading>
    <p class="text-center text-neutral-400">
      The event is built and checked by the nenya library before it is signed; if the library
      refuses it, nothing is published.
    </p>
    <Field label="Kind of listing">
      <div class="flex gap-4">
        <label class="flex items-center gap-2">
          <input type="radio" bind:group={side} value="request" />
          Request — I want something made
        </label>
        <label class="flex items-center gap-2">
          <input type="radio" bind:group={side} value="offer" />
          Offer — I will make something
        </label>
      </div>
    </Field>
    <Field label={side === "offer" ? "What will you make?" : "What do you want made?"}>
      <Input bind:value={title} placeholder="A 30-second looping animation of a lighthouse" />
    </Field>
    <Field label="Summary (optional)">
      <Input bind:value={summary} placeholder="Seamless loop, 1080p, no watermark" />
    </Field>
    <Field label={side === "offer" ? "Price (sats)" : "Budget (sats)"}>
      <Input type="number" bind:value={priceSats} />
    </Field>
    <Field label="Details (optional)">
      <Textarea bind:value={content} placeholder="Style references, sizes, deadlines..." />
    </Field>
    <Button type="submit" class="btn btn-accent" {loading}>Publish {side}</Button>
  </FlexColumn>
</form>
