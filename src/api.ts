import { ref } from 'vue'
import { createDiscreteApi } from 'naive-ui'
import { router } from './router'
import { clearSession, getToken, setSession } from './auth'
import { ApiError } from './types'
import type { AclRule, AclRuleInput, DashboardData, RequestOptions } from './types'

export * from './types'
export { getToken, getUsername } from './auth'

/**
 * Mock mode is controlled by VITE_USE_MOCK (see .env.development).
 * Production builds have no .env.production, so this is false there and the
 * mock module is never loaded — it is not even part of the bundle.
 */
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

const BASE = '/api'

const { message } = createDiscreteApi(['message'])

// ---------- auth state ----------

export function logout() {
  clearSession()
  router.replace({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } })
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
  setSession(res.token, username)
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
