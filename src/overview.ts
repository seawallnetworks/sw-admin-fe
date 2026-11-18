// The Dashboard's overview: whether each module is fine, and where to look. Derived from the event lists,
// the alerts and the engine's state; kept free of Vue, so it can be tested on its own.
import type { AclEngine, Alert, AttackRecord, AuditRecord, BlockRecord, ChangeRecord, OpenAttack, Trends } from './types'
import type { IfaceStatus } from './aclPage'
import { changeText, changeWho, conditionLabel } from './events'

export type Tone = 'success' | 'info' | 'warning' | 'error' | 'default'

// ---------- alerts ----------

const RANK: Record<string, number> = { critical: 2, warning: 1, info: 0 }

/** The alerts, most severe first, the oldest of a severity first. */
export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => (RANK[b.severity] ?? 0) - (RANK[a.severity] ?? 0) || a.raised - b.raised)
}

export interface AlertText {
  title: string
  sentence: string
  /** The page that fixes it, and its name. */
  to: string
  page: string
}

const ALERT_TEXT: Record<string, Pick<AlertText, 'title' | 'sentence'>> = {
  voidgate_unreachable: {
    title: "DDoS protection isn't responding",
    sentence: "The console can't read the DDoS gate; it may have stopped, and attacks may not be blocked.",
  },
  voidgate_no_flow_table: {
    title: 'DDoS protection has no connection table',
    sentence:
      "The DDoS gate started without the table of the device's own connections, so replies to the device's own traffic may be dropped.",
  },
  voidgate_degraded: {
    title: 'DDoS protection runs in a slower mode',
    sentence: "Another program holds the network interface's fast path, so the DDoS gate can't use it.",
  },
  mfwd_unreachable: {
    title: "The access list engine isn't responding",
    sentence: "The console can't read the firewall engine; the access lists may not be enforced.",
  },
  mfwd_no_flow_table: {
    title: 'The access list engine has no connection table',
    sentence:
      "Replies to the device's own traffic (DNS, updates, pings) may be dropped unless a list permits them.",
  },
  mfwd_degraded: {
    title: 'Access lists run in a slower mode',
    sentence: "Another program holds the network interface's fast path, so the firewall engine can't use it.",
  },
  mfwd_missing_interfaces: {
    title: 'An interface with access lists is missing',
    sentence: "A list is applied to an interface that doesn't exist on the device, so nothing is filtered there.",
  },
  store_unavailable: {
    title: "Events aren't being recorded",
    sentence: "The event store can't write, for example because the disk is full; the logs miss what happens meanwhile.",
  },
  store_cap_reached_audit: {
    title: 'Old audit records are being removed',
    sentence: "The event store reached its size limit for audit records; ask the administrator to raise it.",
  },
}

/** An alert in plain words, and the page that fixes it; one this build doesn't know keeps its message. */
export function alertText(a: Alert): AlertText {
  const text = ALERT_TEXT[a.condition] ?? { title: conditionLabel(a.condition), sentence: a.message }
  if (a.condition.startsWith('voidgate_')) return { ...text, to: '/ddos', page: 'DDoS Protection' }
  if (a.condition.startsWith('mfwd_')) return { ...text, to: '/acl', page: 'Access Lists' }
  if (a.condition === 'store_unavailable') return { ...text, to: '/logs', page: 'Logs' }
  return { ...text, to: '/logs?tab=alerts', page: 'Logs' }
}

// ---------- DDoS protection: derived from voidgate's changes ----------

const isArm = (c: ChangeRecord) => c.source === 'voidgate' && c.op === 'arm'
/** A disarm, or a restart, which lifts every block without logging a disarm. */
const isEnd = (c: ChangeRecord) =>
  c.source === 'voidgate' && (c.op === 'disarm' || (c.op === 'gap' && c.cause === 'restart'))

const chronological = (changes: ChangeRecord[]) =>
  changes.filter((c) => isArm(c) || isEnd(c)).sort((a, b) => a.time - b.time || a.id - b.id)

/** When the gate was armed, if it is armed now by its latest changes; null if not. */
export function armedSince(changes: ChangeRecord[]): number | null {
  let since: number | null = null
  for (const c of chronological(changes)) {
    if (isArm(c)) since ??= c.time
    else since = null
  }
  return since
}

export type DdosState = 'down' | 'attack' | 'armed' | 'watching'

export interface DdosStatus {
  state: DdosState
  label: string
  tone: Tone
  degraded: boolean
}

