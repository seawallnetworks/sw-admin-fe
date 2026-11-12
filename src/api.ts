import { computed, ref } from 'vue'
import { createDiscreteApi, type DialogReactive } from 'naive-ui'
import { router } from './router'
import { clearSession, getRole, getSession, getToken, setSession, type Session } from './auth'
import { ApiError } from './types'
import { naiveTheme } from './theme'
import type { AclEngine, ChangeReply, DashboardData, DeviceConfig, RequestOptions, Role } from './types'

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
/** Input in the page is sent to the backend as activity at most this often. */
const HEARTBEAT_MS = 60_000
/** The user being here: input in the page, not just the pointer passing over it. */
const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'wheel', 'focus'] as const

// outside App.vue's NConfigProvider, so it is given the theme itself
const { message, dialog } = createDiscreteApi(['message', 'dialog'], {
  configProviderProps: computed(() => naiveTheme.value),
})

// ---------- auth state ----------
//
// The token ends after the backend's idle timeout without activity, and at its time limit however
// active the user is (proposal 0014). Every request counts as activity except a background one (a
// poll, see usePoller.ts), and so does input in the page, sent at most once a minute. Every reply that
// knows says how long the token has left (X-SW-Session-Left), and that moves the timers here.

/** Whether the backend has confirmed the stored token since the page loaded. */
let verified: Promise<boolean> | null = null
let warnTimer: number | undefined
let expireTimer: number | undefined
let heartbeatTimer: number | undefined
let countdownTimer: number | undefined
/** Input in the page since it was last sent as activity. */
let userActive = false
let watchingActivity = false
/** The last activity reply had less than the idle timeout left: the time limit is near, and can't be pushed back. */
let limitNear = false
/** The user has seen the time-limit warning; it isn't shown again. */
let limitWarned = false
/** Asking the backend before warning. */
let checking = false
let warning: DialogReactive | null = null
const countdown = ref(0)

const secsLeft = () => Math.max(0, Math.round(((getSession()?.expiresAt ?? 0) - Date.now()) / 1000))

/** Stores the session and sets its timers. */
function startSession(s: Session) {
  setSession(s)
  schedule()
  watchActivity()
}

/** Sets the timers from the stored session's end: a check before warning, and one at the end. */
function schedule() {
  window.clearTimeout(warnTimer)
  window.clearTimeout(expireTimer)
  const s = getSession()
  if (!s) return
  const left = s.expiresAt - Date.now()
  if (left > EXPIRY_WARNING_MS) {
    closeWarning()
    warnTimer = window.setTimeout(checkBeforeWarning, left - EXPIRY_WARNING_MS)
  } else if (!warning && !checking && !limitWarned) {
    warnTimer = window.setTimeout(checkBeforeWarning, 0)
  }
  expireTimer = window.setTimeout(checkBeforeExpiry, Math.max(left, 0))
}

/**
 * A reply gave the seconds left of `token`, the one its request was sent with; `activity`: whether the
 * request counted as activity. A late reply for a token since logged out is ignored.
 */
function noteSecsLeft(token: string | null, secs: number, activity: boolean) {
  const s = getSession()
  if (!s || s.token !== token) return
  if (activity && s.idle !== undefined) limitNear = secs < s.idle
  setSession({ ...s, expiresAt: Date.now() + secs * 1000 })
  schedule()
}

/**
 * Asks the backend for the token's time left, as activity or only reading it; the reply moves the
 * timers. False once the token has ended. If the backend can't be asked, the timers stay as they are.
 */
async function checkSession(background: boolean): Promise<boolean> {
  try {
    await get('/session', undefined, { silent: true, background })
    return true
  } catch (e) {
    return !(e instanceof ApiError && e.status === 401)
  }
}

/** Whether there was input in the page since it was last sent; clears it. */
function takeActivity() {
  const active = userActive
  userActive = false
  return active
}

async function checkBeforeWarning() {
  checking = true
  let alive = true
  try {
    // input since the last heartbeat is activity, and no reason to warn; otherwise the token may still
    // have been extended, by a duplicated tab
    alive = await checkSession(!takeActivity())
  } finally {
    checking = false
  }
  if (!alive) expired()
  else if (secsLeft() * 1000 <= EXPIRY_WARNING_MS) showWarning()
}

