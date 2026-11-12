// A timer-driven request has to be a background one (X-SW-Background), or a page left open never times
// out (proposal 0014). Polls go through usePoller.ts, which makes them so; the session's own timers are
// in api.ts. Any other timer in the shipped code fails here, so a new poll can't bypass usePoller.
//
// mock.ts is left out: it fakes latency with setTimeout, and is never in a production build.

import { describe, expect, it } from 'vitest'

const ALLOWED = new Set(['./usePoller.ts', './api.ts', './mock.ts'])
const TIMER = /\bset(Timeout|Interval)\s*\(/

const sources = import.meta.glob<string>(['./**/*.ts', './**/*.vue', '!./**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('timers', () => {
  it('finds the sources', () => {
    expect(Object.keys(sources)).toContain('./views/Dashboard.vue')
    expect(Object.keys(sources)).toContain('./aclPage.ts')
  })

  it('are only in usePoller.ts and api.ts', () => {
    const offenders = Object.entries(sources)
      .filter(([path, text]) => !ALLOWED.has(path) && TIMER.test(text))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('usePoller sends its requests as background ones', () => {
    expect(sources['./usePoller.ts']).toMatch(/await fn\(true\)/)
  })
})
