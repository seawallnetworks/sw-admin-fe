// In-browser mock backend. Only loaded via dynamic import when VITE_USE_MOCK=true,
// so it (and the admin/admin login) never ships in a production build.

import { getToken } from './auth'
import { ApiError } from './types'
import type {
  AclEngine, AclEngineState, AclEntry, Alert, AuditRecord, BlockRecord, ChangeRecord, ConfigPending, DashboardData,
  DeviceConfig, EventPage, RequestOptions, Trends,
} from './types'

type MockHandler = (m: RegExpMatchArray, opts: RequestOptions) => unknown

const mock = {
  /**
   * The session, as sw_authd keeps it: it ends `idle` seconds after the last activity, and `limit` seconds
   * after the login. Both times are per page load, so a reload starts afresh. Try the warnings with
   * mockSession(idle, limit) in the browser console, e.g. mockSession(90, 43200) or mockSession(900, 120).
   */
  loginAt: Date.now(),
  activeAt: Date.now(),
  idle: 900,
  limit: 43_200,
  /** Whether a change was made since the last save; the real backend compares running and startup. */
  dirty: false,
  /** Whether a configuration is saved; mockFreshInstall() in the console makes it false until a save. */
  saved: true,
  generation: 4,
  /** When the last change was made; the engine shows `pending` for a moment after it. */
  changedAt: 0,
  acls: {
    '10': [
      { seq: 10, ace: 'deny host 203.0.113.66' },
      { seq: 20, ace: 'deny 198.51.100.0 0.0.0.255' },
      { seq: 30, ace: 'permit any' },
    ],
    '100': [
      { seq: 10, ace: 'permit tcp 192.168.1.0 0.0.0.255 any eq 22' },
      { seq: 20, ace: 'deny tcp any any eq 22' },
      { seq: 30, ace: 'permit tcp any host 10.0.0.5 eq 443' },
      { seq: 40, ace: 'permit tcp any any established' },
      { seq: 50, ace: 'permit udp any any eq 53' },
      { seq: 60, ace: 'permit icmp any any' },
    ],
    // not applied anywhere: under "Lists not in use"
    '20': [
      { seq: 10, ace: 'deny host 192.0.2.99' },
      { seq: 20, ace: 'deny 100.64.0.0 0.63.255.255' },
    ],
    // applied only on eth9, which isn't on the device
    '110': [{ seq: 10, ace: 'deny ip 192.0.2.0 0.0.0.255 any' }],
    // empty: the Apply dialog refuses it until it has entries
    '120': [],
  } as Record<string, AclEntry[]>,
  interfaces: {
    eth0: { acls_in: [10, 100] },
    // applies a list but doesn't exist, so the engine lists it as missing
    eth9: { acls_in: [110] },
  } as Record<string, { acls_in: number[] }>,
  counters: { xdp_pass: 18342, xdp_drop: 211, reply_miss: 2 } as Record<string, number>,
  /** The engine state to report; 'auto' is applied, or pending just after a change. */
  engineState: 'auto' as AclEngineState | 'auto',
  /** mfwd's flows: 'none' as when it started without sw_flowd's table. */
  flows: 'sw_flowd' as 'sw_flowd' | 'none',
  /**
   * The Dashboard's state: 'quiet' (nothing armed, no alerts), 'attack' (armed 4 minutes ago and dropping)
   * or 'alert' (voidgate stopped a minute ago, an interface missing). mockDashboard('quiet') in the console.
   */
  scenario: 'attack' as Scenario,
}

type Scenario = 'quiet' | 'attack' | 'alert'

/** The attack's start, and voidgate's stop, in the 'attack' and 'alert' scenarios: seconds before now. */
const ATTACK_AGO = 240
const STOPPED_AGO = 60

const rand = (min: number, max: number) => Math.floor(min + Math.random() * (max - min))

// ---------- events, as sw_logd would have them: newest first, fixed for a page load ----------

const loadedAt = Math.floor(Date.now() / 1000)
const H = 3600
const D = 86400

/** Newest first, with ids that fall with the time, as sw_logd's paging needs. */
function newestFirst<T extends { id: number }>(rows: T[], time: (r: T) => number): T[] {
  return rows.sort((a, b) => time(b) - time(a)).map((r, i) => ({ ...r, id: rows.length - i }))
}

