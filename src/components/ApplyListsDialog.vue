<script setup lang="ts">
// Apply lists to an interface: a standard list for stage 1 and an extended list for stage 2, each
// none or an existing list. "Create a new list" opens New List for that stage and chooses what it creates.
import { computed, ref } from 'vue'
import {
  NAlert, NAutoComplete, NButton, NForm, NFormItem, NModal, NRadio, NRadioGroup, NSpace,
} from 'naive-ui'
import { boundLists, isStandard, listFill, permitsTcpPort, EXT_RANGE, STD_RANGE } from '../policy'
import { parseAceRule } from '../ace'
import NewListDialog from './NewListDialog.vue'
import { CONSOLE_PORT, consoleWarning, useAclPage, type ApplyRequest, type StageChoice } from '../aclPage'

const props = defineProps<{ req: ApplyRequest }>()
const emit = defineEmits<{ close: [] }>()
const page = useAclPage()
const config = computed(() => page.config.value!)

const iface = ref(props.req.iface ?? '')
const name = computed(() => iface.value.trim())
const current = computed(() =>
  name.value && config.value.interfaces[name.value] ? boundLists(config.value, name.value) : { std: null, ext: null },
)

const initial = boundLists(config.value, props.req.iface ?? '')
const std = ref<StageChoice>(props.req.std ?? initial.std ?? 'none')
const ext = ref<StageChoice>(props.req.ext ?? initial.ext ?? 'none')

/** The stage New List is open for, or null. */
const creating = ref<'std' | 'ext' | null>(null)
function onCreated(acl: number) {
  if (isStandard(acl)) std.value = acl
  else ext.value = acl
}

// ---------- the interface ----------

/**
 * TODO(backend): the device's real interfaces aren't in the API. Until they are, the name is free
 * text with the configured ones as suggestions, and a warning when the engine doesn't know it.
 */
const suggestions = computed(() =>
  page.ifaceNames.value.filter((n) => n.toLowerCase().includes(name.value.toLowerCase())),
)
const nameError = computed(() =>
  name.value && !/^[A-Za-z0-9_.-]{1,15}$/.test(name.value)
    ? 'An interface name is 1 to 15 letters, digits, dots, underscores or hyphens'
    : null,
)
const mayNotExist = computed(() => {
  const e = page.engine.value
  if (!name.value || !e || e.state !== 'applied' || !e.live) return false
  return !e.attached?.includes(name.value)
})

/** "Same lists as <iface>": preselects both stages. */
const others = computed(() => page.ifaceNames.value.filter((n) => n !== name.value))
function sameAs(other: string) {
  const b = boundLists(config.value, other)
  std.value = b.std ?? 'none'
  ext.value = b.ext ?? 'none'
}

// ---------- the lists ----------

const stdLists = computed(() => page.aclNumbers.value.filter(isStandard))
const extLists = computed(() => page.aclNumbers.value.filter((a) => !isStandard(a)))

/** "3 entries · deny host 203.0.113.66, …" */
function summary(acl: number) {
  const es = page.entriesOf(acl)
  const k = `${es.length} ${es.length === 1 ? 'entry' : 'entries'}`
  if (!es.length) return k
  return `${k} · ${es[0].ace}${es.length > 1 ? ', …' : ''}`
}
const alsoText = (acl: number) => {
  const on = page.alsoOn(acl, name.value)
  return on.length ? `also on ${on.join(', ')}` : ''
}

/** The list each stage ends up with, or null. */
const chosenStd = computed(() => (std.value === 'none' ? null : std.value))
const chosenExt = computed(() => (ext.value === 'none' ? null : ext.value))
const extEntries = computed(() => (chosenExt.value === null ? [] : page.entriesOf(chosenExt.value)))

/**
 * Chosen lists over mini-fw's limit (64 standard, 128 extended entries): applied, mfwd would refuse
 * the whole policy and keep running the previous one.
 */
const overLimit = computed(() =>
  [std.value, ext.value]
    .filter((c): c is number => typeof c === 'number')
    .map((a) => ({ acl: a, fill: listFill(a, page.entriesOf(a).length) }))
    .filter((x) => x.fill.over),
)

// ---------- what it does ----------

