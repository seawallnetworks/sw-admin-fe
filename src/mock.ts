// In-browser mock backend. Only loaded via dynamic import when VITE_USE_MOCK=true,
// so it (and the admin/admin login) never ships in a production build.

import { getToken } from './auth'
import { ApiError } from './types'
import type { AclEngine, AclEngineState, AclEntry, DashboardData, DeviceConfig, EventType, RequestOptions } from './types'

type MockHandler = (m: RegExpMatchArray, opts: RequestOptions) => unknown

const MOCK_TTL = 900

const mock = {
  /** The mock's login time is per page load, so a reload restarts the 15 minutes. */
  loginAt: Date.now(),
  /** Whether a change was made since the last save; the real backend compares running and startup. */
  dirty: false,
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
    // empty: applying it shows the "Everything will be dropped" warning
    '120': [],
  } as Record<string, AclEntry[]>,
  interfaces: {
    eth0: { acls_in: [10, 100] },
    // applies a list but doesn't exist, so the engine lists it as missing
    eth9: { acls_in: [110] },
  } as Record<string, { acls_in: number[] }>,
  counters: { xdp_pass: 18342, xdp_drop: 211 },
  /** The engine state to report; 'auto' is applied, or pending just after a change. */
  engineState: 'auto' as AclEngineState | 'auto',
}

const rand = (min: number, max: number) => Math.floor(min + Math.random() * (max - min))

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

;(globalThis as { mockEngineState?: (s: string) => void }).mockEngineState = (s) => {
  mock.engineState = s as AclEngineState | 'auto'
}

const mockRoutes: [string, RegExp, MockHandler][] = [
  ['POST', /^\/session$/, (_, { body }) => {
    const { user, password } = body as { user: string; password: string }
    if (user === 'admin' && password === 'admin') {
      mock.loginAt = Date.now()
      return { token: '0123456789abcdef0123456789abcdef', ttl: MOCK_TTL, role: 'admin' }
    }
    throw new ApiError(401, 'denied', 'denied')
  }],
  ['GET', /^\/session$/, () => ({
    user: 'admin',
    role: 'admin',
    secs_left: Math.max(0, MOCK_TTL - Math.floor((Date.now() - mock.loginAt) / 1000)),
  })],
  ['DELETE', /^\/session$/, () => ({})],
  ['GET', /^\/dashboard$/, () => {
    // epoch seconds, on the 5-second grid
    const now = Math.floor(Date.now() / 5000) * 5
    const traffic = Array.from({ length: 30 }, (_, i) => {
      const time = now - (29 - i) * 5
      const inbound_pps = Math.round(120000 + 40000 * Math.sin(time / 60) + rand(0, 15000))
      return { time, inbound_pps, dropped_pps: Math.round(inbound_pps * (0.05 + Math.random() * 0.1)) }
    })
    const last = traffic[traffic.length - 1]
    const types: EventType[] = ['acl_deny', 'syn_flood', 'http_flood', 'cc', 'brute_force']
    let t = now
    return {
      inbound_pps: last.inbound_pps,
      dropped_pps: last.dropped_pps,
      active_acl_rules: Object.values(mock.interfaces)
        .flatMap((i) => i.acls_in)
        .reduce((n, acl) => n + (mock.acls[acl]?.length ?? 0), 0),
      syn_protection: true,
      traffic,
      events: Array.from({ length: 10 }, () => ({
        time: (t -= rand(3, 20)),
        src_ip: `${rand(1, 223)}.${rand(0, 255)}.${rand(0, 255)}.${rand(1, 254)}`,
        type: types[rand(0, types.length)],
        target: `10.0.0.${rand(2, 30)}:${[80, 443, 22][rand(0, 3)]}`,
        action: 'drop' as const,
      })),
    } satisfies DashboardData
  }],
  ['GET', /^\/config$/, (): DeviceConfig => ({
    generation: mock.generation,
    config: { hostname: 'sw1', interfaces: mock.interfaces, acls: mock.acls, voidGate: {}, feed: {} },
  })],
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
      counters: { ...mock.counters },
    }
  }],
  ['GET', /^\/config\/pending$/, () => ({ dirty: mock.dirty })],
  ['POST', /^\/config\/save$/, () => {
    mock.dirty = false
    return {}
  }],
]

export async function mockRequest<T>(method: string, path: string, opts: RequestOptions): Promise<T> {
  await new Promise((r) => setTimeout(r, rand(100, 300)))
  if (!(method === 'POST' && path === '/session') && !getToken()) throw new ApiError(401, 'expired', 'no token')
  for (const [m, re, handler] of mockRoutes) {
    const match = m === method && path.match(re)
    if (match) return structuredClone(handler(match, opts)) as T
  }
  throw new ApiError(404, 'invalid', `Not in the mock: ${method} ${path}`)
}