function mockAudit(): AuditRecord[] {
  const base = { detail: null, count: 0, truncated: false }
  return [
    { ...base, id: 260, time: loadedAt - 60, severity: 'info', kind: 'admin', source: 'sw_configd', user: 'admin',
      entry: 'web', client: '192.168.1.20', op: 'acl entry add', object: 'access-list 100 70 permit udp any any eq 123',
      result: 'ok' },
    { ...base, id: 259, time: loadedAt - 400, severity: 'warning', kind: 'login', source: 'sw_authd', user: 'admin',
      entry: 'web', client: '203.0.113.9', op: 'login', object: '12 more failures across 3 usernames',
      result: 'summarized', count: 12 },
    ...Array.from({ length: 5 }, (_, i) => ({
      ...base, id: 254 + i, time: loadedAt - 460 - i * 5, severity: 'warning' as const, kind: 'login',
      source: 'sw_authd', user: ['root', 'admin', 'test'][i % 3], entry: 'web', client: '203.0.113.9', op: 'login',
      object: 'user', result: 'denied',
    })),
    { ...base, id: 253, time: loadedAt - 3550, severity: 'info', kind: 'admin', source: 'sw_configd', user: 'admin',
      entry: 'web', client: '192.168.1.20', op: 'set description',
      object: 'interface eth1 description ' + 'x'.repeat(200) + '…[+1800 bytes]', result: 'ok', truncated: true },
    { ...base, id: 253, time: loadedAt - 3600, severity: 'info', kind: 'admin', source: 'sw_configd', user: 'admin',
      entry: 'cli', client: '127.0.0.1', op: 'save', object: null, result: 'ok' },
    ...Array.from({ length: 150 }, (_, i) => ({
      ...base, id: 252 - i, time: loadedAt - 4000 - i * 500, severity: 'info' as const,
      kind: i % 2 ? 'login' : 'admin', source: i % 2 ? 'sw_authd' : 'sw_configd', user: 'admin',
      entry: 'web', client: '192.168.1.20', op: i % 2 ? 'login' : 'set hostname', object: i % 2 ? 'user' : 'sw1',
      result: 'ok',
    })),
  ]
}

function mockBlocks(): BlockRecord[] {
  const b = {
    id: 0, started_after_gap: false, ended: null, end_state: null, rate: null, origin: 'self', uid: null,
    out_of_band: false, more: 0,
  }
  const ended = (started: number, secs: number, end_state: string) => ({ started, ended: started + secs, end_state })
  const rows: BlockRecord[] = [
    // in force in every scenario: one by hand, one ban
    { ...b, network: '203.0.113.66/32', reason: 'manual', started: loadedAt - 3 * H, origin: 'socket', uid: 0,
      out_of_band: true },
    { ...b, network: '192.0.2.81/32', reason: 'timed', started: loadedAt - 600, origin: 'ban', uid: 33 },
    // bans of the last day, ended
    ...[1200, 5 * H, 20 * H, 30 * H].map((ago, i) => ({
      ...b, network: `192.0.2.${44 + i}/32`, reason: 'timed', ...ended(loadedAt - ago, 600, 'expired'),
      origin: 'ban', uid: 33,
    })),
    // past attacks' blocks, lifted by the disarm or the restart
    ...[26 * H, 3 * D, 5 * D].flatMap((ago, k) =>
      Array.from({ length: 4 }, (_, i) => ({
        ...b, network: `198.18.${k * 10 + i}.0/24`, reason: 'aggregate', ...ended(loadedAt - ago + 30, 1800, 'disarm'),
      })),
    ),
    { ...b, network: '100.64.3.0/24', reason: 'aggregate', started: loadedAt - 2 * H, started_after_gap: true,
      ended: loadedAt - 2 * H + 1000, end_state: 'unknown' },
    { ...b, network: '198.51.100.9/32', reason: 'manual', ...ended(loadedAt - 4 * D, 2 * H, 'unblock'),
      origin: 'socket', uid: 0 },
  ]
  if (mock.scenario === 'attack') {
    rows.push(
      { ...b, network: null, reason: 'policy', started: loadedAt - ATTACK_AGO + 30, more: 1250 },
      ...Array.from({ length: 6 }, (_, i) => ({
        ...b, network: `198.18.${100 + i}.0/24`, reason: 'aggregate', started: loadedAt - ATTACK_AGO + 10 + i * 3,
      })),
    )
  }
  return newestFirst(rows, (r) => r.started)
}