const stage1Sentence = computed(() => {
  if (chosenStd.value === null) return 'Stage 1: no standard list; no source is dropped here.'
  const es = page.entriesOf(chosenStd.value)
  const denies = es.filter((e) => parseAceRule(e.ace, true)?.action === 'deny').length
  if (!denies) return `Stage 1: list ${chosenStd.value} denies nothing yet; every packet goes on to stage 2.`
  return `Stage 1: list ${chosenStd.value} drops the sources its ${denies} deny ${denies === 1 ? 'entry matches' : 'entries match'}; the rest go on to stage 2.`
})
const stage2Sentence = computed(() => {
  if (chosenExt.value === null) return 'Stage 2: no extended list; everything that gets past stage 1 passes.'
  if (!extEntries.value.length) return `Stage 2: list ${chosenExt.value} has no entries, so everything is dropped.`
  return `Stage 2: list ${chosenExt.value} passes what it permits and drops the rest.`
})

const emptyExt = computed(() => chosenExt.value !== null && !extEntries.value.length)
const noConsole = computed(() => chosenExt.value !== null && extEntries.value.length > 0 && !permitsTcpPort(extEntries.value, CONSOLE_PORT))
const failOpen = computed(() => chosenExt.value === null && chosenStd.value !== null)
const shared = computed(() =>
  [chosenStd.value, chosenExt.value]
    .filter((a): a is number => a !== null)
    .map((a) => ({ acl: a, on: page.alsoOn(a, name.value) }))
    .filter((x) => x.on.length),
)
const nothing = computed(() => chosenStd.value === null && chosenExt.value === null && current.value.std === null && current.value.ext === null)
const unchanged = computed(
  () => chosenStd.value === current.value.std && chosenExt.value === current.value.ext,
)

// ---------- applying ----------

const submitting = ref(false)
const problem = computed(() => {
  if (!name.value) return 'Enter the interface'
  if (nameError.value) return nameError.value
  if (overLimit.value.length) {
    const { acl, fill } = overLimit.value[0]
    return `List ${acl} can hold at most ${fill.max} entries; it has ${fill.count}. Remove some first.`
  }
  if (emptyExt.value) return `List ${chosenExt.value} has no entries and would drop all traffic. Add entries first.`
  if (nothing.value) return 'Choose a list for at least one stage'
  if (unchanged.value) return `${name.value} already applies these lists`
  return null
})

