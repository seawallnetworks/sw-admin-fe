<script setup lang="ts">
// The console's events (Seawall proposal 0012 §3, §4): audit records, blocks, state changes and alerts,
// from sw_logd, a page at a time, newest first. Not polled: the user asks with Refresh, a filter or
// "Load more".
import { computed, h, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  NButton, NCard, NDataTable, NInput, NSelect, NSpace, NTab, NTabs, NTag, NTooltip, type DataTableColumns,
} from 'naive-ui'
import DiagBundle from '../components/DiagBundle.vue'
import { fetchEvents, getRole, type Alert, type AuditRecord, type BlockRecord, type ChangeRecord, type EventLists } from '../api'
import {
  RANGES, blockNetwork, blockOrigin, blockState, changeText, changeWho, conditionLabel, fmtDateTime, rangeSince,
  reasonLabel, severityLabel, severityType, type RangeKey,
} from '../events'

/** Every event list but attacks, which are the DDoS Protection page's (proposal 0017). */
type Tab = Exclude<keyof EventLists, 'attacks'>
const TABS: { key: Tab; label: string }[] = [
  { key: 'audit', label: 'Audit' },
  { key: 'blocks', label: 'Blocks' },
  { key: 'changes', label: 'State Changes' },
  { key: 'alerts', label: 'Alerts' },
]
const PAGE = 100

const isAdmin = getRole() === 'admin'
const route = useRoute()
const router = useRouter()

/** The tab the URL names (?tab=), or Audit. */
const tabOf = (q: unknown): Tab => (TABS.some((t) => t.key === q) ? (q as Tab) : 'audit')
const tab = ref<Tab>(tabOf(route.query.tab))
const range = ref<RangeKey>('24h')
const filters = reactive({ severity: '', user: '', network: '', source: '', kind: '' })

/** The tab's records; each tab's columns know their type. */
type Row = Record<string, unknown>
const rows = ref<Row[]>([])
const next = ref<number | null>(null)
const loading = ref(false)
/** `since` of the shown pages: "Load more" keeps it, so the pages fit together. */
let since = 0
/** Bumped by every new search, so a late reply for an older one is dropped. */
let generation = 0

const rangeOptions = RANGES.map((r) => ({ label: r.label, value: r.key }))
const severityOptions = [
  { label: 'Any severity', value: '' },
  { label: 'Warning and above', value: 'warning' },
  { label: 'Critical', value: 'critical' },
]
const kindOptions = [
  { label: 'Any kind', value: '' },
  { label: 'Changes and refusals', value: 'admin' },
  { label: 'Logins', value: 'login' },
]
const sourceOptions = [
  { label: 'Any source', value: '' },
  { label: 'DDoS gate', value: 'voidgate' },
  { label: 'Firewall', value: 'mfwd' },
]

/** The filters this tab's list takes, as the query has them. */
function query(before?: number) {
  const q: Record<string, string | number | undefined> = { since, limit: PAGE, before }
  const f = filters
  if (tab.value !== 'blocks' && f.severity) q.severity = f.severity
  if (tab.value === 'audit') Object.assign(q, { user: f.user.trim(), kind: f.kind })
  if (tab.value === 'blocks') q.network = f.network.trim()
  if (tab.value === 'changes') q.source = f.source
  return q
}

async function load(more = false) {
  const mine = more ? generation : ++generation
  if (!more) {
    since = rangeSince(range.value, Date.now())
    rows.value = []
    next.value = null
  }
  loading.value = true
  try {
    const page = await fetchEvents(tab.value, { ...query(more ? (next.value ?? undefined) : undefined), since })
    if (mine !== generation) return
    const records = page.records as unknown as Row[]
    rows.value = more ? [...rows.value, ...records] : records
    next.value = page.next
  } catch {
    // api.ts showed it
  } finally {
    if (mine === generation) loading.value = false
  }
}

watch([tab, range, () => filters.severity, () => filters.kind, () => filters.source], () => load(), { immediate: true })
watch(tab, (t) => {
  if (route.query.tab !== t) router.replace({ query: { ...route.query, tab: t } })
})
// a link to another tab while this page is open, such as the alert banner's
watch(
  () => route.query.tab,
  (q) => {
    if (q !== undefined && tabOf(q) !== tab.value) tab.value = tabOf(q)
  },
)

// ---------- columns ----------

const sevTag = (s: string) => h(NTag, { type: severityType(s), size: 'small' }, () => severityLabel(s))
const outOfBand = () =>
  h(NTooltip, null, {
    trigger: () => h(NTag, { type: 'warning', size: 'small', style: 'margin-left: 6px' }, () => 'Out of band'),
    default: () => 'Made outside the console and the CLI, with the component\'s own tool',
  })