function mockChanges(): ChangeRecord[] {
  const c = { id: 0, severity: 'info' as const, source: 'voidgate', origin: 'self', uid: null, user: null,
    cause: null, generation: null, out_of_band: false }
  const arm = (ago: number, cause = 'wake-threshold') =>
    cause === 'ban'
      ? { ...c, time: loadedAt - ago, op: 'arm', cause, origin: 'ban', uid: 33, user: 'www-data' }
      : { ...c, time: loadedAt - ago, op: 'arm', cause }
  const disarm = (ago: number) => ({ ...c, time: loadedAt - ago, op: 'disarm', cause: 'attack-cleared' })
  const rows: ChangeRecord[] = [
    // the gate was armed before the 7 days: the first change in them is a disarm
    disarm(7 * D - 2 * H),
    arm(5 * D), disarm(5 * D - 25 * 60),
    // a restart ends an attack: no disarm logged
    arm(3 * D), arm(3 * D - 600, 'ban'),
    { ...c, time: loadedAt - 3 * D + 2 * H, severity: 'warning', op: 'gap', cause: 'restart' },
    arm(26 * H), disarm(26 * H - 40 * 60),
    { ...c, time: loadedAt - 900, severity: 'warning', op: 'reload', origin: 'socket', uid: 0, user: 'root',
      cause: 'command', out_of_band: true },
    { ...c, time: loadedAt - 3600, source: 'mfwd', op: 'apply', origin: 'apply', uid: 998, user: 'sw_configd',
      generation: 7 },
    { ...c, time: loadedAt - 86000, source: 'mfwd', op: 'apply', origin: 'restart', uid: 0, user: 'root',
      generation: 1 },
  ]
  if (mock.scenario === 'attack') rows.push(arm(ATTACK_AGO), arm(ATTACK_AGO - 60, 'ban'))
  return newestFirst(rows, (r) => r.time)
}

function mockAlerts(): Alert[] {
  const alerts: Alert[] = [
    { id: 2, condition: 'voidgate_unreachable', severity: 'warning', raised: loadedAt - 400,
      cleared: loadedAt - 330, message: "voidgate's read-only socket can't be read: connection refused" },
  ]
  if (mock.scenario === 'alert') {
    alerts.unshift(
      { id: 5, condition: 'voidgate_unreachable', severity: 'warning', raised: loadedAt - STOPPED_AGO, cleared: null,
        message: "voidgate's read-only socket can't be read: connection refused" },
      { id: 3, condition: 'mfwd_missing_interfaces', severity: 'warning', raised: loadedAt - 7200, cleared: null,
        message: 'mfwd: bound interfaces not present, so not filtered: eth9' },
    )
  }
  if (mock.flows === 'none') {
    alerts.unshift({ id: 4, condition: 'mfwd_no_flow_table', severity: 'critical', raised: loadedAt, cleared: null,
      message: 'mfwd: no sw_flowd flow table; replies to the host\'s own flows fall back to "established"' })
  }
  return alerts
}

const invalid = (msg: string) => new ApiError(400, 'invalid', msg)
const isStandard = (acl: number) => acl < 100

/** A list number from a body or query value, checked as the device does. */
function aclNumber(v: unknown): number {
  const acl = Number(v)
  if (!Number.isInteger(acl) || acl < 1 || acl > 199) throw invalid('access list number must be 1 to 199')
  return acl
}

/** Records a change; the reply carries the new generation. */
function changed(extra: object = {}) {
  mock.dirty = true
  mock.changedAt = Date.now()
  return { ...extra, generation: ++mock.generation }
}

const unchanged = () => ({ generation: mock.generation })