async function onApply() {
  if (problem.value) {
    page.message.warning(problem.value)
    return
  }
  const i = name.value
  submitting.value = true
  try {
    await page.setLists(i, chosenStd.value, chosenExt.value)
    page.message.success(`${i} applies ${[chosenStd.value, chosenExt.value].filter((a) => a !== null).map((a) => `list ${a}`).join(' and ') || 'no list'}`)
    await page.refreshAfterChanges()
    page.goTo(i)
    emit('close')
  } catch {
    // api.ts showed why; some calls may have gone through
    await page.refreshAfterChanges()
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <NModal :show="true" preset="card" title="Apply lists to an interface" style="width: 760px; max-width: calc(100vw - 32px)" :mask-closable="false" @update:show="(v: boolean) => !v && emit('close')">
    <NForm label-placement="left" label-width="90">
      <NFormItem label="Interface">
        <div class="field">
          <strong v-if="req.fixed">{{ name }}</strong>
          <NAutoComplete
            v-else
            v-model:value="iface"
            :options="suggestions"
            placeholder="For example eth0"
            :status="nameError ? 'error' : undefined"
            :get-show="() => true"
          />
          <div v-if="nameError" class="error">{{ nameError }}</div>
          <div v-else-if="mayNotExist" class="warn-text">
            The engine isn't filtering an interface named {{ name }}, so it may not exist on this device. Check the name.
          </div>
          <NSpace v-if="others.length" :size="6" class="same">
            <NButton v-for="o in others" :key="o" size="tiny" secondary @click="sameAs(o)">Same lists as {{ o }}</NButton>
          </NSpace>
        </div>
      </NFormItem>
    </NForm>

    <div class="stages">
      <fieldset>
        <legend>Stage 1 · Standard list ({{ STD_RANGE[0] }}-{{ STD_RANGE[1] }})</legend>
        <NRadioGroup v-model:value="std">
          <NSpace vertical :size="6">
            <NRadio value="none">None</NRadio>
            <NRadio v-for="a in stdLists" :key="a" :value="a">
              List {{ a }} <span class="muted">· {{ summary(a) }}</span>
              <span v-if="alsoText(a)" class="also"> · {{ alsoText(a) }}</span>
            </NRadio>
          </NSpace>
        </NRadioGroup>
        <NButton text type="primary" size="small" class="create" @click="creating = 'std'">+ Create a new list…</NButton>
      </fieldset>
      <fieldset>
        <legend>Stage 2 · Extended list ({{ EXT_RANGE[0] }}-{{ EXT_RANGE[1] }})</legend>
        <NRadioGroup v-model:value="ext">
          <NSpace vertical :size="6">
            <NRadio value="none">None</NRadio>
            <NRadio v-for="a in extLists" :key="a" :value="a" :disabled="!page.entriesOf(a).length && a !== current.ext">
              List {{ a }} <span class="muted">· {{ summary(a) }}</span>
              <span v-if="!page.entriesOf(a).length" class="muted"> · add entries before applying it</span>
              <span v-if="alsoText(a)" class="also"> · {{ alsoText(a) }}</span>
            </NRadio>
          </NSpace>
        </NRadioGroup>
        <NButton text type="primary" size="small" class="create" @click="creating = 'ext'">+ Create a new list…</NButton>
      </fieldset>
    </div>

    <div class="after">
      <div class="after-title">Incoming traffic on {{ name || 'the interface' }}, after this</div>
      <p>{{ stage1Sentence }}</p>
      <p>{{ stage2Sentence }}</p>
    </div>

    <NAlert v-for="o in overLimit" :key="o.acl" type="error" :bordered="false" title="List too long" class="warn">
      List {{ o.acl }} can hold at most {{ o.fill.max }} entries; it has {{ o.fill.count }}. Applied, the device would
      refuse the whole configuration and keep running the previous one. Remove {{ o.fill.count - o.fill.max }} first.
    </NAlert>
    <NAlert v-if="emptyExt" type="error" :bordered="false" title="Everything will be dropped" class="warn">
      List {{ chosenExt }} has no entries. An extended list drops what it doesn't permit, so
      {{ name || 'the interface' }} would drop ALL incoming traffic, this console's connection included if it arrives
      there. Add entries to the list first, or choose another list.
    </NAlert>
    <NAlert v-else-if="noConsole" type="warning" :bordered="false" title="The console" class="warn">
      {{ consoleWarning(name ? [name] : []) }}
    </NAlert>
    <NAlert v-if="failOpen" type="info" :bordered="false" class="warn">
      With no extended list, {{ name || 'the interface' }} lets through everything stage 1 doesn't deny.
    </NAlert>
    <NAlert v-if="shared.length" type="info" :bordered="false" class="warn">
      <template v-for="(s, i) in shared" :key="s.acl">
        {{ i ? ' ' : '' }}List {{ s.acl }} is also applied on {{ s.on.join(', ') }}.
      </template>
      A change to a shared list applies on every interface that uses it.
    </NAlert>
    <NAlert v-if="nothing" type="warning" :bordered="false" class="warn">Nothing chosen: choose a list for at least one stage.</NAlert>
    <p class="muted small">
      The change takes effect at once but isn't saved: if it cuts off your access, restarting the device restores the
      saved configuration.
    </p>

    <template #footer>
      <NSpace justify="end">
        <NButton @click="emit('close')">Cancel</NButton>
        <NButton type="primary" :loading="submitting" :disabled="overLimit.length > 0 || emptyExt" @click="onApply">
          Apply
        </NButton>
      </NSpace>
    </template>
  </NModal>
  <NewListDialog v-if="creating" :kind="creating" @created="onCreated" @close="creating = null" />
</template>

<style scoped>
.field {
  width: 100%;
}
.same {
  margin-top: 8px;
}
.stages {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
fieldset {
  flex: 1 1 300px;
  min-width: 0;
  margin: 0;
  padding: 8px 12px 12px;
  border: 1px solid var(--c-border);
  border-radius: 4px;
}
legend {
  padding: 0 4px;
  font-weight: 600;
}
.after {
  margin: 16px 0 8px;
}
.after-title {
  font-weight: 600;
}
.after p {
  margin: 4px 0;
}
.warn {
  margin-top: 8px;
}
.muted {
  color: var(--c-muted);
}
.also {
  color: var(--c-info-text);
}
.create {
  display: block;
  margin-top: 10px;
}
.small {
  font-size: 12px;
}
.error {
  margin-top: 4px;
  font-size: 12px;
  color: var(--c-error-text);
}
.warn-text {
  margin-top: 4px;
  font-size: 12px;
  color: var(--c-warning-text);
}
</style>
