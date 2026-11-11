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

/**
 * A new entry's starting point. A standard list only drops what it denies, so: Deny, one host. An
 * extended one: Permit, TCP, to a destination port still to choose, so that OK needs a choice.
 */
export const emptyAceForm = (standard = false): AceForm => ({
  action: standard ? 'deny' : 'permit',
  protocol: 'tcp',
  protoNumber: null,
  src: standard ? { kind: 'host', value: '' } : emptyAddr(),
  srcPort: emptyPort(),
  dst: emptyAddr(),
  dstPort: standard ? emptyPort() : { op: 'eq', port: null, to: null },
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

/**
 * The form's own protocol for a number the device names: it rewrites 1, 6 and 17 as icmp, tcp and udp
 * (mini-fw's enum mfw_proto), so these are chosen by name, which shows the port fields for TCP and UDP.
 * 0 is "ip", any protocol, which the form has too; it is refused as a number (aceFormErrors).
 */
export const NAMED_PROTOCOLS: Record<number, AceProtocol> = { 1: 'icmp', 6: 'tcp', 17: 'udp' }

/** Every problem with the form, for a standard or an extended list; empty when it can be sent. */
export function aceFormErrors(f: AceForm, standard: boolean): string[] {
  const errors = [addrError(f.src, 'source')]
  if (!standard) {
    if (f.protocol === 'other') {
      const n = f.protoNumber
      if (n === null || !Number.isInteger(n) || n < 0 || n > 255) errors.push('Enter the protocol number, 0 to 255')
      else if (n === 0) errors.push('Protocol 0 means any protocol: choose "IP (any protocol)" instead')
      else if (NAMED_PROTOCOLS[n]) errors.push(`Protocol ${n} is ${NAMED_PROTOCOLS[n].toUpperCase()}: choose it by name`)
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

// ---------- the device's entries, as values to match packets against ----------

/** An IPv4 network: `net` with its host bits clear, as an unsigned 32-bit number. Prefix 0 is "any". */
export interface Net {
  net: number
  prefix: number
}

/** Ports `min` to `max`, inclusive. */
export interface PortRange {
  min: number
  max: number
}

/** An entry, read the way mini-fw compiles it (struct mfw_rule). */
export interface AceRule {
  action: AceAction
  /** IP protocol number; 0 for "ip", any protocol. Always 0 in a standard list. */
  proto: number
  src: Net
  /** null: any port. Only TCP and UDP entries have ports. */
  sport: PortRange | null
  dst: Net
  dport: PortRange | null
  /** TCP with ACK or RST set. */
  established: boolean
  /** A reply to a connection this device opened (TCP or UDP). */
  reply: boolean
}

export const PROTO_NUMBERS: Record<string, number> = { ip: 0, icmp: 1, tcp: 6, udp: 17 }

export const ANY_NET: Net = { net: 0, prefix: 0 }

export { ipToInt, intToIp, prefixMask }

/** Whether address `ip` is in `n`. */
export const inNet = (ip: number, n: Net) => ((ip & prefixMask(n.prefix)) >>> 0) === n.net

/** Whether network `outer` contains all of `inner`. */
export const netContains = (outer: Net, inner: Net) => outer.prefix <= inner.prefix && inNet(inner.net, outer)

export const netText = (n: Net) => (n.prefix === 0 ? 'any' : n.prefix === 32 ? intToIp(n.net) : `${intToIp(n.net)}/${n.prefix}`)

/** Reads an address at `words[i]` as acl_parse.c does; returns it and the index after it, or null. */
function readNet(words: string[], i: number): [Net, number] | null {
  const w = words[i]
  if (w === undefined) return null
  if (w === 'any') return [ANY_NET, i + 1]
  if (w === 'host') {
    const ip = ipToInt(words[i + 1] ?? '')
    return ip === null ? null : [{ net: ip, prefix: 32 }, i + 2]
  }
  if (w.includes('/')) {
    const [a, len] = w.split('/')
    const ip = ipToInt(a)
    const prefix = Number(len)
    if (ip === null || !/^\d{1,2}$/.test(len) || prefix > 32) return null
    return [{ net: (ip & prefixMask(prefix)) >>> 0, prefix }, i + 1]
  }
  const ip = ipToInt(w)
  const wc = ipToInt(words[i + 1] ?? '')
  if (ip === null || wc === null) return null
  const hostBits = 32 - Math.clz32(wc)
  // contiguous: 0..01..1
  if (wc !== (hostBits === 32 ? 0xffffffff : ((1 << hostBits) >>> 0) - 1)) return null
  const prefix = 32 - hostBits
  return [{ net: (ip & prefixMask(prefix)) >>> 0, prefix }, i + 2]
}

/** Reads an optional port at `words[i]` as parse_port() does; undefined if it is malformed. */
function readPorts(words: string[], i: number): [PortRange | null, number] | undefined {
  const num = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s) && +s >= 1 && +s <= 65535 ? +s : null)
  const op = words[i]
  const a = num(words[i + 1])
  switch (op) {
    case 'eq':
      return a === null ? undefined : [{ min: a, max: a }, i + 2]
    case 'gt':
      return a === null || a === 65535 ? undefined : [{ min: a + 1, max: 65535 }, i + 2]
    case 'lt':
      return a === null || a === 1 ? undefined : [{ min: 1, max: a - 1 }, i + 2]
    case 'range': {
      const b = num(words[i + 2])
      return a === null || b === null || a > b ? undefined : [{ min: a, max: b }, i + 3]
    }
    default:
      return [null, i]
  }
}

/** An entry in the device's syntax as values; null if it isn't one mini-fw would accept. */
export function parseAceRule(ace: string, standard: boolean): AceRule | null {
  const words = ace.trim().split(/\s+/)
  const action = words[0]
  if (action !== 'permit' && action !== 'deny') return null
  const base = { action, sport: null, dport: null, established: false, reply: false } as const
  if (standard) {
    const src = readNet(words, 1)
    if (!src || src[1] !== words.length) return null
    return { ...base, proto: 0, src: src[0], dst: ANY_NET }
  }
  const p = words[1]
  const proto = p === undefined ? undefined : p in PROTO_NUMBERS ? PROTO_NUMBERS[p] : /^\d{1,3}$/.test(p) && +p <= 255 ? +p : undefined
  if (proto === undefined) return null
  const ports = proto === 6 || proto === 17
  const src = readNet(words, 2)
  if (!src) return null
  const sp = readPorts(words, src[1])
  if (!sp || (sp[0] && !ports)) return null
  const dst = readNet(words, sp[1])
  if (!dst) return null
  const dp = readPorts(words, dst[1])
  if (!dp || (dp[0] && !ports)) return null
  let end = dp[1]
  let established = false
  let reply = false
  if (words[end] === 'established' && proto === 6) {
    established = true
    end++
  } else if (words[end] === 'reply' && ports) {
    reply = true
    end++
  }
  if (end !== words.length) return null
  return { ...base, proto, src: src[0], sport: sp[0], dst: dst[0], dport: dp[0], established, reply }
}

// ---------- addresses typed by hand: a stage 1 source, or one line of "Several" ----------

export type ParsedAddr = { net: Net; error?: undefined } | { net?: undefined; error: string }

/**
 * One source as a person types it: an address (`192.0.2.7`, also `host 192.0.2.7`), a network in
 * CIDR form (`198.51.100.0/24`), or `any`. A network with host bits set is refused, naming the network.
 */
export function parseAddress(raw: string): ParsedAddr {
  const s = raw.trim().replace(/^host\s+/, '')
  if (!s) return { error: 'Enter an address' }
  if (s === 'any') return { net: ANY_NET }
  const [ip, len, ...rest] = s.split('/')
  const n = ipToInt(ip)
  if (n === null || rest.length) return { error: `"${s}" is not an IPv4 address or network` }
  if (len === undefined) return { net: { net: n, prefix: 32 } }
  if (!/^\d{1,2}$/.test(len) || +len > 32) return { error: `"${s}": the prefix length must be 0 to 32` }
  const prefix = +len
  const net = (n & prefixMask(prefix)) >>> 0
  if (net !== n) return { error: `${s} has host bits set; the network is ${intToIp(net)}/${prefix}` }
  return { net: { net, prefix } }
}

/** A standard entry for one source. The device rewrites a network in its own form. */
export function stdAce(action: AceAction, n: Net): string {
  const src = n.prefix === 0 ? 'any' : n.prefix === 32 ? `host ${intToIp(n.net)}` : `${intToIp(n.net)}/${n.prefix}`
  return `${action} ${src}`
}

export interface AddrLines {
  /** The good lines, in order, each with its 1-based line number. */
  items: { line: number; text: string; net: Net }[]
  errors: { line: number; text: string; error: string }[]
}

/** A textarea of sources, one per line; blank lines and lines starting with # are skipped. */
export function parseAddrLines(text: string): AddrLines {
  const out: AddrLines = { items: [], errors: [] }
  text.split('\n').forEach((raw, i) => {
    const t = raw.trim()
    if (!t || t.startsWith('#')) return
    const r = parseAddress(t)
    if (r.net) out.items.push({ line: i + 1, text: t, net: r.net })
    else out.errors.push({ line: i + 1, text: t, error: r.error })
  })
  return out
}

export const sameNet = (a: Net, b: Net) => a.net === b.net && a.prefix === b.prefix
