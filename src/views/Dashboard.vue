<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NCard, NDataTable, NEmpty, NGi, NGrid, NStatistic, NTag, type DataTableColumns } from 'naive-ui'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ComposeOption } from 'echarts/core'
import type { LineSeriesOption } from 'echarts/charts'
import type { GridComponentOption, LegendComponentOption, TooltipComponentOption } from 'echarts/components'
import { fetchDashboard, type Alert, type DashboardData } from '../api'
import { blockNetwork, conditionLabel, fmtDateTime, fmtTime, reasonLabel, severityLabel, severityType } from '../events'
import { isDark } from '../theme'
import { usePoller } from '../usePoller'

use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

/** sw_logd's trends come every 10 seconds (Seawall proposal 0012 §4): polling faster shows nothing new. */
const POLL_MS = 10_000

const data = ref<DashboardData | null>(null)
const loading = ref(true)

// ---------- polling: every 10s, paused while the tab is hidden ----------

// an error is already surfaced by api.ts; usePoller keeps polling
usePoller(async (background) => {
  try {
    data.value = await fetchDashboard(background)
  } finally {
    loading.value = false
  }
}, POLL_MS)

// ---------- view ----------

/** A number, or "-" when there is none (nothing polled voidgate lately): never 0 for "unknown". */
const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '-' : n.toLocaleString('en-US'))

const chartOption = computed<
  ComposeOption<LineSeriesOption | GridComponentOption | LegendComponentOption | TooltipComponentOption>
>(() => {
  const t = data.value?.traffic ?? []
  // the theme's colors (theme.css), read again when the theme changes
  void isDark.value
  const css = getComputedStyle(document.documentElement)
  const color = (name: string) => css.getPropertyValue(name).trim()
  return {
    backgroundColor: 'transparent',
    color: [color('--c-info'), color('--c-error')],
    tooltip: { trigger: 'axis' },
    legend: { data: ['Inbound', 'Dropped'], top: 0 },
    grid: { left: 60, right: 20, top: 36, bottom: 30 },
    xAxis: { type: 'category', boundaryGap: false, data: t.map((p) => fmtTime(p.time)) },
    yAxis: { type: 'value', name: 'pps', splitLine: { lineStyle: { color: color('--c-border') } } },
    // a null rate is no data: the line breaks there instead of dropping to 0
    series: [
      {
        name: 'Inbound', type: 'line', showSymbol: false, connectNulls: false, areaStyle: { opacity: 0.1 },
        data: t.map((p) => p.inbound_pps),
      },
      { name: 'Dropped', type: 'line', showSymbol: false, connectNulls: false, data: t.map((p) => p.dropped_pps) },
    ],
  }
})

/** The chart's "loading" overlay, in the theme's colors. */
const loadingOptions = computed(() => {
  void isDark.value
  const css = getComputedStyle(document.documentElement)
  return { maskColor: 'transparent', textColor: css.getPropertyValue('--c-muted').trim(), color: css.getPropertyValue('--c-info').trim() }
})

/** No point has data: the chart says why instead of drawing an empty grid. */
const noTraffic = computed(
  () => data.value !== null && data.value.traffic.every((p) => p.inbound_pps === null),
)

type BlockRow = DashboardData['blocks'][number]
const blockColumns: DataTableColumns<BlockRow> = [
  { title: 'Started', key: 'started', width: 190, render: (b) => fmtDateTime(b.started) },
  { title: 'Network', key: 'network', render: blockNetwork },
  { title: 'Reason', key: 'reason', render: (b) => reasonLabel(b.reason) },
  {
    title: 'State',
    key: 'ended',
    width: 100,
    render: (b) =>
      b.ended === null ? h(NTag, { type: 'error', size: 'small' }, () => 'In force') : h('span', 'Ended'),
  },
]

const alertColumns: DataTableColumns<Alert> = [
  {
    title: 'Severity',
    key: 'severity',
    width: 100,
    render: (a) => h(NTag, { type: severityType(a.severity), size: 'small' }, () => severityLabel(a.severity)),
  },
  { title: 'Condition', key: 'condition', render: (a) => conditionLabel(a.condition) },
  { title: 'Since', key: 'raised', render: (a) => fmtDateTime(a.raised) },
]
</script>

<template>
  <NGrid :cols="3" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
    <NGi span="3 m:1">
      <NCard>
        <NStatistic label="Inbound (pps)" :value="data ? fmt(data.inbound_pps) : '-'" />
      </NCard>
    </NGi>
    <NGi span="3 m:1">
      <NCard>
        <NStatistic label="Dropped (pps)" :value="data ? fmt(data.dropped_pps) : '-'" />
      </NCard>
    </NGi>
    <NGi span="3 m:1">
      <NCard>
        <NStatistic label="Active ACL Entries" :value="data ? fmt(data.active_acl_rules) : '-'" />
      </NCard>
    </NGi>

    <NGi span="3">
      <NCard title="Traffic, last 15 minutes">
        <NEmpty
          v-if="noTraffic"
          description="No traffic data: the DDoS gate or the event store isn't running"
          style="padding: 100px 0"
        />
        <VChart
          v-else
          :option="chartOption"
          :theme="isDark ? 'dark' : undefined"
          :loading="loading"
          :loading-options="loadingOptions"
          autoresize
          style="height: 320px"
        />
      </NCard>
    </NGi>

    <NGi span="3 l:2">
      <NCard title="Latest Blocks">
        <template #header-extra>
          <RouterLink to="/logs?tab=blocks">All blocks</RouterLink>
        </template>
        <NDataTable :columns="blockColumns" :data="data?.blocks ?? []" :loading="loading" size="small" :bordered="false" />
      </NCard>
    </NGi>

    <NGi span="3 l:1">
      <NCard title="Open Alerts">
        <template #header-extra>
          <RouterLink to="/logs?tab=alerts">History</RouterLink>
        </template>
        <NDataTable :columns="alertColumns" :data="data?.alerts ?? []" :loading="loading" size="small" :bordered="false" />
      </NCard>
    </NGi>
  </NGrid>
</template>