const DDOS: Record<DdosState, { label: string; tone: Tone }> = {
  down: { label: 'Not running', tone: 'error' },
  attack: { label: 'Under attack', tone: 'warning' },
  armed: { label: 'Armed', tone: 'info' },
  watching: { label: 'Watching', tone: 'success' },
}

/**
 * The DDoS gate's state from the open alerts, its changes (any order) and the attack open now, which
 * voidgate reports (proposal 0017).
 * TODO(backend): "armed" is still derived from the changes; voidgate's own status is proposal 0016's.
 */
export function ddosStatus(alerts: Alert[], changes: ChangeRecord[], attack: OpenAttack | null): DdosStatus {
  const has = (c: string) => alerts.some((a) => a.condition === c)
  let state: DdosState
  if (has('voidgate_unreachable')) state = 'down'
  else if (attack) state = 'attack'
  else if (armedSince(changes) !== null) state = 'armed'
  else state = 'watching'
  const degraded = state !== 'down' && (has('voidgate_degraded') || has('voidgate_no_flow_table'))
  const { label, tone } = DDOS[state]
  return {
    state,
    label: degraded ? `${label}, degraded` : label,
    tone: degraded && tone === 'success' ? 'warning' : tone,
    degraded,
  }
}

export interface Attack {
  start: number
  end: number
  /** Still open: `end` is now. */
  ongoing: boolean
  /** Its end was missed (a gap, a restart): `end` is a lower bound. */
  atLeast: boolean
}

/** voidgate's attacks (any order), oldest first; an open one ends now. */
export function attackSpans(records: AttackRecord[], now: number): Attack[] {
  return records
    .map((r) => ({
      start: r.start,
      end: r.end ?? Math.max(now, r.start),
      ongoing: r.end === null,
      atLeast: r.how === 'gap' || r.how === 'restart',
    }))
    .sort((a, b) => a.start - b.start)
}

/** The longest attack's seconds, and whether that is a lower bound; null for none. */
export function longestAttack(list: Attack[]): { secs: number; atLeast: boolean } | null {
  return list.reduce<{ secs: number; atLeast: boolean } | null>((m, a) => {
    const secs = a.end - a.start
    return m === null || secs > m.secs ? { secs, atLeast: a.atLeast } : m
  }, null)
}

/** The highest single tick of any of the attacks, packets a second; null for none. */
export function attackPeak(records: AttackRecord[]): number | null {
  return records.reduce<number | null>(
    (m, r) => (r.tick_peak_pps !== null && (m === null || r.tick_peak_pps > m) ? r.tick_peak_pps : m),
    null,
  )
}

/** When the last attack ended; null for none, or one still open. */
export function lastAttackEnd(records: AttackRecord[]): number | null {
  return records.reduce<number | null>((t, r) => (r.end !== null && (t === null || r.end > t) ? r.end : t), null)
}

// ---------- blocks ----------

/** How many networks the records stand for: a summary row is `more` of them. */
export const countNetworks = (blocks: Pick<BlockRecord, 'network' | 'more'>[]) =>
  blocks.reduce((n, b) => n + (b.network === null ? b.more : 1), 0)

// ---------- traffic ----------

/** The highest 10-second rate of packets in, from voidgate's trends; null with no data. */
export function peakPps(t: Trends): number | null {
  let peak: number | null = null
  for (const s of t.series) {
    if (s.source === 'voidgate' && s.series === 'rx' && (peak === null || s.peak_pps > peak)) peak = s.peak_pps
  }
  return peak
}

/**
 * Megabits a second in, over voidgate's latest covered bucket; null with none that ended in the last 30 s
 * before `now`: as for GET /dashboard's rates, an older one isn't "now".
 */
export function latestMbps(t: Trends, now: number): number | null {
  const covered = t.coverage.filter(
    (c) => c.source === 'voidgate' && c.covered && c.secs > 0 && c.time + t.width >= now - 30,
  )
  const last = covered.reduce<(typeof covered)[number] | null>((m, c) => (m === null || c.time > m.time ? c : m), null)
  if (!last) return null
  const rx = t.series.find((s) => s.source === 'voidgate' && s.series === 'rx' && s.time === last.time)
  // a covered bucket without the series is zero
  return ((rx?.bytes ?? 0) * 8) / last.secs / 1e6
}

// ---------- access lists ----------

export interface AclStatus {
  status: IfaceStatus
  /** The Access Lists page's words for `status`, and the problems: "Enforced, 1 problem". */
  problems: number
  tone: Tone
}

