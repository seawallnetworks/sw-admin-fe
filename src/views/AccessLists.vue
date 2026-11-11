<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, ref } from 'vue'
import {
  NAlert, NButton, NCard, NDataTable, NEmpty, NForm, NFormItem, NInput, NInputNumber, NModal, NPopconfirm, NResult,
  NSelect, NSpace, NStatistic, NTabPane, NTabs, NTag, useDialog, useMessage, type DataTableColumns,
} from 'naive-ui'
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
/** The list whose tab is open. */
const selected = ref<number | null>(null)

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
    config.value = (await getConfig()).config
    if (selected.value === null || !aclNumbers.value.includes(selected.value)) {
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

async function onDeleteEntry(acl: number, e: AclEntry) {
  await mutate(() => deleteAclEntry(acl, e.seq), `Entry ${e.seq} deleted`).catch(() => {})
}

const entryColumns = (acl: number): DataTableColumns<AclEntry> => [
  { title: 'Seq', key: 'seq', width: 90 },
  { title: 'Entry', key: 'ace', render: (e) => h('code', { class: 'ace' }, e.ace) },
  {
    title: 'Actions',
    key: 'ops',
    width: 90,
    render: (e) =>
      h(
        NPopconfirm,
        { onPositiveClick: () => onDeleteEntry(acl, e) },
        {
          trigger: () => h(NButton, { size: 'small', text: true, type: 'error' }, () => 'Delete'),
          default: () => `Delete entry ${e.seq} "${e.ace}"?`,
        },
      ),
  },
]

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

// Add Entry dialog

const showAddEntry = ref(false)
const entryAcl = ref(0)
const entryAce = ref('')
const entrySeq = ref<number | null>(null)

function openAddEntry(acl: number) {
  entryAcl.value = acl
  entryAce.value = ''
  entrySeq.value = null
  showAddEntry.value = true
}

async function onAddEntry() {
  const ace = entryAce.value.trim()
  if (!ace) {
    message.warning('Enter the entry, for example "permit tcp any any eq 22"')
    return
  }
  const acl = entryAcl.value
  submitting.value = true
  try {
    await mutate(() => addAclEntry(acl, ace, entrySeq.value ?? undefined), `Entry added to list ${acl}`)
    showAddEntry.value = false
  } catch {
    // keep the dialog open, with what was typed
  } finally {
    submitting.value = false
  }
}

// ---------- interfaces ----------

type IfaceRow = { name: string; acls_in: number[] }

function onUnbind(iface: string, acl: number) {
  dialog.warning({
    title: 'Remove list',
    content: `Stop applying access list ${acl} on ${iface}?`,
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
        nothing until an interface applies it. Changes take effect at once; click Save Config to keep them after a
        restart.
      </NAlert>
      <NEmpty v-if="!loading && config && !aclNumbers.length" description="No access lists yet" />
      <NTabs v-else :value="selected ?? undefined" type="line" animated @update:value="(v: number) => (selected = v)">
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
            :data="config?.acls[acl] ?? []"
            :loading="loading"
            :row-key="(e: AclEntry) => e.seq"
            size="small"
          />
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
    :title="`Add Entry to List ${entryAcl}`"
    style="width: 560px"
    :mask-closable="false"
  >
    <NForm label-placement="left" label-width="80">
      <NFormItem label="Entry">
        <div class="field">
          <NInput
            v-model:value="entryAce"
            :placeholder="isStandard(entryAcl) ? 'deny host 203.0.113.66' : 'permit tcp any any eq 22'"
            class="ace-input"
          />
          <div v-if="isStandard(entryAcl)" class="field-hint">
            permit or deny, then a source: <code>any</code>, <code>host 203.0.113.66</code> or
            <code>198.51.100.0 0.0.0.255</code>.
          </div>
          <div v-else class="field-hint">
            permit or deny, a protocol, a source and a destination, for example
            <code>permit tcp 192.168.1.0 0.0.0.255 any eq 22</code> or <code>deny ip host 203.0.113.66 any</code>.
          </div>
        </div>
      </NFormItem>
      <NFormItem label="Seq">
        <div class="field">
          <NInputNumber v-model:value="entrySeq" :min="1" :max="65535" clearable placeholder="After the last entry" style="width: 100%" />
          <div class="field-hint">1 to 65535; lower is checked first. Leave empty to add after the last entry.</div>
        </div>
      </NFormItem>
    </NForm>
    <template #footer>
      <NSpace justify="end">
        <NButton @click="showAddEntry = false">Cancel</NButton>
        <NButton type="primary" :loading="submitting" @click="onAddEntry">OK</NButton>
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
.ace,
.ace-input :deep(input) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
</style>
