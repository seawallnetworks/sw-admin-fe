<script setup lang="ts">
// reply_miss and its samples (Seawall proposal 0015 §7): packets that looked like replies to this device's
// own connections but matched none sw_flowd recorded, and that an extended list dropped. When a tool on the
// device stopped working, a line for its server says replies are why.
import { computed } from 'vue'
import { NCollapse, NCollapseItem, NDataTable, NEmpty } from 'naive-ui'
import type { DataTableColumns } from 'naive-ui'
import type { AclEngine } from '../types'
import { missRow, type MissRow } from '../misses'

const props = defineProps<{ engine: AclEngine }>()

const count = computed(() => props.engine.counters?.reply_miss ?? 0)
const fmtTime = (ms: number) =>
  new Date(ms).toLocaleString('en-US', { hourCycle: 'h23' }) + `.${String(ms % 1000).padStart(3, '0')}`
const rows = computed(() => (props.engine.reply_misses ?? []).map((m, i) => missRow(m, i, fmtTime)))
/** sw_configd gives no samples when mfwd didn't: then say so, not "none" */
const empty = computed(() =>
  props.engine.reply_misses === undefined
    ? "The packets aren't available: the device couldn't get them from mfwd."
    : 'None dropped since mfwd started.',
)

const columns: DataTableColumns<MissRow> = [
  { title: 'Time', key: 'time', width: 210 },
  { title: 'Interface', key: 'iface', width: 100 },
  { title: 'Protocol', key: 'proto', width: 80 },
  { title: 'From', key: 'from' },
  { title: 'To', key: 'to' },
  { title: '', key: 'detail' },
]
</script>

<template>
  <NCollapse class="misses">
    <NCollapseItem name="misses">
      <template #header>
        Replies dropped for want of a connection: {{ count.toLocaleString('en-US') }}
      </template>
      <p class="muted">
        Packets that looked like replies to this device's own connections (TCP with ACK or RST, UDP to a port
        replies come back to, an echo reply, an ICMP error) but matched none it opened, and that an extended list
        dropped; the newest 16, all interfaces. When a tool on the device stopped working, a line for its server
        says replies are why: the connection was opened before sw_flowd started, left by an interface sw_flowd
        doesn't record on, or was sent from a fixed UDP port sw_flowd doesn't record. Lines from addresses the
        device never talked to are scans and forged packets, dropped as they should be.
      </p>
      <NDataTable
        v-if="rows.length"
        :columns="columns"
        :data="rows"
        :row-key="(r: MissRow) => r.key"
        size="small"
        :bordered="false"
      />
      <NEmpty v-else size="small" :description="empty" />
    </NCollapseItem>
  </NCollapse>
</template>

<style scoped>
.misses {
  margin-top: 16px;
}
.muted {
  color: var(--text-muted, #888);
  margin: 0 0 8px;
}
</style>
