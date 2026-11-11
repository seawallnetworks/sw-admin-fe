// Access list entries ("ACEs"): building one from the Add Entry form, and reading one the device gives
// back, to show it in columns. The grammar is mini-fw's (`mfw help`), which sw_configd checks with:
//
//   standard (1-99):    permit|deny <addr>
//   extended (100-199): permit|deny <proto> <addr> [<port>] <addr> [<port>] [established|reply]
//     <addr>:  any | host A.B.C.D | A.B.C.D <wildcard> | A.B.C.D/len
//     <proto>: ip | tcp | udp | icmp | 0-255
//     <port>:  eq N | range LO HI | gt N | lt N        (tcp/udp only)
//   established: tcp only; reply: tcp or udp only
//
// The device writes every entry back in one form (mfw_format_ace): a network as "A.B.C.D <wildcard>",
// /32 as "host A.B.C.D", /0 as "any". The form sends networks as CIDR, which it accepts too.

export type AceAction = 'permit' | 'deny'
export type AceProtocol = 'ip' | 'tcp' | 'udp' | 'icmp' | 'other'
export type AddrKind = 'any' | 'host' | 'network'
export type PortOp = 'any' | 'eq' | 'range' | 'gt' | 'lt'
export type AceMatch = 'all' | 'established' | 'reply'

export interface AddrField {
  kind: AddrKind
  /** "192.168.1.10" for a host, "192.168.1.0/24" for a network. */
  value: string
}

export interface PortField {
  op: PortOp
  port: number | null
  /** The range's upper end. */
  to: number | null
}

export interface AceForm {
  action: AceAction
  protocol: AceProtocol
  /** The protocol number, when `protocol` is 'other'. */
  protoNumber: number | null
  src: AddrField
  srcPort: PortField
  dst: AddrField
  dstPort: PortField
  match: AceMatch
}

export const emptyAddr = (): AddrField => ({ kind: 'any', value: '' })
export const emptyPort = (): PortField => ({ op: 'any', port: null, to: null })

export const emptyAceForm = (): AceForm => ({
  action: 'permit',
  protocol: 'tcp',
  protoNumber: null,
  src: emptyAddr(),
  srcPort: emptyPort(),
  dst: emptyAddr(),
  dstPort: emptyPort(),
  match: 'all',
})

export const hasPorts = (p: AceProtocol) => p === 'tcp' || p === 'udp'

// ---------- checking the form ----------

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

