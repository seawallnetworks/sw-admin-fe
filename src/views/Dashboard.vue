<script setup lang="ts">
// The Dashboard: an overview. It says whether everything is fine and where to look; the detail is on
// each module's page. Every figure comes from docs/api.md's endpoints, read in the background: alerts,
// traffic, the engine and recent activity every 10 s, the last 7 days every 60 s, paused while the tab
// is hidden (usePoller).
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { NCard, NEmpty, NGi, NGrid, NTag } from 'naive-ui'
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { ComposeOption } from 'echarts/core'
import type { BarSeriesOption, LineSeriesOption } from 'echarts/charts'
import type { GridComponentOption, MarkLineComponentOption, TooltipComponentOption } from 'echarts/components'
import ModuleCard from '../components/ModuleCard.vue'
import {
  fetchAllEvents, fetchDashboard, fetchEvents, fetchOpenAlerts, fetchTrends, getAclEngine, getConfig, getRole,
  refreshPendingChanges, unsavedChanges,
  type AclEngine, type Alert, type AttackRecord, type BlockRecord, type ChangeRecord, type DashboardData,
} from '../api'
import { STATUS_LABEL } from '../aclPage'
import { fmtDateTime, fmtTime, severityLabel, severityType } from '../events'
import {
  aclStatus, alertText, attackPeak, attackSpans, countNetworks, ddosStatus, dropRate, fmtAgo, fmtDuration,
  fmtMbps, fmtRate, lastAttackEnd, latestMbps, longestAttack, minutesPerDay, recentActivity, sortAlerts,
  type Activity, type ActivityTag,
} from '../overview'
import { isDark } from '../theme'
import { usePoller } from '../usePoller'

use([BarChart, LineChart, GridComponent, MarkLineComponent, TooltipComponent, CanvasRenderer])

/** sw_logd's trends come every 10 seconds (Seawall proposal 0012 §4): polling faster shows nothing new. */
const POLL_MS = 10_000
/** The last 7 days change slowly, and take several pages to read. */
const WEEK_POLL_MS = 60_000
const DAY = 86_400
const WEEK = 7 * DAY

/** The configuration, the engine and unsaved changes are an admin's only: a user isn't asked. */
const isAdmin = getRole() === 'admin'

const settled = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null)
const nowSecs = () => Math.floor(Date.now() / 1000)

// ---------- every 10 s: alerts, traffic, the engine, recent activity ----------

const now = ref(nowSecs())
const dash = ref<DashboardData | null>(null)
const loading = ref(true)
const alerts = ref<Alert[] | null>(null)
const engine = ref<AclEngine | null>(null)
/** voidgate's arms, disarms and restarts of the last 7 days, the latest 100. */
const gateChanges = ref<ChangeRecord[] | null>(null)
/** The latest attack of the last 7 days, open or ended; null when unknown, [] for none. */
const latestAttacks = ref<AttackRecord[] | null>(null)
const activity = ref<Activity[] | null>(null)
const blockedNow = ref<number | null>(null)
const mbps = ref<number | null>(null)
/** The lists' drop counter at the last two reads, for a rate. */
let lastDrops: { at: number; drops: number } | null = null
const listDropPps = ref<number | null>(null)

