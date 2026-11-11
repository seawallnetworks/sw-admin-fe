<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref } from 'vue'
import {
  NAlert, NButton, NCard, NDataTable, NEmpty, NForm, NFormItem, NInput, NInputNumber, NModal, NPopconfirm, NRadio,
  NRadioButton, NRadioGroup, NResult, NSelect, NSpace, NStatistic, NSwitch, NTabPane, NTabs, NTag, useDialog, useMessage,
  type DataTableColumns,
} from 'naive-ui'
import AceAddrInput from '../components/AceAddrInput.vue'
import AcePortInput from '../components/AcePortInput.vue'
import EffectivePolicy from '../components/EffectivePolicy.vue'
import { isVeryBroad, positionOptions, shadowingEntry } from '../policy'
import {
  NAMED_PROTOCOLS, aceFormErrors, buildAce, emptyAceForm, hasPorts, parseAce, type AceForm, type AceProtocol,
} from '../ace'
import {
  addAclEntry, bindAcl, createAcl, deleteAcl, deleteAclEntry, deleteInterface, getAclEngine, getConfig, getRole,
  refreshPendingChanges, unbindAcl, type AclEngine, type AclEngineState, type AclEntry, type DeviceConfig,
} from '../api'

const message = useMessage()
const dialog = useDialog()
// Every call on this page is admin only: a `user` gets 403 even for reading the lists.
const isAdmin = getRole() === 'admin'

const isStandard = (acl: number) => acl < 100
const kindLabel = (acl: number) => (isStandard(acl) ? 'Standard' : 'Extended')

// ---------- configuration ----------

const config = ref<DeviceConfig['config'] | null>(null)
const loading = ref(false)
/** The tab that is open: a list's number, or the Effective Policy. */
const POLICY_TAB = 'policy'
const selected = ref<number | typeof POLICY_TAB | null>(null)
/** The configuration's generation when it was read; it moves with every change, from anyone. */
const generation = ref<number | null>(null)

/** List numbers, in the order the device gives them. */
const aclNumbers = computed(() => Object.keys(config.value?.acls ?? {}).map(Number))
const interfaces = computed(() =>
  Object.entries(config.value?.interfaces ?? {}).map(([name, i]) => ({ name, acls_in: i.acls_in })),
)
/** The interfaces that apply each list. */
const appliedOn = (acl: number) => interfaces.value.filter((i) => i.acls_in.includes(acl)).map((i) => i.name)

async function loadConfig() {
  loading.value = true
  try {
    const res = await getConfig()
    config.value = res.config
    generation.value = res.generation ?? null
    if (selected.value === null || (selected.value !== POLICY_TAB && !aclNumbers.value.includes(selected.value))) {
      selected.value = aclNumbers.value[0] ?? null
    }
  } catch {
    // error already shown by api.ts
  } finally {
    loading.value = false
  }
}

/**
 * Runs one change, then reads the configuration again (the device rewrites entries in its own
 * form) and asks again about unsaved changes. A refused change keeps its message from api.ts.
 */
async function mutate(fn: () => Promise<unknown>, okText: string) {
  await fn()
  message.success(okText)
  refreshPendingChanges().catch(() => {})
  pollEngine()
  await loadConfig()
}

// ---------- ACL engine: polled every 5s, paused while the tab is hidden ----------

const POLL_MS = 5000
const engine = ref<AclEngine | null>(null)
const engineError = ref<string | null>(null)

let timer: number | undefined
let inFlight = false
let stopped = false
let firstPoll = true

async function pollEngine() {
  window.clearTimeout(timer)
  timer = undefined
  if (inFlight) return
  inFlight = true
  try {
    // only the first call toasts its error; after that the card says it
    engine.value = await getAclEngine(!firstPoll)
    engineError.value = null
  } catch (e) {
    engineError.value = e instanceof Error ? e.message : String(e)
  } finally {
    inFlight = false
    firstPoll = false
  }
  if (!document.hidden && !stopped) timer = window.setTimeout(pollEngine, POLL_MS)
}

function onVisibilityChange() {
  if (document.hidden) {
    window.clearTimeout(timer)
    timer = undefined
  } else {
    pollEngine()
  }
}