async function checkBeforeExpiry() {
  if (getSession() && (await checkSession(true)) && secsLeft() > 0) return // extended meanwhile
  expired()
}

function expired() {
  if (!getSession()) return
  message.warning('Your session has expired. Please log in again.')
  endSession()
}

/** The modal before the end: "Stay signed in" for the idle timeout, or a notice at the time limit. */
function showWarning() {
  if (warning || (limitNear && limitWarned)) return
  const atLimit = limitNear
  countdown.value = secsLeft()
  countdownTimer = window.setInterval(() => (countdown.value = secsLeft()), 1000)
  warning = dialog.warning({
    title: atLimit ? 'Session time limit' : 'Are you still there?',
    content: () =>
      atLimit
        ? `Your session reaches its time limit in ${countdown.value} s and can't be extended. Save your work.`
        : `You'll be signed out in ${countdown.value} s because of inactivity.`,
    positiveText: atLimit ? 'OK' : 'Stay signed in',
    negativeText: atLimit ? undefined : 'Sign out',
    closable: false,
    maskClosable: false,
    closeOnEsc: false,
    onPositiveClick: async () => {
      if (atLimit) {
        limitWarned = true
        closeWarning()
        return false
      }
      // activity: once the reply gives the token more than a minute, schedule() closes this
      if (!(await checkSession(false))) {
        expired()
      } else if (warning && limitNear) {
        // it can't be extended after all: say so instead
        closeWarning()
        showWarning()
      }
      return false
    },
    onNegativeClick: () => {
      logout()
      return false
    },
  })
}

function closeWarning() {
  window.clearInterval(countdownTimer)
  const w = warning
  warning = null
  w?.destroy()
}

function onActivity() {
  // the warning's own focus isn't the user; there, only "Stay signed in" counts
  if (!warning) userActive = true
}

function onVisibilityChange() {
  // timers in a hidden tab run late, if at all: ask how long the token has left
  if (!document.hidden && getSession()) checkSession(true).then((alive) => alive || expired())
}

/** Listens for input in the page, and sends it as activity at most once a minute. */
function watchActivity() {
  if (watchingActivity) return
  watchingActivity = true
  for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { capture: true, passive: true })
  document.addEventListener('visibilitychange', onVisibilityChange)
  heartbeatTimer = window.setInterval(() => {
    if (takeActivity()) checkSession(false).then((alive) => alive || expired())
  }, HEARTBEAT_MS)
}

function unwatchActivity() {
  watchingActivity = false
  for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity, { capture: true })
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.clearInterval(heartbeatTimer)
}

function dropSession() {
  clearSession()
  verified = null
  window.clearTimeout(warnTimer)
  window.clearTimeout(expireTimer)
  closeWarning()
  unwatchActivity()
  userActive = false
  limitNear = false
  limitWarned = false
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

/** Whether the configuration in effect differs from the saved one ("Save Config" saves it). */
export const unsavedChanges = ref(false)

// ---------- request core ----------

async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  try {
    if (USE_MOCK) {
      const token = getToken()
      const { mockRequest } = await import('./mock')
      const { data, secsLeft } = await mockRequest<T>(method, path, opts)
      if (secsLeft !== null) noteSecsLeft(token, secsLeft, !opts.background)
      return data
    }
    return await fetchRequest<T>(method, path, opts)
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(0, null, 'Network error. Please try again later.')
    if (opts.silent) throw err
    if (err.status === 401) {
      // the token expired or was ended
      message.warning('Your session has expired. Please log in again.')
      endSession()
    } else if (err.status === 502) {
      message.error("The device isn't responding. Please try again.")
    } else if (err.status === 503) {
      message.error('The device is busy. Please try again in a few seconds.')
    } else {
      message.error(err.message)
    }
    throw err
  }
}