// Another admin, or the CLI, changing the configuration: run mockCliChange() in the browser console,
// then delete an entry, to see the page refuse and reload instead of deleting by a stale seq.
;(globalThis as { mockCliChange?: () => void }).mockCliChange = () => {
  const list = mock.acls['100']
  list.unshift({ seq: Math.max(1, (list[0]?.seq ?? 10) - 5), ace: 'deny tcp host 198.51.100.7 any' })
  changed()
}

;// A fresh install: nothing saved, no lists, and so nothing unsaved either until a change; the first save
// creates the startup configuration. Run mockFreshInstall() in the browser console, then go to another
// page (a reload would start the mock afresh).
;(globalThis as { mockFreshInstall?: () => void }).mockFreshInstall = () => {
  mock.acls = {}
  mock.interfaces = {}
  mock.generation = 0
  mock.dirty = false
  mock.saved = false
}

;(globalThis as { mockSession?: (idle: number, limit: number) => void }).mockSession = (idle, limit) => {
  mock.idle = idle
  mock.limit = limit
}

/** The session's seconds left, as sw_authd counts them. */
const secsLeft = (now: number) =>
  Math.floor((Math.min(mock.activeAt + mock.idle * 1000, mock.loginAt + mock.limit * 1000) - now) / 1000)

;(globalThis as { mockEngineState?: (s: string) => void }).mockEngineState = (s) => {
  mock.engineState = s as AclEngineState | 'auto'
}
;(globalThis as { mockFlows?: (s: string) => void }).mockFlows = (s) => {
  mock.flows = s === 'none' ? 'none' : 'sw_flowd'
}
;(globalThis as { mockDashboard?: (s: Scenario) => void }).mockDashboard = (s) => {
  mock.scenario = s
}

/** Packets a second in at `time` (epoch seconds), for the scenario: an attack's flood, or nothing while stopped. */
function inboundAt(time: number): { inbound: number | null; dropped: number | null } {
  // since the page loaded, as the changes and alerts have it
  const ago = loadedAt - time
  if (mock.scenario === 'alert' && ago < STOPPED_AGO) return { inbound: null, dropped: null }
  const normal = Math.round(120000 + 40000 * Math.sin(time / 60) + rand(0, 15000))
  if (mock.scenario === 'attack' && ago < ATTACK_AGO) {
    const flood = 900000 + rand(0, 200000)
    return { inbound: normal + flood, dropped: flood - rand(0, 20000) }
  }
  return { inbound: normal, dropped: 0 }
}

/** voidgate's trends: 10-second buckets up to 48 hours, 15-minute ones beyond, at most 600. */
function mockTrends(since: number, until: number): Trends {
  const width = until - since > 2 * D ? 900 : 10
  const first = width === 10 ? Math.max(Math.floor(since / 10) * 10, until - 6000) : Math.floor(since / width) * width
  const coverage: Trends['coverage'] = []
  const series: Trends['series'] = []
  for (let time = first; time < until; time += width) {
    const now = Math.min(time + width / 2, until)
    const { inbound } = inboundAt(now)
    if (inbound === null) continue
    const secs = Math.min(width, until - time)
    coverage.push({ time, source: 'voidgate', secs, ratio: 1, covered: true })
    // a past attack's peak, on the days the changes armed the gate
    const attack = [26 * H, 3 * D, 5 * D].some((ago) => Math.abs(loadedAt - ago - time) < 1800)
    const peak = attack ? 2_400_000 + rand(0, 300000) : Math.round(inbound * 1.2)
    series.push({ time, source: 'voidgate', series: 'rx', pkts: inbound * secs, bytes: inbound * secs * 680, peak_pps: peak })
  }
  return { tier: width === 10 ? '10s' : '15m', width, threshold: 0.5, since, until, coverage, series }
}

