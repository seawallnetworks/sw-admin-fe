import { ref } from 'vue'
import { createDiscreteApi } from 'naive-ui'
import { router } from './router'

/** Flip to false to talk to the real backend (proxied to 127.0.0.1:8080 in dev). */
export const USE_MOCK = true

const BASE = '/api'
const TOKEN_KEY = 'sw_token'
const USER_KEY = 'sw_user'

const { message } = createDiscreteApi(['message'])

// ---------- types ----------

export type AclAction = 'allow' | 'deny'
export type Protocol = 'TCP' | 'UDP' | 'ICMP' | 'ANY'

export interface AclRule {
  id: number
  priority: number
  name: string
  source: string
  protocol: Protocol
  port: string
  action: AclAction
  hits: number
  enabled: boolean
}

export type AclRuleInput = Omit<AclRule, 'id' | 'hits'>

export interface Page<T> {
  items: T[]
  total: number
}

export interface BlockedEvent {
  time: string
  srcIp: string
  type: string
  target: string
  action: string
}

export interface DashboardData {
  inboundPps: number
  droppedPps: number
  activeAclRules: number
  synProtection: boolean
  traffic: { time: string; inbound: number; dropped: number }[]
  events: BlockedEvent[]
}

// ---------- auth state ----------

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const getUsername = () => localStorage.getItem(USER_KEY) ?? ''

export function logout() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  router.replace({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } })
}

/** Number of config changes not yet persisted with "Save Config". */
export const pendingChanges = ref(0)

// ---------- request core ----------

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

interface RequestOptions {
  query?: Record<string, string | number | undefined>
  body?: unknown
  /** Don't show a toast on error; caller handles it. */
  silent?: boolean
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  try {
    return USE_MOCK ? await mockRequest<T>(method, path, opts) : await fetchRequest<T>(method, path, opts)
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(0, '网络错误，请稍后重试')
    if (err.status === 401 && path !== '/auth/login') {
      message.warning('登录已过期，请重新登录')
      logout()
    } else if (!opts.silent) {
      message.error(err.message)
    }
    throw err
  }
}

async function fetchRequest<T>(method: string, path: string, { query, body }: RequestOptions): Promise<T> {
  const url = new URL(BASE + path, location.origin)
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  }
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = res.status === 204 ? undefined : await res.json().catch(() => undefined)
  if (!res.ok) throw new ApiError(res.status, data?.message ?? `请求失败 (${res.status})`)
  return data as T
}

const get = <T>(path: string, query?: RequestOptions['query'], silent?: boolean) =>
  request<T>('GET', path, { query, silent })
const post = <T>(path: string, body?: unknown, silent?: boolean) => request<T>('POST', path, { body, silent })
const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, { body })
const del = <T>(path: string) => request<T>('DELETE', path)

// ---------- endpoints ----------

export async function login(username: string, password: string) {
  const res = await post<{ token: string }>('/auth/login', { username, password }, true)
  localStorage.setItem(TOKEN_KEY, res.token)
  localStorage.setItem(USER_KEY, username)
}

export const fetchDashboard = () => get<DashboardData>('/dashboard')

export const listAclRules = (q: { keyword?: string; action?: AclAction; page: number; pageSize: number }) =>
  get<Page<AclRule>>('/acl/rules', q)
export const createAclRule = (rule: AclRuleInput) => post<AclRule>('/acl/rules', rule)
export const updateAclRule = (id: number, patch: Partial<AclRuleInput>) => put<AclRule>(`/acl/rules/${id}`, patch)
export const deleteAclRule = (id: number) => del<void>(`/acl/rules/${id}`)

export async function refreshPendingChanges() {
  pendingChanges.value = (await get<{ count: number }>('/config/pending')).count
}
export async function saveConfig() {
  await post<void>('/config/save')
  pendingChanges.value = 0
}

// ---------- mock backend ----------

type MockHandler = (m: RegExpMatchArray, opts: RequestOptions) => unknown

const mock = {
  pending: 0,
  nextId: 1,
  rules: [] as AclRule[],
}

