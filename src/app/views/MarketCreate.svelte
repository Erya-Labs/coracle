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
  import {makeMarketRequest} from "src/domain"
  import {env, sign} from "src/engine"
  import {getWriteRelays, pubkey, publisher} from "src/engine/core"

  let title = ""
  let summary = ""
  let priceSats = 100000
  let content = ""
  let loading = false

  const submit = async () => {
    const {template, error} = makeMarketRequest({
      pubkey: $pubkey,
      title,
      summary,
      priceSats,
      content,
    })

    if (error) {
      return showWarning(`Nenya refused to build the request: ${error}`)
    }

    loading = true

    try {
      const event = await sign(template)

      publisher
        .get()
        .publish({event, relays: uniq([...getWriteRelays($pubkey), ...env.DEFAULT_RELAYS])})
      showInfo("Your request has been published!")
      router.pop()
    } finally {
      loading = false
    }
  }
</script>

<form on:submit|preventDefault={submit}>
  <FlexColumn>
    <Heading class="text-center">Post a request</Heading>
    <p class="text-center text-neutral-400">
      Say what you want made and what you'll pay. The event is built and checked by the nenya
      library before it is signed; if the library refuses it, nothing is published.
    </p>
    <Field label="What do you want made?">
      <Input bind:value={title} placeholder="A 30-second looping animation of a lighthouse" />
    </Field>
    <Field label="Summary (optional)">
      <Input bind:value={summary} placeholder="Seamless loop, 1080p, no watermark" />
    </Field>
    <Field label="Budget (sats)">
      <Input type="number" bind:value={priceSats} />
    </Field>
    <Field label="Details (optional)">
      <Textarea bind:value={content} placeholder="Style references, sizes, deadlines..." />
    </Field>
    <Button type="submit" class="btn btn-accent" {loading}>Publish request</Button>
  </FlexColumn>
</form>