let firstPoll = true
usePoller(async (background) => {
  // only the first poll's dashboard error is shown; after that the figures say "—"
  const loud = { background, silent: !firstPoll }
  const quiet = { background, silent: true }
  firstPoll = false
  const t = nowSecs()
  const week = { since: t - WEEK }
  try {
    const [d, al, eng, gate, mfwd, audit, inForce, tr, att] = await Promise.allSettled([
      fetchDashboard(loud),
      fetchOpenAlerts(background),
      isAdmin ? getAclEngine(quiet) : Promise.resolve(null),
      fetchEvents('changes', { ...week, source: 'voidgate', limit: 100 }, quiet),
      fetchEvents('changes', { ...week, source: 'mfwd', limit: 6 }, quiet),
      fetchEvents('audit', { ...week, limit: 6 }, quiet),
      // blocks in force at any time in the last 10 s: the ones still in force have no end
      fetchAllEvents('blocks', { since: t - 10 }, quiet, 5),
      fetchTrends({ since: t - 60, source: 'voidgate' }, quiet),
      fetchEvents('attacks', { ...week, limit: 1 }, quiet),
    ])
    now.value = t
    dash.value = settled(d)
    alerts.value = settled(al)?.records ?? null
    engine.value = settled(eng)
    gateChanges.value = settled(gate)?.records ?? null
    latestAttacks.value = settled(att)?.records ?? null
    const blocks = settled(inForce)
    blockedNow.value = blocks ? countNetworks(blocks.filter((b) => b.ended === null)) : null
    const trends = settled(tr)
    mbps.value = trends ? latestMbps(trends, t) : null

    const drops = engine.value?.counters?.xdp_drop
    const cur = drops === undefined ? null : { at: Date.now(), drops }
    listDropPps.value = dropRate(lastDrops, cur)
    lastDrops = cur

    const a = settled(audit)?.records
    const c = [...(gateChanges.value ?? []), ...(settled(mfwd)?.records ?? [])]
    activity.value = a || gateChanges.value || settled(mfwd) ? recentActivity(a ?? [], c) : null
  } finally {
    loading.value = false
  }
}, POLL_MS)

// ---------- every 60 s: the last 7 days, and this device ----------

interface Week {
  since: number
  now: number
  /** voidgate's attacks open at any time in the 7 days (proposal 0017). */
  attacks: AttackRecord[]
  blocks: BlockRecord[] | null
}
const week = ref<Week | null>(null)
const hostname = ref<string | null>(null)

usePoller(async (background) => {
  const quiet = { background, silent: true }
  const t = nowSecs()
  const since = t - WEEK
  const [at, bl, cfg] = await Promise.allSettled([
    fetchAllEvents('attacks', { since }, quiet),
    fetchAllEvents('blocks', { since }, quiet),
    isAdmin ? getConfig(quiet) : Promise.resolve(null),
    isAdmin ? refreshPendingChanges(true) : Promise.resolve(),
  ])
  const list = settled(at)
  week.value = list ? { since, now: t, attacks: list, blocks: settled(bl) } : null
  hostname.value = settled(cfg)?.config.hostname ?? null
}, WEEK_POLL_MS)

// ---------- 1. alerts ----------

const alertRows = computed(() => sortAlerts(alerts.value ?? []).map((a) => ({ alert: a, ...alertText(a) })))

/** A time of day for today, a date and time before. */
function fmtSince(t: number) {
  return new Date(t * 1000).toDateString() === new Date().toDateString() ? fmtTime(t) : fmtDateTime(t)
}

// ---------- 2. modules ----------

const ddos = computed(() => ddosStatus(alerts.value ?? [], gateChanges.value ?? [], dash.value?.attack ?? null))
const ddosKnown = computed(() => alerts.value !== null || gateChanges.value !== null)

/** "Under attack since 21:38" while one is open (proposal 0017). */
const ddosLabel = computed(() => {
  const a = dash.value?.attack
  if (ddos.value.state !== 'attack' || !a) return ddos.value.label
  return ddos.value.label.replace('Under attack', `Under attack since ${fmtSince(a.since)}`)
})

const ddosStats = computed(() => {
  const blocked = { label: 'Blocked now', value: blockedNow.value === null ? '—' : networks(blockedNow.value) }
  const a = dash.value?.attack
  // a single tick's peak, voidgate's: higher than the chart's 10-second rates
  if (ddos.value.state === 'attack' && a) return [blocked, { label: 'Peak, one tick', value: fmtRate(a.tick_peak_pps) }]
  const end = latestAttacks.value ? lastAttackEnd(latestAttacks.value) : null
  const last = latestAttacks.value === null ? '—' : end === null ? 'None in 7 days' : fmtAgo(end, now.value)
  return [blocked, { label: 'Last attack', value: last }]
})

const networks = (n: number) => `${n.toLocaleString('en-US')} network${n === 1 ? '' : 's'}`

