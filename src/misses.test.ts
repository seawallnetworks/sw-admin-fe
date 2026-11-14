import { describe, expect, it } from 'vitest'
import { icmpKind, missRow, tcpFlags } from './misses'
import type { ReplyMiss } from './types'

const base: ReplyMiss = {
  time_ms: 1731500000123,
  interface: 'eth0',
  proto: 6,
  src: '198.51.100.7',
  dst: '10.0.0.5',
  sport: 443,
  dport: 41022,
  tcp_flags: 16,
  icmp_type: 0,
  icmp_code: 0,
}

describe('reply_miss samples', () => {
  it('writes TCP flags as letters', () => {
    expect(tcpFlags(0x10)).toBe('A')
    expect(tcpFlags(0x14)).toBe('AR')
    expect(tcpFlags(0x18)).toBe('AP')
    expect(tcpFlags(0x11)).toBe('AF')
  })

  it('names the ICMP that looks like a reply', () => {
    expect(icmpKind(0, 0)).toBe('echo reply')
    expect(icmpKind(3, 4)).toBe('fragmentation needed')
    expect(icmpKind(3, 3)).toBe('unreachable (code 3)')
    expect(icmpKind(11, 0)).toBe('time exceeded')
  })

  it('makes a row: ports for TCP and UDP, none for ICMP', () => {
    const t = (ms: number) => String(ms)
    expect(missRow(base, 0, t)).toEqual({
      key: '1731500000123-0',
      time: '1731500000123',
      iface: 'eth0',
      proto: 'TCP',
      from: '198.51.100.7:443',
      to: '10.0.0.5:41022',
      detail: 'A',
    })
    expect(missRow({ ...base, proto: 17, tcp_flags: 0, sport: 123, dport: 123 }, 1, t)).toMatchObject({
      proto: 'UDP',
      from: '198.51.100.7:123',
      detail: '',
    })
    expect(missRow({ ...base, proto: 1, sport: 0, dport: 0, tcp_flags: 0, icmp_type: 3, icmp_code: 1 }, 2, t))
      .toMatchObject({ proto: 'ICMP', from: '198.51.100.7', to: '10.0.0.5', detail: 'unreachable (code 1)' })
  })
})