const truncatedTag = () =>
  h(NTooltip, null, {
    trigger: () => h(NTag, { size: 'small', style: 'margin-left: 6px' }, () => 'Truncated'),
    default: () => 'A field was too long and was cut; it ends with how many bytes were cut',
  })
const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '-' : String(v))

const auditColumns: DataTableColumns<AuditRecord> = [
  { title: 'Time', key: 'time', width: 190, render: (r) => fmtDateTime(r.time) },
  { title: 'Severity', key: 'severity', width: 100, render: (r) => sevTag(r.severity) },
  { title: 'User', key: 'user', render: (r) => dash(r.user) },
  { title: 'From', key: 'entry', render: (r) => [r.entry, r.client].filter(Boolean).join(', ') || '-' },
  { title: 'Operation', key: 'op', render: (r) => dash(r.op) },
  { title: 'Object', key: 'object', render: (r) => dash(r.object) },
  {
    title: 'Result',
    key: 'result',
    render: (r) => [r.count > 0 ? `${r.count} more, summarized` : dash(r.result), r.truncated ? truncatedTag() : null],
  },
]

const blockColumns: DataTableColumns<BlockRecord> = [
  {
    title: 'Started',
    key: 'started',
    width: 210,
    render: (r) => (r.started_after_gap ? `${fmtDateTime(r.started)} or earlier` : fmtDateTime(r.started)),
  },
  { title: 'Network', key: 'network', render: blockNetwork },
  { title: 'Reason', key: 'reason', render: (r) => reasonLabel(r.reason) },
  { title: 'Asked by', key: 'origin', render: (r) => [blockOrigin(r), r.out_of_band ? outOfBand() : null] },
  {
    title: 'State',
    key: 'ended',
    render: (r) => (r.ended === null ? blockState(r) : `${blockState(r)}, ${fmtDateTime(r.ended)}`),
  },
]

const changeColumns: DataTableColumns<ChangeRecord> = [
  { title: 'Time', key: 'time', width: 190, render: (r) => fmtDateTime(r.time) },
  { title: 'Severity', key: 'severity', width: 100, render: (r) => sevTag(r.severity) },
  { title: 'What', key: 'op', render: changeText },
  { title: 'By', key: 'user', render: (r) => [changeWho(r), r.out_of_band ? outOfBand() : null] },
]

const alertColumns: DataTableColumns<Alert> = [
  { title: 'Raised', key: 'raised', width: 190, render: (r) => fmtDateTime(r.raised) },
  { title: 'Severity', key: 'severity', width: 100, render: (r) => sevTag(r.severity) },
  { title: 'Condition', key: 'condition', render: (r) => conditionLabel(r.condition) },
  { title: 'Message', key: 'message' },
  { title: 'Cleared', key: 'cleared', width: 190, render: (r) => (r.cleared ? fmtDateTime(r.cleared) : 'Open') },
]

const columns = computed(
  () =>
    ({ audit: auditColumns, blocks: blockColumns, changes: changeColumns, alerts: alertColumns })[
      tab.value
    ] as unknown as DataTableColumns<Row>,
)
</script>

<template>
  <NCard>
    <NTabs v-model:value="tab" type="line">
      <NTab v-for="t in TABS" :key="t.key" :name="t.key">{{ t.label }}</NTab>
    </NTabs>

    <NSpace align="center" class="filters">
      <NSelect v-model:value="range" :options="rangeOptions" style="width: 160px" />
      <NSelect
        v-if="tab !== 'blocks'"
        v-model:value="filters.severity"
        :options="severityOptions"
        style="width: 190px"
      />
      <template v-if="tab === 'audit'">
        <NSelect v-model:value="filters.kind" :options="kindOptions" style="width: 200px" />
        <NInput v-model:value="filters.user" placeholder="User" clearable style="width: 160px" @keyup.enter="load()" @clear="load()" />
      </template>
      <NInput
        v-if="tab === 'blocks'"
        v-model:value="filters.network"
        placeholder="Network, e.g. 203.0.113.0/24"
        clearable
        style="width: 240px"
        @keyup.enter="load()"
        @clear="load()"
      />
      <NSelect v-if="tab === 'changes'" v-model:value="filters.source" :options="sourceOptions" style="width: 160px" />
      <NButton :loading="loading" @click="load()">Refresh</NButton>
    </NSpace>

    <NDataTable :columns="columns" :data="rows" :loading="loading" size="small" :bordered="false" />

    <div v-if="next !== null" class="more">
      <NButton :loading="loading" @click="load(true)">Load more</NButton>
    </div>
  </NCard>

  <DiagBundle v-if="isAdmin" class="diag" />
</template>

<style scoped>
.diag {
  margin-top: 16px;
}
.filters {
  margin: 12px 0;
}
.more {
  display: flex;
  justify-content: center;
  margin-top: 12px;
}
</style>