{
  const names = ['办公网段', '运维跳板机', '海外扫描源', '数据库访问', 'DNS 服务', 'SSH 白名单', '恶意 IP 段', '监控探针']
  const protos: Protocol[] = ['TCP', 'UDP', 'ICMP', 'ANY']
  for (let i = 0; i < 57; i++) {
    const protocol = protos[i % 4]
    mock.rules.push({
      id: mock.nextId++,
      priority: (i + 1) * 10,
      name: `${names[i % names.length]} ${Math.floor(i / names.length) + 1}`,
      source: `${10 + (i % 180)}.${(i * 37) % 256}.${(i * 11) % 256}.0/24`,
      protocol,
      port: protocol === 'ICMP' || protocol === 'ANY' ? '*' : String([22, 53, 80, 443, 3306, 8080][i % 6]),
      action: i % 3 === 0 ? 'allow' : 'deny',
      hits: Math.floor(Math.random() * 100000),
      enabled: i % 7 !== 0,
    })
  }
}

const fmtTime = (d: Date) => d.toLocaleTimeString('zh-CN', { hour12: false })
const rand = (min: number, max: number) => Math.floor(min + Math.random() * (max - min))

const mockRoutes: [string, RegExp, MockHandler][] = [
  ['POST', /^\/auth\/login$/, (_, { body }) => {
    const { username, password } = body as { username: string; password: string }
    if (username === 'admin' && password === 'admin') return { token: 'mock-token' }
    throw new ApiError(401, '用户名或密码错误')
  }],
  ['GET', /^\/dashboard$/, () => {
    const now = Date.now()
    const traffic = Array.from({ length: 30 }, (_, i) => {
      const t = now - (29 - i) * 5000
      const inbound = Math.round(120000 + 40000 * Math.sin(t / 60000) + rand(0, 15000))
      return { time: fmtTime(new Date(t)), inbound, dropped: Math.round(inbound * (0.05 + Math.random() * 0.1)) }
    })
    const last = traffic[traffic.length - 1]
    const types = ['SYN Flood', 'ACL 拒绝', 'HTTP Flood', 'CC 攻击', 'SSH 暴力破解']
    return {
      inboundPps: last.inbound,
      droppedPps: last.dropped,
      activeAclRules: mock.rules.filter((r) => r.enabled).length,
      synProtection: true,
      traffic,
      events: Array.from({ length: 10 }, (_, i) => ({
        time: fmtTime(new Date(now - i * rand(3000, 20000))),
        srcIp: `${rand(1, 223)}.${rand(0, 255)}.${rand(0, 255)}.${rand(1, 254)}`,
        type: types[rand(0, types.length)],
        target: `10.0.0.${rand(2, 30)}:${[80, 443, 22][rand(0, 3)]}`,
        action: '丢弃',
      })),
    } satisfies DashboardData
  }],
  ['GET', /^\/acl\/rules$/, (_, { query = {} }) => {
    const keyword = String(query.keyword ?? '').toLowerCase()
    const page = Number(query.page ?? 1)
    const pageSize = Number(query.pageSize ?? 10)
    const items = mock.rules
      .filter((r) => !query.action || r.action === query.action)
      .filter((r) => !keyword || r.name.toLowerCase().includes(keyword) || r.source.includes(keyword))
      .sort((a, b) => a.priority - b.priority)
    return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length }
  }],
  ['POST', /^\/acl\/rules$/, (_, { body }) => {
    const rule: AclRule = { ...(body as AclRuleInput), id: mock.nextId++, hits: 0 }
    mock.rules.push(rule)
    mock.pending++
    return rule
  }],
  ['PUT', /^\/acl\/rules\/(\d+)$/, (m, { body }) => {
    const rule = mock.rules.find((r) => r.id === Number(m[1]))
    if (!rule) throw new ApiError(404, '规则不存在')
    Object.assign(rule, body)
    mock.pending++
    return rule
  }],
  ['DELETE', /^\/acl\/rules\/(\d+)$/, (m) => {
    mock.rules = mock.rules.filter((r) => r.id !== Number(m[1]))
    mock.pending++
  }],
  ['GET', /^\/config\/pending$/, () => ({ count: mock.pending })],
  ['POST', /^\/config\/save$/, () => {
    mock.pending = 0
  }],
]

async function mockRequest<T>(method: string, path: string, opts: RequestOptions): Promise<T> {
  await new Promise((r) => setTimeout(r, rand(100, 300)))
  if (path !== '/auth/login' && !getToken()) throw new ApiError(401, '未登录')
  for (const [m, re, handler] of mockRoutes) {
    const match = m === method && path.match(re)
    if (match) return structuredClone(handler(match, opts)) as T
  }
  throw new ApiError(404, `Mock 未实现: ${method} ${path}`)
}