const mockRoutes: [string, RegExp, MockHandler][] = [
  ['POST', /^\/session$/, (_, { body }) => {
    const { user, password } = body as { user: string; password: string }
    if (user === 'admin' && password === 'admin') {
      mock.loginAt = mock.activeAt = Date.now()
      const ttl = Math.min(mock.idle, mock.limit)
      return { token: '0123456789abcdef0123456789abcdef', ttl, role: 'admin', idle: mock.idle }
    }
    throw new ApiError(401, 'denied', 'denied')
  }],
  ['GET', /^\/session$/, () => ({ user: 'admin', role: 'admin', secs_left: secsLeft(Date.now()) })],
  ['DELETE', /^\/session$/, () => ({})],
  ['GET', /^\/dashboard$/, () => {
    // epoch seconds, on the 10-second grid; a gap of a minute, 5 minutes ago, as when voidgate restarts
    const now = Math.floor(Date.now() / 10000) * 10
    const traffic = Array.from({ length: 90 }, (_, i) => {
      const time = now - (89 - i) * 10
      if (i >= 25 && i < 31) return { time, inbound_pps: null, dropped_pps: null }
      const { inbound, dropped } = inboundAt(time)
      return { time, inbound_pps: inbound, dropped_pps: dropped }
    })
    const last = traffic[traffic.length - 1]
    return {
      inbound_pps: last.inbound_pps,
      dropped_pps: last.dropped_pps,
      active_acl_rules: Object.values(mock.interfaces)
        .flatMap((i) => i.acls_in)
        .reduce((n, acl) => n + (mock.acls[acl]?.length ?? 0), 0),
      traffic,
      blocks: mockBlocks().slice(0, 10).map(({ network, reason, started, ended, more }) => ({
        network, reason, started, ended, more,
      })),
      alerts: mockAlerts().filter((a) => !a.cleared),
    } satisfies DashboardData
  }],
  ['GET', /^\/alerts$/, () => ({ records: mockAlerts().filter((a) => !a.cleared) })],
  ['GET', /^\/events\/(audit|blocks|changes|alerts)$/, (m, { query }) => {
    type Row = { id: number } & Record<string, unknown>
    const lists: Record<string, () => Row[]> = {
      audit: () => mockAudit() as unknown as Row[],
      blocks: () => mockBlocks() as unknown as Row[],
      changes: () => mockChanges() as unknown as Row[],
      alerts: () => mockAlerts() as unknown as Row[],
    }
    if (query?.since === undefined) throw new ApiError(400, 'invalid', 'since: required, Unix seconds')
    // in the range: an event by its time; a block or an alert open at any time in it
    const since = Number(query.since)
    const until = Number(query.until ?? Date.now() / 1000)
    const inRange = (r: Row) => {
      const start = Number(r.time ?? r.started ?? r.raised)
      const end = (r.ended ?? r.cleared ?? (r.time === undefined ? null : r.time)) as number | null | undefined
      return start <= until && (end === null || end === undefined || end >= since)
    }
    let records = lists[m[1]]().filter(inRange)
    const sev = { info: 0, warning: 1, critical: 2 } as Record<string, number>
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v === undefined || v === '' || ['since', 'until', 'limit', 'before'].includes(k)) continue
      records = records.filter((r) => (k === 'severity' ? sev[String(r.severity)] >= sev[String(v)] : r[k] === v))
    }
    const before = Number(query?.before ?? Infinity)
    const limit = Number(query?.limit ?? 100)
    const page = records.filter((r) => r.id < before).slice(0, limit)
    const more = records.filter((r) => r.id < before).length > limit
    return { records: page, next: more ? page[page.length - 1].id : null } satisfies EventPage<unknown>
  }],
  ['GET', /^\/events\/trends$/, (_, { query }): Trends => {
    if (query?.since === undefined) throw new ApiError(400, 'invalid', 'since: required, Unix seconds')
    const t = mockTrends(Number(query.since), Math.floor(Number(query.until ?? Date.now() / 1000)))
    if (query.source && query.source !== 'voidgate') return { ...t, coverage: [], series: [] }
    return t
  }],
  ['GET', /^\/config$/, (_, { query }): DeviceConfig => {
    if (query?.what === 'startup') {
      // the mock keeps no saved copy: the running one stands in for it, or the defaults with nothing saved
      return mock.saved
        ? { present: true, config: { hostname: 'sw1', interfaces: mock.interfaces, acls: mock.acls, voidGate: {}, feed: {} } }
        : { present: false, config: { hostname: 'seawall', interfaces: {}, acls: {}, voidGate: {}, feed: {} } }
    }
    return {
      generation: mock.generation,
      config: { hostname: 'sw1', interfaces: mock.interfaces, acls: mock.acls, voidGate: {}, feed: {} },
    }
  }],
  ['POST', /^\/acl\/entry$/, (_, { body }) => {
    const b = body as { acl: unknown; ace: unknown; seq?: unknown }
    const acl = aclNumber(b.acl)
    // the device writes an entry in its own form: a network A.B.C.D/len as "host A", "any" or "A <wildcard>"
    const ace = String(b.ace ?? '').trim().replace(/\s+/g, ' ').replace(/(\d+\.\d+\.\d+\.\d+)\/(\d+)/g, (_, ip, len) => {
      const n = Number(len)
      if (n === 32) return `host ${ip}`
      if (n === 0) return 'any'
      const wc = 2 ** (32 - n) - 1
      return `${ip} ${[24, 16, 8, 0].map((sh) => (wc >>> sh) & 255).join('.')}`
    })
    const words = ace.split(' ')
    if (words[0] !== 'permit' && words[0] !== 'deny') throw invalid(`"${ace}": must start with permit or deny`)
    if (words.length < 2) throw invalid(`"${ace}": missing the source`)
    if (!isStandard(acl) && words.length < 4) {
      throw invalid(`"${ace}": an extended entry needs a protocol, a source and a destination`)
    }
    const list = (mock.acls[acl] ??= [])
    let seq: number
    if (b.seq === undefined) {
      seq = (list.at(-1)?.seq ?? 0) + 10
    } else {
      seq = Number(b.seq)
      if (!Number.isInteger(seq) || seq < 1 || seq > 65535) throw invalid('sequence must be 1 to 65535')
      if (list.some((e) => e.seq === seq)) throw invalid(`access list ${acl} already has sequence ${seq}`)
    }
    list.push({ seq, ace })
    list.sort((x, y) => x.seq - y.seq)
    return changed({ seq })
  }],
  ['DELETE', /^\/acl\/entry$/, (_, { query }) => {
    const acl = aclNumber(query?.acl)
    const list = mock.acls[acl]
    if (!list) throw invalid(`access list ${acl} does not exist`)
    const i = list.findIndex((e) => e.seq === Number(query?.seq))
    if (i < 0) throw invalid(`access list ${acl} has no sequence ${query?.seq}`)
    const [entry] = list.splice(i, 1)
    return changed({ seq: entry.seq })
  }],
  ['POST', /^\/acl$/, (_, { body }) => {
    const acl = aclNumber((body as { acl: unknown }).acl)
    if (mock.acls[acl]) return unchanged()
    mock.acls[acl] = []
    return changed()
  }],
  ['DELETE', /^\/acl$/, (_, { query }) => {
    const acl = aclNumber(query?.acl)
    if (!mock.acls[acl]) throw invalid(`access list ${acl} does not exist`)
    const user = Object.entries(mock.interfaces).find(([, i]) => i.acls_in.includes(acl))
    if (user) throw invalid(`access list ${acl} is applied to ${user[0]}; remove it there first`)
    delete mock.acls[acl]
    return changed()
  }],
  ['POST', /^\/interface\/acl$/, (_, { body }) => {
    const b = body as { interface: unknown; acl: unknown }
    const name = String(b.interface ?? '')
    if (!/^[A-Za-z0-9_.-]{1,15}$/.test(name)) throw invalid(`"${name}" is not an interface name`)
    const acl = aclNumber(b.acl)
    const iface = (mock.interfaces[name] ??= { acls_in: [] })
    if (iface.acls_in.includes(acl)) return unchanged()
    // at most one standard and one extended list: this one replaces its kind
    iface.acls_in = [...iface.acls_in.filter((a) => isStandard(a) !== isStandard(acl)), acl].sort((x, y) => x - y)
    return changed()
  }],
  ['DELETE', /^\/interface\/acl$/, (_, { query }) => {
    const name = String(query?.interface ?? '')
    const acl = aclNumber(query?.acl)
    const iface = mock.interfaces[name]
    if (!iface?.acls_in.includes(acl)) throw invalid(`${name} does not apply access list ${acl}`)
    iface.acls_in = iface.acls_in.filter((a) => a !== acl)
    return changed()
  }],
  ['DELETE', /^\/interface$/, (_, { query }) => {
    const name = String(query?.interface ?? '')
    if (!mock.interfaces[name]) throw invalid(`${name} has no configuration`)
    delete mock.interfaces[name]
    return changed()
  }],
  ['GET', /^\/acl-engine$/, (): AclEngine => {
    // the Mock engine state select on the Access Lists page sets engineState
    const state: AclEngineState =
      mock.engineState !== 'auto' ? mock.engineState : Date.now() - mock.changedAt < 3000 ? 'pending' : 'applied'
    const since = Math.floor((state === 'pending' ? mock.changedAt || Date.now() : mock.loginAt - 3_600_000) / 1000)
    const names = Object.keys(mock.interfaces)
    // eth9 doesn't exist; an interface added in the mock does, unless its name starts with "x"
    const exists = (n: string) => n !== 'eth9' && !n.startsWith('x')
    const base = { state, since, socket: '/run/mfwd.sock' as string | null }
    if (state === 'off') return { ...base, socket: null, live: false }
    if (state === 'unreachable') return { ...base, live: false }
    mock.counters.xdp_pass += rand(500, 5000)
    mock.counters.xdp_drop += rand(0, 200)
    return {
      ...base,
      ...(state === 'refused' ? { error: 'extended list 100 has 131 ACEs; at most 128 can be bound' } : {}),
      ...(state === 'applied' ? { config_generation: mock.generation, mfwd_generation: mock.generation + 3 } : {}),
      live: true,
      attached: names.filter(exists),
      missing: names.filter((n) => !exists(n)),
      flows: mock.flows,
      counters: { ...mock.counters },
      reply_misses: [
        { time_ms: Date.now() - 42_000, interface: 'eth0', proto: 6, src: '198.51.100.7', dst: '10.0.0.5',
          sport: 443, dport: 41022, tcp_flags: 16, icmp_type: 0, icmp_code: 0 },
        { time_ms: Date.now() - 600_000, interface: 'eth0', proto: 17, src: '203.0.113.5', dst: '10.0.0.5',
          sport: 123, dport: 123, tcp_flags: 0, icmp_type: 0, icmp_code: 0 },
      ],
    }
  }],
  ['GET', /^\/config\/pending$/, (): ConfigPending => ({ dirty: mock.dirty, present: mock.saved })],
  ['POST', /^\/config\/save$/, () => {
    mock.dirty = false
    mock.saved = true
    return {}
  }],
]

