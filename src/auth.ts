// Login session storage. No imports on purpose: router.ts and api.ts both depend
// on this, so keeping it a leaf avoids a circular import between them.

const TOKEN_KEY = 'sw_token'
const USER_KEY = 'sw_user'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const getUsername = () => localStorage.getItem(USER_KEY) ?? ''

export function setSession(token: string, username: string) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, username)
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}
