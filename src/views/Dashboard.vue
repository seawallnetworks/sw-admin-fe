<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { NCard, NDataTable, NGi, NGrid, NStatistic, NTag, type DataTableColumns } from 'naive-ui'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ComposeOption } from 'echarts/core'
import type { LineSeriesOption } from 'echarts/charts'
import type { GridComponentOption, LegendComponentOption, TooltipComponentOption } from 'echarts/components'
import { fetchDashboard, type BlockedEvent, type DashboardData, type EventType } from '../api'

use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const POLL_MS = 5000

const data = ref<DashboardData | null>(null)
const loading = ref(true)

// ---------- polling: every 5s, paused while the tab is hidden ----------

let timer: number | undefined
let inFlight = false
let stopped = false

async function poll() {
  window.clearTimeout(timer)
  timer = undefined
  if (inFlight) return
  inFlight = true
  try {
    data.value = await fetchDashboard()
  } catch {
    // api.ts already surfaced the error; keep polling
  } finally {
    inFlight = false
    loading.value = false
  }
  if (!document.hidden && !stopped) timer = window.setTimeout(poll, POLL_MS)
}

function onVisibilityChange() {
  if (document.hidden) {
    window.clearTimeout(timer)
    timer = undefined
  } else {
    poll()
  }
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChange)
  poll()
})
onUnmounted(() => {
  stopped = true
  window.clearTimeout(timer)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

// ---------- view ----------

const fmt = (n: number) => n.toLocaleString('en-US')
/** Epoch seconds as the browser's local time of day. */
const fmtTime = (t: number) => new Date(t * 1000).toLocaleTimeString('en-US', { hourCycle: 'h23' })

const eventTypeLabels: Record<EventType, string> = {
  acl_deny: 'ACL deny',
  syn_flood: 'SYN Flood',
  http_flood: 'HTTP Flood',
  cc: 'CC attack',
  brute_force: 'Brute force',
}
const actionLabels: Record<BlockedEvent['action'], string> = { drop: 'Drop' }

const chartOption = computed<
  ComposeOption<LineSeriesOption | GridComponentOption | LegendComponentOption | TooltipComponentOption>
>(() => {
  const t = data.value?.traffic ?? []
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Inbound', 'Dropped'], top: 0 },
    grid: { left: 60, right: 20, top: 36, bottom: 30 },
    xAxis: { type: 'category', boundaryGap: false, data: t.map((p) => fmtTime(p.time)) },
    yAxis: { type: 'value', name: 'pps' },
    series: [
      { name: 'Inbound', type: 'line', smooth: true, showSymbol: false, areaStyle: { opacity: 0.1 }, data: t.map((p) => p.inbound_pps) },
      { name: 'Dropped', type: 'line', smooth: true, showSymbol: false, color: '#d03050', data: t.map((p) => p.dropped_pps) },
    ],
  }
})

const eventColumns: DataTableColumns<BlockedEvent> = [
  { title: 'Time', key: 'time', width: 100, render: (e) => fmtTime(e.time) },
  { title: 'Source IP', key: 'src_ip' },
  // a value this build doesn't know yet is shown as it came
  { title: 'Type', key: 'type', render: (e) => eventTypeLabels[e.type] ?? e.type },
  { title: 'Target', key: 'target' },
  { title: 'Action', key: 'action', width: 80, render: (e) => actionLabels[e.action] ?? e.action },
]
</script>

<template>
  <NGrid :cols="4" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
    <NGi span="4 m:2 l:1">
      <NCard>
        <NStatistic label="Inbound (pps)" :value="data ? fmt(data.inbound_pps) : '-'" />
      </NCard>
    </NGi>
    <NGi span="4 m:2 l:1">
      <NCard>
        <NStatistic label="Dropped (pps)" :value="data ? fmt(data.dropped_pps) : '-'" />
      </NCard>
    </NGi>
    <NGi span="4 m:2 l:1">
      <NCard>
        <NStatistic label="Active ACL Rules" :value="data ? data.active_acl_rules : '-'" />
      </NCard>
    </NGi>
    <NGi span="4 m:2 l:1">
      <NCard>
        <NStatistic label="SYN Protection">
          <NTag v-if="data" :type="data.syn_protection ? 'success' : 'default'" size="large">
            {{ data.syn_protection ? 'On' : 'Off' }}
          </NTag>
          <span v-else>-</span>
        </NStatistic>
      </NCard>
    </NGi>

    <NGi span="4">
      <NCard title="Traffic">
        <VChart :option="chartOption" :loading="loading" autoresize style="height: 320px" />
      </NCard>
    </NGi>

    <NGi span="4">
      <NCard title="Recent Blocked Events">
        <NDataTable :columns="eventColumns" :data="data?.events ?? []" :loading="loading" size="small" :bordered="false" />
      </NCard>
    </NGi>
  </NGrid>
</template>
