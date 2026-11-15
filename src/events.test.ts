import { describe, expect, it } from 'vitest'
import {
  blockNetwork, blockOrigin, blockState, changeText, changeWho, conditionLabel, rangeSince, severityType, worstAlert,
} from './events'
import type { Alert, ChangeRecord } from './types'

const alert = (id: number, severity: Alert['severity'], raised: number): Alert => ({
  id, condition: `c${id}`, severity, message: '', raised,
})

const change = (c: Partial<ChangeRecord>): ChangeRecord => ({
  id: 1, time: 0, severity: 'info', source: 'voidgate', op: 'arm', origin: 'self', uid: null, user: null,
  cause: null, generation: null, out_of_band: false, ...c,
})

describe('alerts', () => {
  it('the worst is the most severe, the oldest of those', () => {
    expect(worstAlert([])).toBeNull()
    expect(worstAlert([alert(1, 'warning', 5), alert(2, 'critical', 9), alert(3, 'critical', 7)])?.id).toBe(3)
    expect(worstAlert([alert(1, 'info', 5), alert(2, 'warning', 9)])?.id).toBe(2)
  })

  it('names conditions, and keeps one it does not know', () => {
    expect(conditionLabel('mfwd_no_flow_table')).toBe('Firewall: no flow table')
    expect(conditionLabel('something_new')).toBe('something_new')
    expect(severityType('critical')).toBe('error')
    expect(severityType('info')).toBe('default')
  })
})

describe('blocks', () => {
  it('a summary has no network', () => {
    expect(blockNetwork({ network: '198.51.100.0/24', more: 0 })).toBe('198.51.100.0/24')
    expect(blockNetwork({ network: null, more: 1250 })).toBe('1,250 more networks')
    expect(blockNetwork({ network: null, more: 1 })).toBe('1 more network')
  })

  it('in force, or how it ended', () => {
    expect(blockState({ ended: null, end_state: null })).toBe('In force')
    expect(blockState({ ended: 5, end_state: 'expired' })).toBe('Expired')
    expect(blockState({ ended: 5, end_state: 'unknown' })).toBe('Ended (time unknown)')
    expect(blockState({ ended: 5, end_state: 'new' })).toBe('new')
  })

  it('who asked', () => {
    expect(blockOrigin({ origin: 'self', uid: null })).toBe('DDoS gate')
    expect(blockOrigin({ origin: 'socket', uid: 0 })).toBe('Command (uid 0)')
    expect(blockOrigin({ origin: 'ban', uid: 998 })).toBe('Ban client (uid 998)')
    expect(blockOrigin({ origin: null, uid: null })).toBe('-')
  })
})

describe('changes', () => {
  it('says what happened', () => {
    expect(changeText(change({ op: 'arm', cause: 'wake-threshold' }))).toBe('DDoS gate armed: wake threshold')
    expect(changeText(change({ op: 'reload' }))).toBe('DDoS gate reloaded')
    expect(changeText(change({ op: 'arm', origin: 'ban', cause: 'ban' }))).toBe(
      "DDoS gate armed: a ban client's block",
    )
    expect(changeText(change({ source: 'mfwd', op: 'apply', origin: 'apply', generation: 7 }))).toBe(
      'Firewall policy applied (generation 7)',
    )
    expect(changeText(change({ source: 'mfwd', op: 'apply', origin: 'restart', generation: 1 }))).toBe(
      'Saved firewall policy applied at start (generation 1)',
    )
    expect(changeText(change({ op: 'gap', cause: 'restart' }))).toBe('Changes missed: the DDoS gate restarted')
    expect(changeText(change({ source: 'mfwd', op: 'gap', cause: 'behind' }))).toBe(
      'Changes missed: the log fell behind the firewall',
    )
  })

  it('says who', () => {
    expect(changeWho({ origin: 'self', uid: null, user: null })).toBe('DDoS gate')
    expect(changeWho({ origin: 'socket', uid: 0, user: 'root' })).toBe('root')
    expect(changeWho({ origin: 'apply', uid: 1234, user: null })).toBe('uid 1234')
    expect(changeWho({ origin: 'ban', uid: 998, user: 'kong' })).toBe('Ban client (kong)')
    expect(changeWho({ origin: 'ban', uid: 998, user: null })).toBe('Ban client (uid 998)')
  })
})

describe('ranges', () => {
  it('end now', () => {
    expect(rangeSince('1h', 10_000_000)).toBe(10_000 - 3600)
    expect(rangeSince('30d', 3_000_000_000)).toBe(3_000_000 - 30 * 86400)
  })
})
