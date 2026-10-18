import { ref } from 'vue'
import { createDiscreteApi } from 'naive-ui'
import { router } from './router'
import { clearSession, getSession, getToken, setSession, type Session } from './auth'
import { ApiError } from './types'
import type { AclRule, AclRuleInput, DashboardData, RequestOptions, Role } from './types'

export * from './types'
export { getRole, getToken, getUsername } from './auth'

/**
 * Mock mode is controlled by VITE_USE_MOCK (see .env.development).
 * Production builds have no .env.production, so this is false there and the
 * mock module is never loaded — it is not even part of the bundle.
 */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

const BASE = '/api'
/** Warn this long before the token runs out. */
const EXPIRY_WARNING_MS = 60_000

const { message } = createDiscreteApi(['message'])

// ---------- auth state ----------

/** Whether the backend has confirmed the stored token since the page loaded. */
let verified: Promise<boolean> | null = null
let warnTimer: number | undefined
let expireTimer: number | undefined

/** Stores the session and sets the timers that warn before it runs out and end it when it has. */
function startSession(s: Session) {
  setSession(s)

  window.clearTimeout(warnTimer)
  window.clearTimeout(expireTimer)
  const left = s.expiresAt - Date.now()
  if (left > EXPIRY_WARNING_MS) {
    warnTimer = window.setTimeout(
      () => message.warning('登录将在 1 分钟后过期，请保存正在编辑的内容', { duration: 10_000 }),
      left - EXPIRY_WARNING_MS,
    )
  }
  expireTimer = window.setTimeout(() => {
    message.warning('登录已过期，请重新登录')
    endSession()
  }, Math.max(left, 0))
}

function dropSession() {
  clearSession()
  verified = null
  window.clearTimeout(warnTimer)
  window.clearTimeout(expireTimer)
}

/** Drops the session and goes to the login page, back here after the next login. */
function endSession() {
  dropSession()
  const current = router.currentRoute.value
  if (!current.meta.public) router.replace({ path: '/login', query: { redirect: current.fullPath } })
}

/** Logs out: ends the token on the backend, and drops it here whether or not that worked. */
export function logout() {
  const token = getToken()
  if (token && !USE_MOCK) {
    // not through request(): a 401 here must not start another logout
    fetch(BASE + '/session', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {})
  }
  endSession()
}

/** Number of config changes not yet persisted with "Save Config". */
export const pendingChanges = ref(0)

// ---------- request core ----------

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  try {
    if (USE_MOCK) {
      const { mockRequest } = await import('./mock')
      return await mockRequest<T>(method, path, opts)
    }
    return await fetchRequest<T>(method, path, opts)
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(0, null, '网络错误，请稍后重试')
    if (opts.silent) throw err
    if (err.status === 401) {
      // the token expired or was ended
      message.warning('登录已过期，请重新登录')
      endSession()
    } else {
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
  // nginx's own errors (413, 429, ...) are HTML pages
  const isJson = (res.headers.get('Content-Type') ?? '').startsWith('application/json')
  const data = isJson ? await res.json().catch(() => undefined) : undefined
  if (!res.ok) {
    const fallback = res.status === 429 ? '尝试过于频繁，请稍后再试' : `请求失败 (${res.status})`
    throw new ApiError(res.status, data?.code ?? null, data?.error ?? fallback)
  }
  return data as T
}

const get = <T>(path: string, query?: RequestOptions['query'], silent?: boolean) =>
  request<T>('GET', path, { query, silent })
const post = <T>(path: string, body?: unknown, silent?: boolean) => request<T>('POST', path, { body, silent })
const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, { body })
const del = <T>(path: string) => request<T>('DELETE', path)

// ---------- endpoints ----------

/** Logs in. Throws ApiError: 401 for a wrong user name or password, 429 over the login limit. */
export async function login(user: string, password: string) {
  const res = await post<{ token: string; ttl: number; role: Role }>('/session', { user, password }, true)
  // the backend accepted this exact name, so it is the session's user
  startSession({ token: res.token, user, role: res.role, expiresAt: Date.now() + res.ttl * 1000 })
  verified = Promise.resolve(true)
}

/**
 * Whether there is a usable session. The first call after a page load checks the stored token with
 * GET /session and refreshes the user, role and time left; a token the backend refuses is dropped.
 * If the backend can't be asked, the stored session is kept and the next call will find out.
 */
export function ensureSession(): Promise<boolean> {
  if (!getSession()) return Promise.resolve(false)
  verified ??= get<{ user: string; role: Role; secs_left: number }>('/session', undefined, true).then(
    (s) => {
      const stored = getSession()
      if (!stored) return false // logged out meanwhile
      startSession({ token: stored.token, user: s.user, role: s.role, expiresAt: Date.now() + s.secs_left * 1000 })
      return true
    },
    (e) => {
      if (e instanceof ApiError && e.status === 401) {
        dropSession()
        return false
      }
      const stored = getSession()
      if (stored) startSession(stored) // restart the expiry timers from the stored time
      verified = null
      return stored !== null
    },
  )
  return verified
}

export const fetchDashboard = () => get<DashboardData>('/dashboard')

/** All rules in one call; the ACL page filters and pages them in the browser. */
export const listAclRules = () => get<AclRule[]>('/acl/rules')
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