const acl = computed(() => aclStatus(engine.value, alerts.value ?? []))
const aclLabel = computed(() => {
  const { status, problems } = acl.value
  return problems ? `${STATUS_LABEL[status]}, ${problems} problem${problems === 1 ? '' : 's'}` : STATUS_LABEL[status]
})
const aclStats = computed(() => {
  const e = engine.value
  const filtered = !e?.live ? '—' : e.attached?.length ? e.attached.join(', ') : 'None'
  return [
    { label: 'Filtering', value: filtered },
    { label: 'Dropped by lists', value: fmtRate(listDropPps.value) },
  ]
})

/** Bans from the web gateway: timed blocks started in the last 24 hours. */
const bans24h = computed(() => {
  const w = week.value
  if (!w?.blocks) return '—'
  return countNetworks(w.blocks.filter((b) => b.reason === 'timed' && b.started >= w.now - DAY)).toLocaleString('en-US')
})

// ---------- 3. traffic ----------

/** The theme's colors (theme.css), read again when the theme changes. */
function themeColor(name: string) {
  void isDark.value
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** The arms in the chart's window. */
const armsInWindow = computed(() => {
  const first = dash.value?.traffic[0]?.time
  if (first === undefined) return []
  return (gateChanges.value ?? []).filter((c) => c.op === 'arm' && c.time >= first).map((c) => c.time)
})

const trafficOption = computed<
  ComposeOption<LineSeriesOption | GridComponentOption | TooltipComponentOption | MarkLineComponentOption>
>(() => {
  const t = dash.value?.traffic ?? []
  const muted = themeColor('--c-muted')
  return {
    backgroundColor: 'transparent',
    color: [themeColor('--c-info')],
    tooltip: {
      trigger: 'axis',
      valueFormatter: (v) => fmtRate(typeof v === 'number' ? v : null),
    },
    grid: { left: 64, right: 20, top: 16, bottom: 30 },
    xAxis: { type: 'time', splitLine: { show: false } },
    yAxis: {
      type: 'value',
      axisLabel: { formatter: (v: number) => fmtRate(v) },
      splitLine: { lineStyle: { color: themeColor('--c-border') } },
    },
    series: [
      {
        name: 'Inbound',
        type: 'line',
        showSymbol: false,
        // a null rate is no data: the line breaks there instead of dropping to 0
        connectNulls: false,
        areaStyle: { opacity: 0.1 },
        data: t.map((p) => [p.time * 1000, p.inbound_pps]),
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: themeColor('--c-warning') },
          label: { formatter: 'Armed', color: muted, position: 'insideEndTop' },
          data: armsInWindow.value.map((s) => ({ xAxis: s * 1000 })),
        },
      },
    ],
  }
})

/** The chart's "loading" overlay, in the theme's colors. */
const loadingOptions = computed(() => ({
  maskColor: 'transparent',
  textColor: themeColor('--c-muted'),
  color: themeColor('--c-info'),
}))

/** No point has data: the chart says why instead of drawing an empty grid. */
const noTraffic = computed(() => dash.value !== null && dash.value.traffic.every((p) => p.inbound_pps === null))

// ---------- 4. the last 7 days ----------

const weekStats = computed(() => {
  const w = week.value
  if (!w) return null
  const list = attackSpans(w.attacks, w.now)
  const longest = longestAttack(list)
  const started = w.blocks?.filter((b) => b.started >= w.since) ?? null
  return {
    count: list.length,
    // a gap or a restart hid its end: what was seen of it
    longest: longest ? `${longest.atLeast ? 'At least ' : ''}${fmtDuration(longest.secs)}` : '—',
    peak: fmtRate(attackPeak(w.attacks)),
    cut: started ? countNetworks(started) : null,
    byHand: started ? countNetworks(started.filter((b) => b.reason === 'manual')) : null,
    bars: minutesPerDay(list, w.now),
  }
})

