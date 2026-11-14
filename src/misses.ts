// reply_miss's samples (Seawall proposal 0015 §7), as the Access Lists page shows them.
import type { ReplyMiss } from './types'

export interface MissRow {
  key: string
  time: string
  iface: string
  proto: string
  from: string
  to: string
  /** TCP's flags as letters, or an ICMP error's kind. */
  detail: string
}

const PROTO: Record<number, string> = { 1: 'ICMP', 6: 'TCP', 17: 'UDP' }

/** TCP flags as tcpdump writes them: S, A, P, F, R. */
export function tcpFlags(f: number): string {
  return [
    [0x02, 'S'],
    [0x10, 'A'],
    [0x08, 'P'],
    [0x01, 'F'],
    [0x04, 'R'],
  ]
    .filter(([bit]) => f & (bit as number))
    .map(([, l]) => l)
    .join('')
}

/** What an ICMP type is, of those that look like replies. */
export function icmpKind(type: number, code: number): string {
  if (type === 0) return 'echo reply'
  if (type === 3 && code === 4) return 'fragmentation needed'
  if (type === 3) return `unreachable (code ${code})`
  if (type === 11) return 'time exceeded'
  if (type === 12) return 'parameter problem'
  return `type ${type} code ${code}`
}

/** A sample as a table row; `fmtTime` formats Unix ms. */
export function missRow(m: ReplyMiss, i: number, fmtTime: (ms: number) => string): MissRow {
  const ports = m.proto === 6 || m.proto === 17
  return {
    key: `${m.time_ms}-${i}`,
    time: fmtTime(m.time_ms),
    iface: m.interface,
    proto: PROTO[m.proto] ?? String(m.proto),
    from: ports ? `${m.src}:${m.sport}` : m.src,
    to: ports ? `${m.dst}:${m.dport}` : m.dst,
    detail: m.proto === 6 ? tcpFlags(m.tcp_flags) : m.proto === 1 ? icmpKind(m.icmp_type, m.icmp_code) : '',
  }
}