/** The diagnostic bundle: mockDiagBusy(true) in the console makes it 409, as when one is being built. */
let diagBusy = false
;(globalThis as { mockDiagBusy?: (b: boolean) => void }).mockDiagBusy = (b) => {
  diagBusy = b
}

export async function mockDiag(): Promise<Blob> {
  await new Promise((r) => setTimeout(r, 1500))
  if (!getToken()) throw new ApiError(401, 'expired', 'no token')
  if (diagBusy) throw new ApiError(409, 'busy', 'a diagnostic bundle is already being built')
  // not a real tar.gz: the mock only shows the download
  return new Blob(['mock diagnostic bundle\n'], { type: 'application/gzip' })
}

/**
 * One request to the mock: its reply, and the session's seconds left as the X-SW-Session-Left header
 * would give them (null for a login). A request counts as activity unless it is a background one.
 */
export async function mockRequest<T>(
  method: string,
  path: string,
  opts: RequestOptions,
): Promise<{ data: T; secsLeft: number | null }> {
  await new Promise((r) => setTimeout(r, rand(100, 300)))
  const isLogin = method === 'POST' && path === '/session'
  if (!isLogin) {
    if (!getToken()) throw new ApiError(401, 'expired', 'no token')
    const now = Date.now()
    if (secsLeft(now) <= 0) throw new ApiError(401, 'denied', 'denied')
    if (!opts.background) mock.activeAt = now
  }
  for (const [m, re, handler] of mockRoutes) {
    const match = m === method && path.match(re)
    if (match) {
      return { data: structuredClone(handler(match, opts)) as T, secsLeft: isLogin ? null : secsLeft(Date.now()) }
    }
  }
  throw new ApiError(404, 'invalid', `Not in the mock: ${method} ${path}`)
}
