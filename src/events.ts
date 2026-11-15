// The console's events (Seawall proposal 0012): labels and text for the Dashboard, the alert banner and
// the Logs page. Kept free of Vue, so it can be tested on its own.
import type { Alert, BlockRecord, ChangeRecord, Severity } from './types'

/** Naive UI's tag type for a severity. */
export function severityType(s: Severity | string): 'default' | 'warning' | 'error' {
  return s === 'critical' ? 'error' : s === 'warning' ? 'warning' : 'default'
}

export const severityLabel = (s: Severity | string) =>
  s === 'critical' ? 'Critical' : s === 'warning' ? 'Warning' : s === 'info' ? 'Info' : s

const RANK: Record<string, number> = { critical: 2, warning: 1, info: 0 }

/** The most severe of the alerts, the oldest of those first; null for none. */
export function worstAlert(alerts: Alert[]): Alert | null {
  let worst: Alert | null = null
  for (const a of alerts) {
    const r = RANK[a.severity] ?? 0
    const w = worst ? (RANK[worst.severity] ?? 0) : -1
    if (r > w || (r === w && worst && a.raised < worst.raised)) worst = a
  }
  return worst
}

const CONDITIONS: Record<string, string> = {
  voidgate_unreachable: 'DDoS gate unreachable',
  mfwd_unreachable: 'Firewall engine unreachable',
  voidgate_no_flow_table: 'DDoS gate: no flow table',
  mfwd_no_flow_table: 'Firewall: no flow table',
  voidgate_degraded: 'DDoS gate degraded',
  mfwd_degraded: 'Firewall degraded',
  mfwd_missing_interfaces: 'Firewall: interfaces missing',
  store_unavailable: 'Event store unavailable',
  store_cap_reached_audit: 'Event store too small',
}

/** A condition's name; one this build doesn't know is shown as it came. */
export const conditionLabel = (c: string) => CONDITIONS[c] ?? c

const REASONS: Record<string, string> = {
  manual: 'Manual',
  policy: 'Policy',
  aggregate: 'Aggregate',
  timed: 'Timed ban',
}

export const reasonLabel = (r: string) => REASONS[r] ?? r

/** A block's network, or a summary's "and N more networks". */
export function blockNetwork(b: Pick<BlockRecord, 'network' | 'more'>): string {
  if (b.network !== null) return b.network
  return `${b.more.toLocaleString('en-US')} more network${b.more === 1 ? '' : 's'}`
}

const END_STATES: Record<string, string> = {
  undrop: 'Lifted',
  expired: 'Expired',
  reload: 'Lifted by reload',
  disarm: 'Disarmed',
  unknown: 'Ended (time unknown)',
  lifted: 'Lifted',
}

/** Whether a block is in force, or how it ended. */
export function blockState(b: Pick<BlockRecord, 'ended' | 'end_state'>): string {
  if (b.ended === null) return 'In force'
  return END_STATES[b.end_state ?? ''] ?? b.end_state ?? 'Ended'
}

/** Who asked for a block. */
export function blockOrigin(b: Pick<BlockRecord, 'origin' | 'uid'>): string {
  if (b.origin === 'self') return 'DDoS gate'
  if (b.origin === 'socket') return b.uid === null ? 'Command' : `Command (uid ${b.uid})`
  return '-'
}

const OPS: Record<string, string> = {
  arm: 'DDoS gate armed',
  disarm: 'DDoS gate disarmed',
  reload: 'DDoS gate reloaded',
  apply: 'Firewall policy applied',
  gap: 'Changes missed',
}

/** What a state change was, in a few words. */
export function changeText(c: ChangeRecord): string {
  const what = OPS[c.op] ?? `${c.source} ${c.op}`
  if (c.op === 'gap') {
    const who = c.source === 'mfwd' ? 'the firewall' : 'the DDoS gate'
    return c.cause === 'restart' ? `${what}: ${who} restarted` : `${what}: the log fell behind ${who}`
  }
  if (c.op === 'apply') {
    const gen = c.generation === null ? '' : ` (generation ${c.generation})`
    return c.origin === 'restart' ? `Saved firewall policy applied at start${gen}` : `${what}${gen}`
  }
  return c.cause ? `${what}: ${c.cause.replace(/-/g, ' ')}` : what
}

/** Who made a change. */
export function changeWho(c: Pick<ChangeRecord, 'origin' | 'uid' | 'user'>): string {
  if (c.origin === 'self') return 'DDoS gate'
  if (c.user) return c.user
  if (c.uid !== null) return `uid ${c.uid}`
  return '-'
}

/** The Logs page's time ranges: their label and length in seconds. */
export const RANGES = [
  { key: '1h', label: 'Last hour', secs: 3600 },
  { key: '24h', label: 'Last 24 hours', secs: 86400 },
  { key: '7d', label: 'Last 7 days', secs: 7 * 86400 },
  { key: '30d', label: 'Last 30 days', secs: 30 * 86400 },
] as const

export type RangeKey = (typeof RANGES)[number]['key']

/** `since` for a range ending now; `now` in ms. */
export function rangeSince(key: RangeKey, now: number): number {
  const r = RANGES.find((x) => x.key === key) ?? RANGES[1]
  return Math.floor(now / 1000) - r.secs
}

/** Epoch seconds as the browser's local date and time. */
export const fmtDateTime = (t: number) =>
  new Date(t * 1000).toLocaleString('en-US', {
    hourCycle: 'h23',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

/** Epoch seconds as the browser's local time of day. */
export const fmtTime = (t: number) => new Date(t * 1000).toLocaleTimeString('en-US', { hourCycle: 'h23' })