/** The engine's state in the Access Lists page's terms, and the firewall's open alerts. */
export function aclStatus(engine: AclEngine | null, alerts: Alert[]): AclStatus {
  let status: IfaceStatus
  if (!engine) status = 'unknown'
  else if (engine.state === 'off') status = 'off'
  else if (engine.state === 'unreachable') status = 'down'
  else if (engine.state === 'refused') status = 'refused'
  else if (engine.state === 'pending') status = 'applying'
  else status = engine.live && !engine.attached?.length ? 'unfiltered' : 'enforced'
  const TONE: Record<IfaceStatus, Tone> = {
    enforced: 'success', applying: 'info', down: 'error', refused: 'error', off: 'default', missing: 'warning',
    unfiltered: 'default', unknown: 'default',
  }
  const problems = alerts.filter((a) => a.condition.startsWith('mfwd_')).length
  let tone = TONE[status]
  if (problems > 0 && tone !== 'error') tone = 'warning'
  return { status, problems, tone }
}

/** Packets a second the lists dropped between two reads of the engine's counter; null without two. */
export function dropRate(
  prev: { at: number; drops: number } | null,
  cur: { at: number; drops: number } | null,
): number | null {
  if (!prev || !cur || cur.at <= prev.at || cur.drops < prev.drops) return null
  return (cur.drops - prev.drops) / ((cur.at - prev.at) / 1000)
}

// ---------- recent activity ----------

export type ActivityTag = 'DDoS' | 'ACL' | 'Config' | 'Login'

export interface Activity {
  key: string
  time: number
  tag: ActivityTag
  text: string
}

export function changeActivity(c: ChangeRecord): Activity {
  const who = changeWho(c)
  const by = c.origin === 'self' || who === '-' ? '' : ` by ${who}`
  return {
    key: `c${c.id}`,
    time: c.time,
    tag: c.source === 'mfwd' ? 'ACL' : 'DDoS',
    text: `${changeText(c)}${by}.`,
  }
}

const from = (a: AuditRecord) => (a.client ? ` from ${a.client}` : '')

export function auditActivity(a: AuditRecord): Activity {
  const user = a.user ?? 'Someone'
  let tag: ActivityTag
  let text: string
  if (a.kind === 'login') {
    tag = 'Login'
    if (a.count > 0) text = `${a.count} more failed logins${from(a)}.`
    else if (a.op === 'login') text = a.result === 'ok' ? `${user} logged in${from(a)}.` : `Failed login as ${user}${from(a)}.`
    else text = `${user}: ${a.op ?? 'session'}${a.result && a.result !== 'ok' ? ` (${a.result})` : ''}.`
  } else {
    const what = [a.op, a.object].filter(Boolean).join(' ')
    tag = /\bacl\b|access-list|access-group/i.test(what) ? 'ACL' : /voidgate|\bblock\b|\bban\b/i.test(what) ? 'DDoS' : 'Config'
    text =
      a.result === 'ok' || a.result === null
        ? `${user} changed the configuration: ${what || 'unknown change'}.`
        : `${user} was refused: ${what || 'unknown change'} (${a.result}).`
  }
  return { key: `a${a.id}`, time: a.time, tag, text }
}

/** The latest `n` audit records and changes, newest first. */
export function recentActivity(audit: AuditRecord[], changes: ChangeRecord[], n = 6): Activity[] {
  return [...audit.map(auditActivity), ...changes.map(changeActivity)].sort((a, b) => b.time - a.time).slice(0, n)
}

// ---------- formatting ----------

/** A packet rate: "812 pps", "152 kpps", "1.2 Mpps"; "—" for none. */
export function fmtRate(pps: number | null | undefined): string {
  if (pps === null || pps === undefined) return '—'
  if (pps >= 1e6) return `${(pps / 1e6).toFixed(1)} Mpps`
  if (pps >= 1e4) return `${Math.round(pps / 1e3)} kpps`
  return `${Math.round(pps).toLocaleString('en-US')} pps`
}

export function fmtMbps(mbps: number | null | undefined): string {
  if (mbps === null || mbps === undefined) return '—'
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} Gbps`
  return `${mbps < 10 ? mbps.toFixed(1) : Math.round(mbps)} Mbps`
}

/** A length of time: "under a minute", "12 min", "2 h 5 min", "3 d 4 h". */
export function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60)
  if (m < 1) return 'under a minute'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
  return h % 24 ? `${Math.floor(h / 24)} d ${h % 24} h` : `${Math.floor(h / 24)} d`
}

/** How long ago: "just now", "5 min ago", "3 h ago", "2 d ago". */
export function fmtAgo(t: number, now: number): string {
  const s = Math.max(0, now - t)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}
