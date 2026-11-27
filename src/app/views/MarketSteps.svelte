<script lang="ts">
  import FlexColumn from "src/partials/FlexColumn.svelte"
  import Card from "src/partials/Card.svelte"
  import {FAULTS, NENYA_REPOSITORY, REASONS, STAGES, STEPS} from "src/domain/orderSteps"
</script>

<FlexColumn>
  <div class="flex items-center gap-3">
    <i class="fa fa-circle-info fa-lg text-accent" />
    <h2 class="staatliches text-2xl">Step guide</h2>
  </div>
  <p class="text-sm text-neutral-400">
    Each order lists the steps of its handshake under "Show details". A step that passed shows its
    name. A step that failed shows a three-digit code instead. NENYA marks a check made by the Nenya
    library; APP marks something this app did.
  </p>
  <Card>
    <h3 class="staatliches mb-2 text-xl">Steps</h3>
    <div class="flex flex-col gap-3">
      {#each STEPS as step}
        <div id="step-{step.name}">
          <p>
            <span class="font-mono text-sm text-accent">{step.name}</span>
            <span class="ml-1 text-xs uppercase text-neutral-400">{step.by}</span>
          </p>
          <p class="text-sm">{step.about}</p>
        </div>
      {/each}
    </div>
  </Card>
  <Card>
    <h3 class="staatliches mb-2 text-xl">Problem codes</h3>
    <p class="mb-3 text-sm text-neutral-400">
      The first digit names the stage:
      {#each STAGES as stage, i}
        <span class="whitespace-nowrap"
          ><span class="font-mono">{stage.codes}</span>
          {stage.stage}{i < STAGES.length - 1 ? "," : "."}</span>
        {" "}
      {/each}
    </p>
    <div class="flex flex-col gap-3">
      {#each FAULTS as fault}
        <div id="code-{fault.code}">
          <p>
            <span class="font-mono text-sm text-danger">{fault.code}</span>
            <span class="ml-1 font-bold">{fault.title}</span>
          </p>
          <p class="text-sm">{fault.about}</p>
          <p class="text-sm text-neutral-400">What to do: {fault.next}</p>
        </div>
      {/each}
    </div>
  </Card>
  <Card>
    <h3 class="staatliches mb-2 text-xl">Reason codes</h3>
    <p class="mb-3 text-sm text-neutral-400">
      After a problem code, a second code in capitals is the Nenya library's own reason. The most
      common ones are below. The full set is in the
      <a href={NENYA_REPOSITORY} target="_blank" rel="noopener noreferrer" class="underline"
        >Nenya library</a
      >.
    </p>
    <div class="flex flex-col gap-3">
      {#each REASONS as reason}
        <div>
          <p class="break-all font-mono text-sm">{reason.reason}</p>
          <p class="text-sm">{reason.about}</p>
        </div>
      {/each}
    </div>
  </Card>
</FlexColumn>
