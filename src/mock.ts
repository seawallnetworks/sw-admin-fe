// In-browser mock backend. Only loaded via dynamic import when VITE_USE_MOCK=true,
// so it (and the admin/admin login) never ships in a production build.

import { getToken } from './auth'
import { ApiError } from './types'
import type { AclRule, AclRuleInput, DashboardData, EventType, Protocol, RequestOptions } from './types'

type MockHandler = (m: RegExpMatchArray, opts: RequestOptions) => unknown

const MOCK_TTL = 900

const mock = {
  /** The mock's login time is per page load, so a reload restarts the 15 minutes. */
  loginAt: Date.now(),
  /** Whether a change was made since the last save; the real backend compares running and startup. */
  dirty: false,
  nextId: 1,
  rules: [] as AclRule[],
}

function portless(p: Protocol) {
  return p === 'icmp' || p === 'any'
}

{
  const names = ['办公网段', '运维跳板机', '海外扫描源', '数据库访问', 'DNS 服务', 'SSH 白名单', '恶意 IP 段', '监控探针']
  const protos: Protocol[] = ['tcp', 'udp', 'icmp', 'any']
  for (let i = 0; i < 57; i++) {
    const protocol = protos[i % 4]
    mock.rules.push({
      id: mock.nextId++,
      priority: (i + 1) * 10,
      name: `${names[i % names.length]} ${Math.floor(i / names.length) + 1}`,
      source: `${10 + (i % 180)}.${(i * 37) % 256}.${(i * 11) % 256}.0/24`,
      protocol,
      port: portless(protocol) ? null : String([22, 53, 80, 443, 3306, 8080][i % 6]),
      action: i % 3 === 0 ? 'allow' : 'deny',
      hits: Math.floor(Math.random() * 100000),
      enabled: i % 7 !== 0,
    })
  }
}

const rand = (min: number, max: number) => Math.floor(min + Math.random() * (max - min))

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
      active_acl_rules: mock.rules.filter((r) => r.enabled).length,
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
  ['GET', /^\/acl\/rules$/, () => [...mock.rules].sort((a, b) => a.priority - b.priority)],
  ['POST', /^\/acl\/rules$/, (_, { body }) => {
    const rule: AclRule = { ...(body as AclRuleInput), id: mock.nextId++, hits: 0 }
    if (portless(rule.protocol)) rule.port = null
    mock.rules.push(rule)
    mock.dirty = true
    return rule
  }],
  ['PUT', /^\/acl\/rules\/(\d+)$/, (m, { body }) => {
    const rule = mock.rules.find((r) => r.id === Number(m[1]))
    if (!rule) throw new ApiError(404, 'invalid', '规则不存在')
    Object.assign(rule, body)
    if (portless(rule.protocol)) rule.port = null
    mock.dirty = true
    return rule
  }],
  ['DELETE', /^\/acl\/rules\/(\d+)$/, (m) => {
    mock.rules = mock.rules.filter((r) => r.id !== Number(m[1]))
    mock.dirty = true
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
  throw new ApiError(404, 'invalid', `Mock 未实现: ${method} ${path}`)
}