onMounted(() => {
  if (!isAdmin) return
  document.addEventListener('visibilitychange', onVisibilityChange)
  loadConfig()
  pollEngine()
})
onUnmounted(() => {
  stopped = true
  window.clearTimeout(timer)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

const stateInfo: Record<AclEngineState, { label: string; type: 'success' | 'info' | 'error' | 'default'; text: string }> = {
  applied: { label: 'Enforced', type: 'success', text: 'The access lists below are in force.' },
  pending: { label: 'Applying', type: 'info', text: 'The latest change has not reached the engine yet.' },
  unreachable: { label: 'Engine down', type: 'error', text: 'The engine is not running; the device keeps retrying. Traffic is not filtered by the latest lists.' },
  refused: { label: 'Refused', type: 'error', text: 'The engine refused the configuration.' },
  off: { label: 'Off', type: 'default', text: 'This device runs without the ACL engine; the lists are not enforced.' },
}
const counterLabels: Record<string, string> = { xdp_pass: 'Passed (packets)', xdp_drop: 'Dropped (packets)' }

const fmt = (n: number) => n.toLocaleString('en-US')
const fmtTime = (t: number) => new Date(t * 1000).toLocaleString('en-US', { hourCycle: 'h23' })

// ---------- lists ----------

async function onDeleteAcl(acl: number) {
  await mutate(() => deleteAcl(acl), `Access list ${acl} deleted`).catch(() => {})
}

/**
 * Whether the configuration is still the one shown. If someone else changed it (another admin, or
 * the CLI), the page shows the new one and says so, and the caller stops: an entry is deleted by its
 * seq, which may now be another entry.
 */
async function stillCurrent(): Promise<boolean> {
  const shown = generation.value
  let res: DeviceConfig
  try {
    res = await getConfig()
  } catch {
    return false // error already shown by api.ts
  }
  // no generation to compare (the running reply always has one): nothing to go by, so go on
  if (shown === null || res.generation === undefined || res.generation === shown) return true
  config.value = res.config
  generation.value = res.generation ?? null
  message.warning('The access lists were changed elsewhere since you opened them. Check the list, then try again.', {
    duration: 8000,
  })
  return false
}

async function onDeleteEntry(acl: number, e: AclEntry) {
  if (!(await stillCurrent())) return
  await mutate(() => deleteAclEntry(acl, e.seq), `Entry ${e.seq} deleted`).catch(() => {})
}

/** The delete confirmation: an extended list in force can cut off traffic when a permit goes. */
function deleteEntryText(acl: number, e: EntryRow) {
  const ask = `Delete entry ${e.seq} "${e.ace}"?`
  const on = appliedOn(acl)
  if (isStandard(acl) || !on.length || e.view?.action === 'deny') return ask
  return (
    `${ask} List ${acl} is in force on ${on.join(', ')}. Removing a permit entry can cut off the traffic it ` +
    `let in, including this web console's connection.`
  )
}

/** Each entry with its columns; `view` is null for a form the page can't read, shown as its text. */
const entryRows = (acl: number) =>
  (config.value?.acls[acl] ?? []).map((e) => ({ ...e, view: parseAce(e.ace, isStandard(acl)) }))
type EntryRow = ReturnType<typeof entryRows>[number]

function entryColumns(acl: number): DataTableColumns<EntryRow> {
  const standard = isStandard(acl)
  // an entry that didn't parse spans the columns from Action to the last before Actions
  const span = standard ? 2 : 5
  const cols: DataTableColumns<EntryRow> = [
    { title: 'Seq', key: 'seq', width: 80 },
    {
      title: 'Action',
      key: 'action',
      width: 90,
      colSpan: (r) => (r.view ? 1 : span),
      render: (r) =>
        r.view
          ? h(NTag, { size: 'small', type: r.view.action === 'permit' ? 'success' : 'error' }, () =>
              r.view!.action === 'permit' ? 'Permit' : 'Deny',
            )
          : h('code', { class: 'ace' }, r.ace),
    },
  ]
  if (!standard) cols.push({ title: 'Protocol', key: 'protocol', width: 100, render: (r) => r.view?.protocol })
  cols.push({ title: 'Source', key: 'source', render: (r) => r.view?.source })
  if (!standard) {
    cols.push(
      { title: 'Destination', key: 'destination', render: (r) => r.view?.destination },
      { title: 'Options', key: 'options', width: 110, render: (r) => r.view?.options },
    )
  }
  cols.push({
    title: 'Actions',
    key: 'ops',
    width: 90,
    render: (e) =>
      h(
        NPopconfirm,
        { onPositiveClick: () => onDeleteEntry(acl, e) },
        {
          trigger: () => h(NButton, { size: 'small', text: true, type: 'error' }, () => 'Delete'),
          default: () => h('div', { class: 'confirm' }, deleteEntryText(acl, e)),
        },
      ),
  })
  return cols
}

// New List dialog

const showNewList = ref(false)
const newListNumber = ref<number | null>(null)
const submitting = ref(false)

function openNewList() {
  newListNumber.value = null
  showNewList.value = true
}

async function onCreateList() {
  const acl = newListNumber.value
  if (acl === null) {
    message.warning('Enter a list number, 1 to 199')
    return
  }
  submitting.value = true
  try {
    await mutate(() => createAcl(acl), `Access list ${acl} created`)
    selected.value = acl
    showNewList.value = false
  } catch {
    // keep the dialog open
  } finally {
    submitting.value = false
  }
}

// Add Entry dialog: a form, or the entry typed in the device's syntax ("Type the entry")

const showAddEntry = ref(false)
const entryAcl = ref(0)
const entryForm = ref<AceForm>(emptyAceForm())
const typeEntry = ref(false)
const entryAce = ref('')
/** Where the entry goes: a positionOptions() key. */
const entryPos = ref('end')

/** The list's entries as the page has them. */
const entryList = computed<AclEntry[]>(() => config.value?.acls[entryAcl.value] ?? [])
const positions = computed(() => positionOptions(entryList.value))
const positionSelect = computed(() =>
  positions.value.map((o) => ({
    label: o.seq === null ? `${o.label} · no free number` : `${o.label} · seq ${o.seq}`,
    value: o.key,
    disabled: o.seq === null,
  })),
)
const entrySeq = computed(() => positions.value.find((o) => o.key === entryPos.value)?.seq ?? null)

/** The entry as it would be sent: typed, or built by the form. */
const pendingAce = computed(() => (typeEntry.value ? entryAce.value.trim() : builtAce.value))
/** The list with the new entry in its place, for "Where it goes". */
const placed = computed(() => {
  const seq = entrySeq.value ?? Infinity
  const rows = entryList.value.map((e) => ({ ...e, isNew: false }))
  const at = rows.findIndex((e) => e.seq > seq)
  const row = { seq: entrySeq.value ?? 0, ace: pendingAce.value || '…', isNew: true }
  if (at < 0) rows.push(row)
  else rows.splice(at, 0, row)
  return rows
})
/** An earlier entry that already matches everything the new one would. */
const shadowedBy = computed(() =>
  entrySeq.value === null ? null : shadowingEntry(entryList.value, pendingAce.value, entrySeq.value, entryStandard.value),
)
const veryBroad = computed(() => isVeryBroad(pendingAce.value, entryStandard.value))

/** Destination port shortcuts; the number field takes any other port. */
const portChips: [string, number | null][] = [
  ['Any port', null],
  ['SSH 22', 22],
  ['DNS 53', 53],
  ['HTTP 80', 80],
  ['HTTPS 443', 443],
  ['Console 8443', 8443],
]
const chipOn = (port: number | null) => {
  const d = entryForm.value.dstPort
  return port === null ? d.op === 'any' : d.op === 'eq' && d.port === port
}
function setDstPort(port: number | null) {
  entryForm.value.dstPort = port === null ? { op: 'any', port: null, to: null } : { op: 'eq', port, to: null }
}

const protocolOptions: { label: string; value: AceProtocol }[] = [
  { label: 'IP (any protocol)', value: 'ip' },
  { label: 'TCP', value: 'tcp' },
  { label: 'UDP', value: 'udp' },
  { label: 'ICMP', value: 'icmp' },
  { label: 'Other (by number)', value: 'other' },
]

const entryStandard = computed(() => isStandard(entryAcl.value))
const entryPorts = computed(() => !entryStandard.value && hasPorts(entryForm.value.protocol))
/** What the form sends, as the preview shows it. */
const builtAce = computed(() => buildAce(entryForm.value, entryStandard.value))

function openAddEntry(acl: number) {
  entryAcl.value = acl
  entryForm.value = emptyAceForm(isStandard(acl))
  typeEntry.value = false
  entryAce.value = ''
  entryPos.value = positions.value.at(-1)?.seq === null
    ? ([...positions.value].reverse().find((o) => o.seq !== null)?.key ?? 'end')
    : 'end'
  showAddEntry.value = true
}

/** Switching to typing starts from what the form has built so far. */
function onTypeEntry(on: boolean) {
  typeEntry.value = on
  if (on && !entryAce.value.trim()) entryAce.value = builtAce.value
}

/** A protocol number the device names is chosen by its name instead; 0 is refused on OK. */
function onProtoNumber(n: number | null) {
  // the input also reports its value as it goes away, after a switch
  if (entryForm.value.protocol !== 'other') return
  const named = n === null ? undefined : NAMED_PROTOCOLS[n]
  if (named) {
    onProtocol(named)
    entryForm.value.protoNumber = null
    message.info(`Protocol ${n} is ${named.toUpperCase()}; switched to ${named.toUpperCase()}`)
    return
  }
  entryForm.value.protoNumber = n
}

function onProtocol(p: AceProtocol) {
  const f = entryForm.value
  f.protocol = p
  if (f.match === 'established' && p !== 'tcp') f.match = 'all'
  if (f.match === 'reply' && !hasPorts(p)) f.match = 'all'
}

async function onAddEntry() {
  let ace: string
  if (typeEntry.value) {
    ace = entryAce.value.trim()
    if (!ace) {
      message.warning('Enter the entry, for example "permit tcp any any eq 22"')
      return
    }
  } else {
    const f = entryForm.value
    if (entryPorts.value && f.dstPort.op === 'eq' && f.dstPort.port === null) {
      message.warning('Choose a destination port: one of the buttons, Any port, or a number')
      return
    }
    const errors = aceFormErrors(f, entryStandard.value)
    if (errors.length) {
      message.warning(errors[0])
      return
    }
    ace = builtAce.value
  }
  const acl = entryAcl.value
  const seq = entrySeq.value
  if (seq === null) {
    message.warning('Choose where the entry goes')
    return
  }
  submitting.value = true
  try {
    await mutate(() => addAclEntry(acl, ace, seq), `Entry added to list ${acl}`)
    showAddEntry.value = false
  } catch {
    // keep the dialog open, with what was entered
  } finally {
    submitting.value = false
  }
}

// ---------- interfaces ----------

type IfaceRow = { name: string; acls_in: number[] }

// Removing a list stops filtering, the safe direction: a plain confirm. Applying one is where the
// warnings are (onApply).
function onUnbind(iface: string, acl: number) {
  dialog.info({
    title: 'Remove list',
    content: `Stop applying access list ${acl} on ${iface}? ${iface} stops filtering by it.`,
    positiveText: 'Remove',
    negativeText: 'Cancel',
    onPositiveClick: () => mutate(() => unbindAcl(iface, acl), `${iface} no longer applies list ${acl}`).catch(() => {}),
  })
}

async function onDeleteInterface(iface: string) {
  await mutate(() => deleteInterface(iface), `${iface}'s configuration deleted`).catch(() => {})
}

function ifaceStatus(name: string) {
  const e = engine.value
  if (e?.missing?.includes(name)) return h(NTag, { size: 'small', type: 'warning' }, () => 'Not on this device')
  if (e?.live && e.attached?.includes(name)) return h(NTag, { size: 'small', type: 'success' }, () => 'Filtered')
  return null
}

const ifaceColumns: DataTableColumns<IfaceRow> = [
  {
    title: 'Interface',
    key: 'name',
    render: (r) => h(NSpace, { size: 8, align: 'center' }, () => [h('span', r.name), ifaceStatus(r.name)]),
  },
  {
    title: 'Lists applied (incoming)',
    key: 'acls_in',
    render: (r) =>
      r.acls_in.length
        ? h(NSpace, { size: 4 }, () =>
            r.acls_in.map((acl) =>
              h(NTag, { size: 'small', closable: true, onClose: () => onUnbind(r.name, acl) }, () => `${acl} (${kindLabel(acl).toLowerCase()})`),
            ),
          )
        : h('span', { class: 'muted' }, 'None'),
  },
  {
    title: 'Actions',
    key: 'ops',
    width: 160,
    render: (r) =>
      h(NSpace, { size: 4 }, () => [
        h(NButton, { size: 'small', text: true, type: 'primary', onClick: () => openApply(r.name) }, () => 'Apply List'),
        h(
          NPopconfirm,
          { onPositiveClick: () => onDeleteInterface(r.name) },
          {
            trigger: () => h(NButton, { size: 'small', text: true, type: 'error' }, () => 'Delete'),
            default: () => `Delete ${r.name}'s configuration? It stops applying its lists.`,
          },
        ),
      ]),
  },
]

// Apply List dialog

const showApply = ref(false)
const applyIface = ref('')
const applyAcl = ref<number | null>(null)
const aclOptions = computed(() => aclNumbers.value.map((n) => ({ label: `${n} (${kindLabel(n).toLowerCase()})`, value: n })))

function openApply(iface = '') {
  applyIface.value = iface
  applyAcl.value = null
  showApply.value = true
}

async function onApply() {
  const iface = applyIface.value.trim()
  const acl = applyAcl.value
  if (!iface || acl === null) {
    message.warning('Enter an interface and choose a list')
    return
  }
  if (isStandard(acl)) {
    await bind(iface, acl)
    return
  }
  // A bound extended list drops all incoming traffic it doesn't permit, even when it is empty
  // (mini-fw), and that includes the browser's own connection to this console.
  const entries = config.value?.acls[acl]?.length ?? 0
  const port = location.port || '443'
  dialog.warning({
    title: entries ? 'Apply an extended list' : 'Apply an empty list',
    content: () =>
      h('div', { class: 'confirm' }, [
        h(
          'p',
          entries
            ? `${iface} will drop all incoming traffic that list ${acl} doesn't permit. That includes this web ` +
                `console's connection (TCP port ${port}) if it arrives on ${iface} and the list doesn't permit it.`
            : `List ${acl} has no entries. Applying it drops ALL incoming traffic on ${iface}, including this web ` +
                `console's connection if it arrives on ${iface}.`,
        ),
        h(
          'p',
          'The change is in effect at once but not saved: if it cuts off your access, restarting the device ' +
            'restores the saved configuration.',
        ),
      ]),
    positiveText: entries ? 'Apply' : 'Apply anyway',
    negativeText: 'Cancel',
    onPositiveClick: () => bind(iface, acl),
  })
}

async function bind(iface: string, acl: number) {
  submitting.value = true
  try {
    await mutate(() => bindAcl(iface, acl), `${iface} applies list ${acl}`)
    showApply.value = false
  } catch {
    // keep the dialog open
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <NResult
    v-if="!isAdmin"
    status="403"
    title="Administrators only"
    description="Viewing and changing the access lists needs an administrator account."
  />

  <NSpace v-else vertical :size="16">
    <!-- ACL engine -->
    <NCard title="ACL Engine" size="small">
      <template #header-extra>
        <NSpace v-if="engine" align="center" :size="8">
          <NTag :type="stateInfo[engine.state].type">{{ stateInfo[engine.state].label }}</NTag>
          <span class="muted">since {{ fmtTime(engine.since) }}</span>
        </NSpace>
      </template>
      <NAlert v-if="engineError && !engine" type="error" :bordered="false">
        Can't get the engine's state: {{ engineError }}
      </NAlert>
      <template v-else-if="engine">
        <p class="engine-text">{{ stateInfo[engine.state].text }}</p>
        <NAlert v-if="engine.state === 'refused' && engine.error" type="error" :bordered="false" class="gap">
          {{ engine.error }}
        </NAlert>
        <NAlert v-if="engine.missing?.length" type="warning" :bordered="false" class="gap">
          {{ engine.missing.join(', ') }} {{ engine.missing.length === 1 ? 'applies' : 'apply' }} a list but
          {{ engine.missing.length === 1 ? "doesn't" : "don't" }} exist on this device.
        </NAlert>
        <NSpace v-if="engine.live && engine.counters" :size="48">
          <NStatistic v-for="(v, k) in engine.counters" :key="k" :label="counterLabels[k] ?? k" :value="fmt(v)" />
          <NStatistic label="Interfaces filtered" :value="engine.attached?.length ? engine.attached.join(', ') : 'None'" />
        </NSpace>
        <p v-else-if="engine.state !== 'off'" class="muted">The engine didn't answer just now; no counters.</p>
        <p v-if="engineError" class="muted">Last refresh failed: {{ engineError }}</p>
      </template>
    </NCard>

    <!-- access lists -->
    <NCard title="Access Lists" size="small">
      <template #header-extra>
        <NButton type="primary" size="small" @click="openNewList">New List</NButton>
      </template>
      <NAlert type="info" :bordered="false" class="gap">
        Within a list, entries are checked in sequence order, lowest first; the first match decides. Lists 1 to 99 are
        standard: they match the source address, and only drop what they deny. Lists 100 to 199 are extended
        (protocol, addresses, ports), checked after the standard list, and drop what matches no entry. A list does
        nothing until an interface applies it. Changes take effect at once but are not saved until you click Save
        Config: if a change cuts off your access, restarting the device restores the saved configuration.
      </NAlert>
      <NEmpty v-if="!loading && config && !aclNumbers.length" description="No access lists yet" />
      <NTabs v-else :value="selected ?? undefined" type="line" animated @update:value="(v: number | string) => (selected = v as number | typeof POLICY_TAB)">
        <NTabPane v-for="acl in aclNumbers" :key="acl" :name="acl" :tab="String(acl)">
          <NSpace justify="space-between" align="center" class="gap">
            <span class="muted">
              {{ kindLabel(acl) }} list ·
              <template v-if="appliedOn(acl).length">applied on {{ appliedOn(acl).join(', ') }}</template>
              <template v-else>not applied to any interface</template>
            </span>
            <NSpace :size="8">
              <NButton size="small" type="primary" @click="openAddEntry(acl)">Add Entry</NButton>
              <NPopconfirm @positive-click="onDeleteAcl(acl)">
                <template #trigger>
                  <NButton size="small" type="error" ghost>Delete List</NButton>
                </template>
                Delete access list {{ acl }} and all its entries?
              </NPopconfirm>
            </NSpace>
          </NSpace>
          <NDataTable
            :columns="entryColumns(acl)"
            :data="entryRows(acl)"
            :loading="loading"
            :row-key="(e: EntryRow) => e.seq"
            size="small"
          />
        </NTabPane>
        <NTabPane v-if="config" :name="POLICY_TAB" tab="Effective Policy">
          <EffectivePolicy :config="config" />
        </NTabPane>
      </NTabs>
    </NCard>

    <!-- interfaces -->
    <NCard title="Interfaces" size="small">
      <template #header-extra>
        <NButton type="primary" size="small" :disabled="!aclNumbers.length" @click="openApply()">Apply List</NButton>
      </template>
      <NDataTable
        :columns="ifaceColumns"
        :data="interfaces"
        :loading="loading"
        :row-key="(r: IfaceRow) => r.name"
        size="small"
      />
    </NCard>
  </NSpace>

  <NModal v-model:show="showNewList" preset="card" title="New List" style="width: 440px" :mask-closable="false">
    <NForm label-placement="left" label-width="80">
      <NFormItem label="Number">
        <div class="field">
          <NInputNumber v-model:value="newListNumber" :min="1" :max="199" placeholder="1 to 199" style="width: 100%" />
          <div class="field-hint">1 to 99: standard (source address). 100 to 199: extended (protocol, addresses, ports).</div>
        </div>
      </NFormItem>
    </NForm>
    <template #footer>
      <NSpace justify="end">
        <NButton @click="showNewList = false">Cancel</NButton>
        <NButton type="primary" :loading="submitting" @click="onCreateList">OK</NButton>
      </NSpace>
    </template>
  </NModal>

  <NModal
    v-model:show="showAddEntry"
    preset="card"
    :title="`Add Entry to List ${entryAcl} (${kindLabel(entryAcl).toLowerCase()})`"
    style="width: 1020px; max-width: calc(100vw - 32px)"
    :mask-closable="false"
  >
    <div class="add-entry">
    <NForm label-placement="left" label-width="110" class="add-form">
      <template v-if="!typeEntry">
        <NFormItem label="Action">
          <NRadioGroup v-model:value="entryForm.action">
            <NRadioButton value="permit">Permit</NRadioButton>
            <NRadioButton value="deny">Deny</NRadioButton>
          </NRadioGroup>
        </NFormItem>
        <NFormItem v-if="!entryStandard" label="Protocol">
          <NSpace :size="8" :wrap="false">
            <NSelect
              :value="entryForm.protocol"
              :options="protocolOptions"
              style="width: 200px"
              @update:value="onProtocol"
            />
            <NInputNumber
              v-if="entryForm.protocol === 'other'"
              :value="entryForm.protoNumber"
              :min="0" :max="255"
              :show-button="false"
              :update-value-on-input="false"
              @update:value="onProtoNumber"
              placeholder="0 to 255"
              style="width: 110px"
            />
          </NSpace>
        </NFormItem>
        <NFormItem label="Source">
          <AceAddrInput v-model="entryForm.src" />
        </NFormItem>
        <NFormItem v-if="entryPorts" label="Source port">
          <AcePortInput v-model="entryForm.srcPort" />
        </NFormItem>
        <template v-if="!entryStandard">
          <NFormItem label="Destination">
            <AceAddrInput v-model="entryForm.dst" />
          </NFormItem>
          <NFormItem v-if="entryPorts" label="Destination port">
            <NSpace :size="6" align="center">
              <NButton
                v-for="[label, port] in portChips"
                :key="label"
                size="small"
                :type="chipOn(port) ? 'primary' : 'default'"
                :secondary="!chipOn(port)"
                @click="setDstPort(port)"
              >
                {{ label }}
              </NButton>
              <NInputNumber
                :value="entryForm.dstPort.op === 'eq' ? entryForm.dstPort.port : null"
                :min="1" :max="65535"
                :show-button="false"
                size="small"
                placeholder="Other port"
                style="width: 110px"
                @update:value="(p: number | null) => (entryForm.dstPort = { op: 'eq', port: p, to: null })"
              />
            </NSpace>
          </NFormItem>
          <NFormItem v-if="entryPorts" label="Match">
            <NRadioGroup v-model:value="entryForm.match">
              <NSpace vertical :size="4">
                <NRadio value="all">All packets</NRadio>
                <NRadio v-if="entryForm.protocol === 'tcp'" value="established">
                  Established connections only (packets with ACK or RST)
                </NRadio>
                <NRadio value="reply">Replies to connections this device opened</NRadio>
              </NSpace>
            </NRadioGroup>
          </NFormItem>
        </template>
      </template>
      <NFormItem v-else label="Entry">
        <div class="field">
          <NInput
            v-model:value="entryAce"
            :placeholder="entryStandard ? 'deny host 203.0.113.66' : 'permit tcp any any eq 22'"
            class="ace-input"
          />
          <div v-if="entryStandard" class="field-hint">
            permit or deny, then a source: <code>any</code>, <code>host 203.0.113.66</code> or
            <code>198.51.100.0/24</code>.
          </div>
          <div v-else class="field-hint">
            permit or deny, a protocol, a source and a destination, for example
            <code>permit tcp 192.168.1.0/24 any eq 22</code> or <code>deny ip host 203.0.113.66 any</code>.
          </div>
        </div>
      </NFormItem>
      <NFormItem label="Position">
        <div class="field">
          <NSelect v-model:value="entryPos" :options="positionSelect" />
          <div class="field-hint">Entries are checked from the top; the first that matches decides.</div>
        </div>
      </NFormItem>
      <NFormItem v-if="!typeEntry" label="Entry">
        <code class="ace preview">{{ builtAce }}</code>
      </NFormItem>
    </NForm>

    <div class="where">
      <div class="where-title">Where it goes in list {{ entryAcl }}</div>
      <ol class="where-list">
        <li v-for="e in placed" :key="e.isNew ? 'new' : e.seq" :class="{ 'is-new': e.isNew }">
          <span class="where-seq">{{ e.isNew ? (entrySeq ?? '–') : e.seq }}</span>
          <code class="ace">{{ e.ace }}</code>
          <NTag v-if="e.isNew" size="tiny" type="info">new</NTag>
        </li>
        <li class="implicit">
          <span class="where-seq"></span>
          <span>Anything else → {{ entryStandard ? 'go on to the extended list' : 'drop (implicit)' }}</span>
        </li>
      </ol>
      <NAlert v-if="shadowedBy" type="warning" :bordered="false" title="This entry will never match" class="where-warn">
        Entry {{ shadowedBy.seq }} (<code>{{ shadowedBy.ace }}</code>) comes first and already matches every packet this
        one would. Put the new entry above it, or narrow entry {{ shadowedBy.seq }}.
      </NAlert>
      <NAlert v-if="veryBroad" type="warning" :bordered="false" title="Very broad" class="where-warn">
        This permits all traffic from any source to any destination on every port. Entries after it never match, and
        the implicit deny no longer applies.
      </NAlert>
    </div>
    </div>
    <template #footer>
      <NSpace justify="space-between" align="center">
        <NSpace :size="8" align="center">
          <NSwitch :value="typeEntry" size="small" @update:value="onTypeEntry" />
          <span class="muted">Type the entry</span>
        </NSpace>
        <NSpace>
          <NButton @click="showAddEntry = false">Cancel</NButton>
          <NButton type="primary" :loading="submitting" @click="onAddEntry">OK</NButton>
        </NSpace>
      </NSpace>
    </template>
  </NModal>

  <NModal v-model:show="showApply" preset="card" title="Apply List" style="width: 480px" :mask-closable="false">
    <NForm label-placement="left" label-width="80">
      <NFormItem label="Interface">
        <NInput v-model:value="applyIface" placeholder="For example eth0" />
      </NFormItem>
      <NFormItem label="List">
        <div class="field">
          <NSelect v-model:value="applyAcl" :options="aclOptions" placeholder="Choose a list" />
          <div class="field-hint">
            Applied to incoming traffic. An interface applies at most one standard and one extended list; this replaces
            the one of the same kind.
          </div>
        </div>
      </NFormItem>
    </NForm>
    <template #footer>
      <NSpace justify="end">
        <NButton @click="showApply = false">Cancel</NButton>
        <NButton type="primary" :loading="submitting" @click="onApply">OK</NButton>
      </NSpace>
    </template>
  </NModal>
</template>

<style scoped>
.gap {
  margin-bottom: 12px;
}
.muted {
  color: #888;
}
.engine-text {
  margin: 0 0 12px;
}
.field {
  width: 100%;
}
.field-hint {
  margin-top: 4px;
  font-size: 12px;
  color: #888;
}
.add-entry {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}
.add-form {
  flex: 1 1 520px;
  min-width: 0;
}
.where {
  flex: 1 1 320px;
  min-width: 0;
}
.where-title {
  font-weight: 600;
  margin-bottom: 8px;
}
.where-list {
  list-style: none;
  margin: 0 0 12px;
  padding: 0;
  font-size: 13px;
}
.where-list li {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 3px 6px;
  border-radius: 3px;
}
.where-list li.is-new {
  background: rgba(32, 128, 240, 0.12);
  box-shadow: inset 3px 0 0 #2080f0;
}
.where-list li.implicit {
  font-style: italic;
  color: #888;
}
.where-seq {
  width: 44px;
  flex: none;
  color: #888;
  text-align: right;
}
.where-warn {
  margin-top: 8px;
}
.confirm p {
  margin: 0 0 8px;
}
.confirm {
  max-width: 360px;
}
.preview {
  padding: 4px 8px;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.12);
  word-break: break-all;
}
.ace,
.ace-input :deep(input) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
