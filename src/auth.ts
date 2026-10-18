// Login session storage. No imports on purpose (type-only ones aside): router.ts and api.ts both
// depend on this, so keeping it a leaf avoids a circular import between them.
//
// The session lives in sessionStorage, never localStorage: a reload keeps it, closing the tab drops it.

import type { Role } from './types'

const SESSION_KEY = 'sw_session'

export interface Session {
  token: string
  user: string
  role: Role
  /** Epoch ms when the token runs out; it can't be renewed. */
  expiresAt: number
}

export function getSession(): Session | null {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null')
  } catch {
    return null
  }
}

export const getToken = () => getSession()?.token ?? null
export const getUsername = () => getSession()?.user ?? ''
export const getRole = () => getSession()?.role ?? null

export function setSession(s: Session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(s))
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY)
}