const barOption = computed<ComposeOption<BarSeriesOption | GridComponentOption | TooltipComponentOption>>(() => {
  const bars = weekStats.value?.bars ?? []
  return {
    backgroundColor: 'transparent',
    color: [themeColor('--c-warning')],
    tooltip: { trigger: 'axis', valueFormatter: (v) => `${v} min under attack` },
    grid: { left: 40, right: 8, top: 12, bottom: 24 },
    xAxis: { type: 'category', data: bars.map((b) => b.label), axisTick: { show: false } },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { formatter: '{value} min' },
      splitLine: { lineStyle: { color: themeColor('--c-border') } },
    },
    series: [{ name: 'Under attack', type: 'bar', barMaxWidth: 28, data: bars.map((b) => b.minutes) }],
  }
})

// ---------- 5. activity and this device ----------

const TAG_TYPE: Record<ActivityTag, 'warning' | 'info' | 'default' | 'success'> = {
  DDoS: 'warning',
  ACL: 'info',
  Config: 'default',
  Login: 'success',
}
</script>

<template>
  <!-- 1. open alerts, most severe first; nothing at all without one -->
  <section v-if="alertRows.length" class="alerts">
    <div v-for="r in alertRows" :key="r.alert.id" class="alert" :class="`sev-${r.alert.severity}`">
      <NTag :type="severityType(r.alert.severity)" size="small" class="sev">{{ severityLabel(r.alert.severity) }}</NTag>
      <div class="alert-text">
        <strong>{{ r.title }}</strong>
        <span>{{ r.sentence }}</span>
        <span class="muted">since {{ fmtSince(r.alert.raised) }}</span>
      </div>
      <RouterLink :to="r.to" class="alert-link">{{ r.page }} →</RouterLink>
    </div>
  </section>

  <NGrid :cols="3" :x-gap="16" :y-gap="16" responsive="screen" item-responsive>
    <!-- 2. one card per module -->
    <NGi span="3 m:1">
      <ModuleCard
        title="DDoS Protection"
        to="/ddos"
        :status="ddosKnown ? ddosLabel : 'Checking…'"
        :tone="ddosKnown ? ddos.tone : 'default'"
        :bar="ddos.state === 'attack'"
        :stats="ddosStats"
      />
    </NGi>
    <NGi span="3 m:1">
      <ModuleCard
        v-if="isAdmin"
        title="Access Lists"
        to="/acl"
        :status="aclLabel"
        :tone="acl.tone"
        :stats="aclStats"
      />
      <ModuleCard v-else title="Access Lists" to="/acl" status="Admins only" tone="default" :stats="[]" />
    </NGi>
    <NGi span="3 m:1">
      <ModuleCard
        title="HTTP Flood · CC · Brute force"
        to="/http-flood"
        status="Not set up"
        tone="default"
        note="Comes from the web gateway banning clients through the DDoS gate."
        :stats="[{ label: 'Bans, last 24 h', value: bans24h }]"
      />
    </NGi>

    <!-- 3. incoming traffic -->
    <NGi span="3">
      <NCard>
        <template #header>
          Incoming traffic, last 15 minutes
          <span class="now">now {{ fmtRate(dash?.inbound_pps) }} · {{ fmtMbps(mbps) }}</span>
        </template>
        <template #header-extra>
          <RouterLink to="/ddos">Details on DDoS Protection</RouterLink>
        </template>
        <NEmpty
          v-if="noTraffic"
          description="No traffic data: the DDoS gate or the event store isn't running"
          style="padding: 80px 0"
        />
        <VChart
          v-else
          :option="trafficOption"
          :theme="isDark ? 'dark' : undefined"
          :loading="loading"
          :loading-options="loadingOptions"
          autoresize
          style="height: 260px"
        />
      </NCard>
    </NGi>

    <!-- 4. the last 7 days -->
    <NGi span="3">
      <NCard title="Last 7 days">
        <div class="week">
          <dl class="week-stats">
            <div>
              <dt>Attacks</dt>
              <dd>{{ weekStats ? weekStats.count : '—' }}</dd>
            </div>
            <div>
              <dt>Longest</dt>
              <dd>{{ weekStats?.longest ?? '—' }}</dd>
            </div>
            <div>
              <dt>Peak, one tick</dt>
              <dd>{{ weekStats?.peak ?? '—' }}</dd>
            </div>
            <div>
              <dt>Networks cut</dt>
              <dd>
                {{ weekStats?.cut?.toLocaleString('en-US') ?? '—' }}
                <span v-if="weekStats?.byHand" class="muted small">{{ weekStats.byHand.toLocaleString('en-US') }} by hand</span>
              </dd>
            </div>
          </dl>
          <div class="week-chart">
            <div class="muted small">Minutes under attack per day</div>
            <VChart :option="barOption" :theme="isDark ? 'dark' : undefined" autoresize style="height: 150px" />
          </div>
        </div>
      </NCard>
    </NGi>
  </NGrid>

  <!-- 5. recent activity, and this device (an admin's only) -->
  <NGrid :cols="2" :x-gap="16" :y-gap="16" responsive="screen" item-responsive class="bottom">
    <NGi :span="isAdmin ? '2 m:1' : '2'">
      <NCard title="Recent activity">
        <template #header-extra>
          <RouterLink to="/logs">Logs</RouterLink>
        </template>
        <div v-if="activity === null" class="muted">{{ loading ? 'Loading…' : "Recent activity can't be read just now." }}</div>
        <div v-else-if="!activity.length" class="muted">Nothing in the last 7 days.</div>
        <ul v-else class="activity">
          <li v-for="a in activity" :key="a.key">
            <NTag :type="TAG_TYPE[a.tag]" size="small" :bordered="false" class="tag">{{ a.tag }}</NTag>
            <span class="activity-text" :title="a.text">{{ a.text }}</span>
            <span class="muted small when" :title="fmtDateTime(a.time)">{{ fmtAgo(a.time, now) }}</span>
          </li>
        </ul>
      </NCard>
    </NGi>
    <NGi v-if="isAdmin" span="2 m:1">
      <NCard title="This device">
        <dl class="device">
          <div>
            <dt>Hostname</dt>
            <dd>{{ hostname ?? '—' }}</dd>
          </div>
          <!-- TODO(backend): voidgate's public interface, once GET /api/voidgate exists (proposal 0016) -->
          <!-- TODO(backend): version and uptime, not in the API yet -->
        </dl>
        <p v-if="unsavedChanges" class="unsaved">
          Configuration changed since the last Save Config; a restart would lose it.
        </p>
      </NCard>
    </NGi>
  </NGrid>
</template>

<style scoped>
.alerts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.alert {
  display: flex;
  align-items: baseline;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 6px;
  background: var(--c-subtle-bg);
}
.alert.sev-critical {
  background: var(--c-error-tint);
}
.alert.sev-warning {
  background: var(--c-warning-tint);
}
.sev {
  flex: none;
}
.alert-text {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  min-width: 0;
}
.alert-link {
  flex: none;
  white-space: nowrap;
}
.muted {
  color: var(--c-muted);
}
.small {
  font-size: 12px;
}
.now {
  margin-left: 12px;
  color: var(--c-muted);
  font-size: 14px;
  font-weight: normal;
  font-variant-numeric: tabular-nums;
}
.week {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 32px;
  align-items: center;
}
.week-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(120px, auto));
  gap: 16px 32px;
  margin: 0;
}
.week-stats dt,
.device dt {
  color: var(--c-muted);
  font-size: 12px;
}
.week-stats dd {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.week-stats dd .small {
  font-weight: normal;
  margin-left: 4px;
}
.week-chart {
  flex: 1;
  min-width: 260px;
}
.bottom {
  margin-top: 16px;
}
.activity {
  list-style: none;
  margin: 0;
  padding: 0;
}
.activity li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--c-border);
}
.activity li:last-child {
  border-bottom: none;
}
.tag {
  flex: none;
  width: 56px;
  justify-content: center;
}
.activity-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.when {
  flex: none;
}
.device {
  margin: 0;
}
.device dd {
  margin: 0 0 8px;
  font-size: 15px;
}
.unsaved {
  margin: 8px 0 0;
  color: var(--c-warning-text);
}
</style>
