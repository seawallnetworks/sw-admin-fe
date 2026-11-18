import { describe, expect, it } from 'vitest'
import {
  aclStatus, alertText, armedSince, attackPeak, attackSpans, auditActivity, countNetworks, ddosStatus, dropRate,
  fmtDuration, lastAttackEnd, latestMbps, longestAttack, minutesPerDay, peakPps, recentActivity, sortAlerts,
} from './overview'
import type { AclEngine, Alert, AttackRecord, AuditRecord, ChangeRecord, OpenAttack, Trends } from './types'

let nextId = 1
const change = (time: number, op: string, c: Partial<ChangeRecord> = {}): ChangeRecord => ({
  id: nextId++, time, severity: 'info', source: 'voidgate', op, origin: 'self', uid: null, user: null,
  cause: null, generation: null, out_of_band: false, ...c,
})
const restart = (time: number) => change(time, 'gap', { cause: 'restart' })
const attack = (start: number, end: number | null, how: string | null, peak: number | null = 1000): AttackRecord => ({
  id: nextId++, epoch: 'e', attack: nextId, start, end, how, start_pps: 500, start_bps: null,
  tick_peak_pps: peak, tick_peak_bps: null, dropped: null, cut: null, bans: null, started_after_gap: false,
})
const open: OpenAttack = { id: 1, since: 100, pps: 900, bps: null, tick_peak_pps: 1200, tick_peak_bps: null,
  started_after_gap: false }
const alert = (condition: string, severity: Alert['severity'] = 'warning', raised = 0): Alert => ({
  id: nextId++, condition, severity, message: `${condition} message`, raised,
})

describe('alerts', () => {
  it('sorts the most severe first, the oldest of a severity first', () => {
    const list = sortAlerts([alert('a', 'info', 1), alert('b', 'critical', 9), alert('c', 'critical', 3)])
    expect(list.map((a) => a.condition)).toEqual(['c', 'b', 'a'])
  })

  it('links each to the page that fixes it', () => {
    expect(alertText(alert('voidgate_degraded')).to).toBe('/ddos')
    expect(alertText(alert('mfwd_unreachable')).to).toBe('/acl')
    expect(alertText(alert('store_unavailable')).to).toBe('/logs')
    const unknown = alertText(alert('something_new'))
    expect(unknown.sentence).toBe('something_new message')
    expect(unknown.to).toBe('/logs?tab=alerts')
  })
})

describe('DDoS protection', () => {
  it('is armed from the arm that opened it, until a disarm', () => {
    expect(armedSince([])).toBeNull()
    expect(armedSince([change(100, 'arm'), change(150, 'arm'), change(120, 'reload')])).toBe(100)
    expect(armedSince([change(100, 'arm'), change(200, 'disarm')])).toBeNull()
  })

  it('a restart ends an open attack', () => {
    const changes = [change(100, 'arm'), restart(300)]
    expect(armedSince(changes)).toBeNull()
    expect(ddosStatus([], changes, null).state).toBe('watching')
    // a restart that isn't the gate's, or a gap of falling behind, doesn't
    expect(armedSince([change(100, 'arm'), change(300, 'gap', { cause: 'behind' })])).toBe(100)
    expect(armedSince([change(100, 'arm'), change(300, 'gap', { cause: 'restart', source: 'mfwd' })])).toBe(100)
  })

  it('derives the state', () => {
    const armed = [change(100, 'arm')]
    expect(ddosStatus([alert('voidgate_unreachable')], armed, open).label).toBe('Not running')
    // voidgate's open attack, not drops: an arm by a manual block is no attack
    expect(ddosStatus([], armed, open)).toMatchObject({ state: 'attack', tone: 'warning' })
    expect(ddosStatus([], [], open).state).toBe('attack')
    expect(ddosStatus([], armed, null).label).toBe('Armed')
    expect(ddosStatus([], [], null)).toMatchObject({ label: 'Watching', tone: 'success' })
    expect(ddosStatus([alert('voidgate_degraded')], [], null)).toMatchObject({ label: 'Watching, degraded', tone: 'warning' })
    expect(ddosStatus([alert('voidgate_no_flow_table')], armed, open).label).toBe('Under attack, degraded')
  })

  it('takes the attacks from voidgate: open ones end now, a missed end is a lower bound', () => {
    const list = attackSpans(
      [attack(800, null, null), attack(200, 400, 'quiet'), attack(50, 150, 'restart')],
      1000,
    )
    expect(list).toEqual([
      { start: 50, end: 150, ongoing: false, atLeast: true },
      { start: 200, end: 400, ongoing: false, atLeast: false },
      { start: 800, end: 1000, ongoing: true, atLeast: false },
    ])
    expect(longestAttack(list)).toEqual({ secs: 200, atLeast: false })
    expect(longestAttack([{ start: 0, end: 900, ongoing: false, atLeast: true }])).toEqual({ secs: 900, atLeast: true })
    expect(longestAttack([])).toBeNull()
  })

  it('takes the peak of one tick, and when the last one ended', () => {
    const list = [attack(100, 200, 'quiet', 5000), attack(300, null, null, 7000), attack(400, 500, 'gap', null)]
    expect(attackPeak(list)).toBe(7000)
    expect(attackPeak([])).toBeNull()
    expect(lastAttackEnd(list)).toBe(500)
    expect(lastAttackEnd([attack(300, null, null)])).toBeNull()
  })

  it('counts minutes under attack per local day', () => {
    const midnight = new Date(2026, 10, 16).getTime() / 1000
    const now = midnight + 12 * 3600
    // 30 min over yesterday's midnight, and 10 min now
    const bars = minutesPerDay(
      [
        { start: midnight - 1200, end: midnight + 600, ongoing: false, atLeast: false },
        { start: now - 600, end: now, ongoing: true, atLeast: false },
      ],
      now,
    )
    expect(bars).toHaveLength(7)
    expect(bars[6]).toMatchObject({ label: 'Today', minutes: 20 })
    expect(bars[5].minutes).toBe(20)
    expect(bars[0].minutes).toBe(0)
  })
})