function ipToInt(ip: string): number | null {
  const m = IPV4.exec(ip)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  if (parts.some((p) => p > 255)) return null
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

const intToIp = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.')
const prefixMask = (len: number) => (len === 0 ? 0 : (0xffffffff << (32 - len)) >>> 0)

/** Why an address field is wrong, or null if it's right. `what` names it in the message. */
export function addrError(a: AddrField, what: string): string | null {
  const v = a.value.trim()
  if (a.kind === 'any') return null
  if (a.kind === 'host') {
    if (!v) return `Enter the ${what} host's address, for example 192.168.1.10`
    return ipToInt(v) === null ? `${what}: "${v}" is not an IPv4 address` : null
  }
  if (!v) return `Enter the ${what} network, for example 192.168.1.0/24`
  const [ip, len, ...rest] = v.split('/')
  const n = ipToInt(ip)
  const prefix = Number(len)
  if (n === null || rest.length || !/^\d{1,2}$/.test(len ?? '') || prefix > 32) {
    return `${what}: "${v}" is not a network; write it as an address and a prefix length, for example 192.168.1.0/24`
  }
  const net = (n & prefixMask(prefix)) >>> 0
  if (net !== n) return `${what}: ${v} has host bits set; the network is ${intToIp(net)}/${prefix}`
  return null
}

/** Why a port field is wrong, or null if it's right. */
export function portError(p: PortField, what: string): string | null {
  if (p.op === 'any') return null
  const ok = (n: number | null): n is number => n !== null && Number.isInteger(n) && n >= 1 && n <= 65535
  if (!ok(p.port)) return `Enter the ${what} port, 1 to 65535`
  if (p.op === 'range') {
    if (!ok(p.to)) return `Enter the end of the ${what} port range, 1 to 65535`
    if (p.port > p.to) return `The ${what} port range must go from low to high`
  }
  if (p.op === 'gt' && p.port === 65535) return `${what} port: greater than 65535 matches nothing`
  if (p.op === 'lt' && p.port === 1) return `${what} port: less than 1 matches nothing`
  return null
}

/** Every problem with the form, for a standard or an extended list; empty when it can be sent. */
export function aceFormErrors(f: AceForm, standard: boolean): string[] {
  const errors = [addrError(f.src, 'source')]
  if (!standard) {
    if (f.protocol === 'other') {
      const n = f.protoNumber
      if (n === null || !Number.isInteger(n) || n < 0 || n > 255) errors.push('Enter the protocol number, 0 to 255')
    }
    errors.push(addrError(f.dst, 'destination'))
    if (hasPorts(f.protocol)) errors.push(portError(f.srcPort, 'source'), portError(f.dstPort, 'destination'))
  }
  return errors.filter((e): e is string => e !== null)
}

// ---------- building the entry ----------

function addrText(a: AddrField): string {
  const v = a.value.trim()
  if (a.kind === 'host') return `host ${v || 'A.B.C.D'}`
  if (a.kind === 'network') return v || 'A.B.C.D/len'
  return 'any'
}

function portText(p: PortField): string {
  const n = (v: number | null) => (v === null ? 'N' : String(v))
  switch (p.op) {
    case 'any':
      return ''
    case 'range':
      return ` range ${n(p.port)} ${n(p.to)}`
    default:
      return ` ${p.op} ${n(p.port)}`
  }
}

/**
 * The entry in the device's syntax. Fields that don't apply (ports for ICMP, `established` for UDP, ...)
 * are left out, so a form whose protocol was changed afterwards still builds a valid entry.
 * Unfilled values show as placeholders, for the preview.
 */
export function buildAce(f: AceForm, standard: boolean): string {
  if (standard) return `${f.action} ${addrText(f.src)}`
  const ports = hasPorts(f.protocol)
  const proto = f.protocol === 'other' ? (f.protoNumber === null ? 'N' : String(f.protoNumber)) : f.protocol
  const match =
    (f.match === 'established' && f.protocol === 'tcp') || (f.match === 'reply' && ports) ? ` ${f.match}` : ''
  return (
    `${f.action} ${proto} ${addrText(f.src)}${ports ? portText(f.srcPort) : ''} ` +
    `${addrText(f.dst)}${ports ? portText(f.dstPort) : ''}${match}`
  )
}

// ---------- reading the device's entries ----------

/** An entry split into what the table shows. */
export interface AceView {
  action: AceAction
  /** "IP (any)", "TCP", ..., or "Protocol 47". Empty for a standard entry. */
  protocol: string
  /** "Any", "Host 203.0.113.66" or "198.51.100.0/24", then ", port 22" when there is a port. */
  source: string
  destination: string
  /** "Established", "Replies", or empty. */
  options: string
}

const PROTO_LABELS: Record<string, string> = { ip: 'IP (any)', tcp: 'TCP', udp: 'UDP', icmp: 'ICMP' }

/** Reads one address at `words[i]`; returns its text and the index after it, or null. */
function readAddr(words: string[], i: number): [string, number] | null {
  const w = words[i]
  if (w === 'any') return ['Any', i + 1]
  if (w === 'host' && ipToInt(words[i + 1] ?? '') !== null) return [`Host ${words[i + 1]}`, i + 2]
  if (w?.includes('/')) return [w, i + 1]
  const ip = ipToInt(w ?? '')
  const wc = ipToInt(words[i + 1] ?? '')
  if (ip === null || wc === null) return null
  // a contiguous wildcard 0..01..1 is a prefix
  const host = 32 - Math.clz32(wc)
  if (wc !== (host === 32 ? 0xffffffff : ((1 << host) >>> 0) - 1)) return null
  return [`${w}/${32 - host}`, i + 2]
}

/** Reads an optional port at `words[i]`; returns its text ('' for none) and the index after it. */
function readPort(words: string[], i: number): [string, number] {
  switch (words[i]) {
    case 'eq':
      return [`, port ${words[i + 1]}`, i + 2]
    case 'gt':
      return [`, ports > ${words[i + 1]}`, i + 2]
    case 'lt':
      return [`, ports < ${words[i + 1]}`, i + 2]
    case 'range':
      return [`, ports ${words[i + 1]}-${words[i + 2]}`, i + 3]
    default:
      return ['', i]
  }
}

/** Splits an entry the device gave into columns; null if it's in a form this doesn't know. */
export function parseAce(ace: string, standard: boolean): AceView | null {
  const words = ace.trim().split(/\s+/)
  const action = words[0]
  if (action !== 'permit' && action !== 'deny') return null
  if (standard) {
    const src = readAddr(words, 1)
    if (!src || src[1] !== words.length) return null
    return { action, protocol: '', source: src[0], destination: '', options: '' }
  }
  const proto = words[1]
  if (!proto) return null
  const protocol = PROTO_LABELS[proto] ?? (/^\d+$/.test(proto) ? `Protocol ${proto}` : null)
  if (!protocol) return null
  const src = readAddr(words, 2)
  if (!src) return null
  const [sp, i1] = readPort(words, src[1])
  const dst = readAddr(words, i1)
  if (!dst) return null
  const [dp, i2] = readPort(words, dst[1])
  let options = ''
  let end = i2
  if (words[end] === 'established') options = 'Established'
  else if (words[end] === 'reply') options = 'Replies'
  if (options) end++
  if (end !== words.length) return null
  return { action, protocol, source: src[0] + sp, destination: dst[0] + dp, options }
}
