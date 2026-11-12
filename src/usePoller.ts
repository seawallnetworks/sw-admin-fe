// Polling for a page: calls a function every few seconds while the page is mounted and the browser tab
// is visible, one call at a time.
//
// Its requests must be background ones (X-SW-Background): a poll isn't the user, and a page left open
// must still time out (proposal 0014). So the function is handed `true` to pass on as the api.ts call's
// `background`. timers.test.ts keeps every other timer out of the pages, so that a new poll can't
// bypass this.

import { onMounted, onUnmounted } from 'vue'

/**
 * Polls with `fn` every `intervalMs` while the component is mounted; call it from a component's setup.
 * `fn` handles its own errors; one it throws is dropped and the polling goes on.
 * Returns `pollNow()`, for a refresh right away, e.g. after a change the user made.
 */
export function usePoller(fn: (background: true) => Promise<unknown>, intervalMs: number) {
  let timer: number | undefined
  let inFlight = false
  let stopped = false

  async function pollNow() {
    window.clearTimeout(timer)
    timer = undefined
    if (inFlight) return
    inFlight = true
    try {
      await fn(true)
    } catch {
      // fn, or api.ts, already surfaced it; keep polling
    } finally {
      inFlight = false
    }
    if (!document.hidden && !stopped) timer = window.setTimeout(pollNow, intervalMs)
  }

  function onVisibilityChange() {
    if (document.hidden) {
      window.clearTimeout(timer)
      timer = undefined
    } else {
      pollNow()
    }
  }

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange)
    pollNow()
  })
  onUnmounted(() => {
    stopped = true
    window.clearTimeout(timer)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  })

  return { pollNow }
}