async function fetchRequest<T>(method: string, path: string, { query, body, background }: RequestOptions): Promise<T> {
  const url = new URL(BASE + path, location.origin)
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  }
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (background) headers['X-SW-Background'] = '1'

  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const left = res.headers.get('X-SW-Session-Left')
  if (left !== null && /^\d+$/.test(left)) noteSecsLeft(token, Number(left), !background)
  // nginx's own errors (413, 429, ...) are HTML pages
  const isJson = (res.headers.get('Content-Type') ?? '').startsWith('application/json')
  const data = isJson ? await res.json().catch(() => undefined) : undefined
  if (!res.ok) {
    const fallback = res.status === 429 ? 'Too many attempts. Please try again later.' : `Request failed (${res.status})`
    throw new ApiError(res.status, data?.code ?? null, data?.error ?? fallback)
  }
  return data as T
}

type GetOptions = Pick<RequestOptions, 'silent' | 'background'>
const get = <T>(path: string, query?: RequestOptions['query'], opts: GetOptions = {}) =>
  request<T>('GET', path, { query, ...opts })
const post = <T>(path: string, body?: unknown, silent?: boolean) => request<T>('POST', path, { body, silent })
/** A DELETE takes its arguments in the query, with no body. */
const del = <T>(path: string, query?: RequestOptions['query']) => request<T>('DELETE', path, { query })

// ---------- endpoints ----------

/** Logs in. Throws ApiError: 401 for a wrong user name or password, 429 over the login limit. */
export async function login(user: string, password: string) {
  const res = await post<{ token: string; ttl: number; role: Role; idle: number }>('/session', { user, password }, true)
  limitNear = res.ttl < res.idle
  // the backend accepted this exact name, so it is the session's user
  startSession({ token: res.token, user, role: res.role, idle: res.idle, expiresAt: Date.now() + res.ttl * 1000 })
  verified = Promise.resolve(true)
}

/**
 * Whether there is a usable session. The first call after a page load checks the stored token with
 * GET /session, which counts as activity, and refreshes the user, role and time left; a token the
 * backend refuses is dropped. If the backend can't be asked, the stored session is kept and the next
 * call will find out.
 */
export function ensureSession(): Promise<boolean> {
  if (!getSession()) return Promise.resolve(false)
  verified ??= get<{ user: string; role: Role; secs_left: number }>('/session', undefined, { silent: true }).then(
    (s) => {
      const stored = getSession()
      if (!stored) return false // logged out meanwhile
      startSession({ ...stored, user: s.user, role: s.role, expiresAt: Date.now() + s.secs_left * 1000 })
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

/** `background` for a poll; see usePoller.ts. */
export const fetchDashboard = (background?: boolean) => get<DashboardData>('/dashboard', undefined, { background })

// ---------- access lists and interfaces (admin only) ----------

/** The configuration in effect; read it again after each change, as the device rewrites entries. */
export const getConfig = () => get<DeviceConfig>('/config', { what: 'running' })

/** Without `seq`, the entry goes after the last one (its seq + 10). Creates the list if it's missing. */
export const addAclEntry = (acl: number, ace: string, seq?: number) =>
  post<ChangeReply>('/acl/entry', seq === undefined ? { acl, ace } : { acl, ace, seq })
export const deleteAclEntry = (acl: number, seq: number) => del<ChangeReply>('/acl/entry', { acl, seq })
export const createAcl = (acl: number) => post<ChangeReply>('/acl', { acl })
/** Refused while an interface applies the list. */
export const deleteAcl = (acl: number) => del<ChangeReply>('/acl', { acl })
/** Replaces the list of the same kind (standard or extended) the interface applied. */
export const bindAcl = (iface: string, acl: number) => post<ChangeReply>('/interface/acl', { interface: iface, acl })
export const unbindAcl = (iface: string, acl: number) => del<ChangeReply>('/interface/acl', { interface: iface, acl })
export const deleteInterface = (iface: string) => del<ChangeReply>('/interface', { interface: iface })

/** Whether the lists are enforced: mfwd's state and packet counters. */
export const getAclEngine = (opts: GetOptions = {}) => get<AclEngine>('/acl-engine', undefined, opts)

/** Asks whether there are unsaved changes. Admin only: for a `user` there is nothing to save. */
export async function refreshPendingChanges() {
  if (getRole() !== 'admin') {
    unsavedChanges.value = false
    return
  }
  unsavedChanges.value = (await get<{ dirty: boolean }>('/config/pending')).dirty
}
export async function saveConfig() {
  await post<object>('/config/save')
  unsavedChanges.value = false
}