describe('figures', () => {
  it('counts a summary row as its networks', () => {
    expect(countNetworks([{ network: '192.0.2.1/32', more: 0 }, { network: null, more: 40 }])).toBe(41)
  })

  it('reads the trends', () => {
    const t: Trends = {
      tier: '10s', width: 10, threshold: 0.5, since: 0, until: 30,
      coverage: [
        { time: 0, source: 'voidgate', secs: 10, ratio: 1, covered: true },
        { time: 10, source: 'voidgate', secs: 5, ratio: 0.5, covered: true },
        { time: 20, source: 'voidgate', secs: 2, ratio: 0.2, covered: false },
      ],
      series: [
        { time: 0, source: 'voidgate', series: 'rx', pkts: 10, bytes: 1_250_000, peak_pps: 7 },
        { time: 10, source: 'voidgate', series: 'rx', pkts: 10, bytes: 1_250_000, peak_pps: 9 },
        { time: 10, source: 'voidgate', series: 'dropped', pkts: 10, bytes: 0, peak_pps: 99 },
      ],
    }
    expect(peakPps(t)).toBe(9)
    expect(latestMbps(t, 30)).toBe(2) // 1.25 MB over 5 s
    expect(latestMbps({ ...t, coverage: [] }, 30)).toBeNull()
    // the latest covered bucket ended over 30 s ago: not now
    expect(latestMbps(t, 61)).toBeNull()
  })

  it('a drop rate needs two reads, and no reset between them', () => {
    expect(dropRate(null, { at: 1000, drops: 5 })).toBeNull()
    expect(dropRate({ at: 0, drops: 100 }, { at: 10_000, drops: 600 })).toBe(50)
    expect(dropRate({ at: 0, drops: 600 }, { at: 10_000, drops: 5 })).toBeNull()
  })

  it('says the lists are enforced, with their problems', () => {
    const engine: AclEngine = { state: 'applied', since: 0, socket: '/run/mfwd.sock', live: true, attached: ['eth0'] }
    expect(aclStatus(engine, [])).toEqual({ status: 'enforced', problems: 0, tone: 'success' })
    expect(aclStatus(engine, [alert('mfwd_missing_interfaces')])).toEqual({ status: 'enforced', problems: 1, tone: 'warning' })
    expect(aclStatus({ ...engine, state: 'unreachable', live: false }, [alert('mfwd_unreachable')]).tone).toBe('error')
    expect(aclStatus(null, []).status).toBe('unknown')
  })
})

describe('recent activity', () => {
  const audit = (a: Partial<AuditRecord>): AuditRecord => ({
    id: nextId++, time: 0, severity: 'info', kind: 'admin', source: 'sw_configd', user: 'admin', entry: 'web',
    client: '192.0.2.1', op: null, object: null, result: 'ok', detail: null, count: 0, truncated: false, ...a,
  })

  it('tags and words each record', () => {
    expect(auditActivity(audit({ kind: 'login', op: 'login' }))).toMatchObject({
      tag: 'Login', text: 'admin logged in from 192.0.2.1.',
    })
    expect(auditActivity(audit({ kind: 'login', op: 'login', result: 'denied', user: 'root' })).text).toBe(
      'Failed login as root from 192.0.2.1.',
    )
    expect(auditActivity(audit({ op: 'acl entry add', object: 'access-list 100 permit any' })).tag).toBe('ACL')
    expect(auditActivity(audit({ op: 'set hostname', object: 'sw1' })).tag).toBe('Config')
  })

  it('merges audit records and changes by time, newest first', () => {
    const list = recentActivity(
      [audit({ time: 5, op: 'save' }), audit({ time: 1, op: 'save' })],
      [change(3, 'arm'), change(4, 'apply', { source: 'mfwd' })],
      3,
    )
    expect(list.map((a) => [a.time, a.tag])).toEqual([[5, 'Config'], [4, 'ACL'], [3, 'DDoS']])
  })

  it('formats lengths of time', () => {
    expect(fmtDuration(30)).toBe('under a minute')
    expect(fmtDuration(25 * 60)).toBe('25 min')
    expect(fmtDuration(2 * 3600 + 300)).toBe('2 h 5 min')
  })
})
