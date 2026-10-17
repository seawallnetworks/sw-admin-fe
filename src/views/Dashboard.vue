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
import { fetchDashboard, type BlockedEvent, type DashboardData } from '../api'

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

const fmt = (n: number) => n.toLocaleString('zh-CN')

const chartOption = computed<
  ComposeOption<LineSeriesOption | GridComponentOption | LegendComponentOption | TooltipComponentOption>
>(() => {
  const t = data.value?.traffic ?? []
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: ['入站', '丢弃'], top: 0 },
    grid: { left: 60, right: 20, top: 36, bottom: 30 },
    xAxis: { type: 'category', boundaryGap: false, data: t.map((p) => p.time) },
    yAxis: { type: 'value', name: 'pps' },
    series: [
      { name: '入站', type: 'line', smooth: true, showSymbol: false, areaStyle: { opacity: 0.1 }, data: t.map((p) => p.inbound) },
      { name: '丢弃', type: 'line', smooth: true, showSymbol: false, color: '#d03050', data: t.map((p) => p.dropped) },
    ],
  }
})

const eventColumns: DataTableColumns<BlockedEvent> = [
  { title: '时间', key: 'time', width: 100 },
  { title: '源 IP', key: 'srcIp' },
  { title: '类型', key: 'type' },
  { title: '目标', key: 'target' },
  { title: '处置', key: 'action', width: 80 },
]
</script>

<template>
  <NGrid :cols="4" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
    <NGi span="4 m:2 l:1">
      <NCard>
        <NStatistic label="入站流量 (pps)" :value="data ? fmt(data.inboundPps) : '-'" />
      </NCard>
    </NGi>
    <NGi span="4 m:2 l:1">
      <NCard>
        <NStatistic label="丢弃流量 (pps)" :value="data ? fmt(data.droppedPps) : '-'" />
      </NCard>
    </NGi>
    <NGi span="4 m:2 l:1">
      <NCard>
        <NStatistic label="生效 ACL 规则" :value="data ? data.activeAclRules : '-'" />
      </NCard>
    </NGi>
    <NGi span="4 m:2 l:1">
      <NCard>
        <NStatistic label="SYN 防护">
          <NTag v-if="data" :type="data.synProtection ? 'success' : 'default'" size="large">
            {{ data.synProtection ? '已启用' : '未启用' }}
          </NTag>
          <span v-else>-</span>
        </NStatistic>
      </NCard>
    </NGi>

    <NGi span="4">
      <NCard title="流量趋势">
        <VChart :option="chartOption" :loading="loading" autoresize style="height: 320px" />
      </NCard>
    </NGi>

    <NGi span="4">
      <NCard title="最近拦截事件">
        <NDataTable :columns="eventColumns" :data="data?.events ?? []" :loading="loading" size="small" :bordered="false" />
      </NCard>
    </NGi>
  </NGrid>
</template>
