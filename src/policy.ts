// What an interface's access lists do to a packet: the Effective Policy table, "Test a packet",
// and the Add Entry dialog's checks. Pure functions, no Vue.
//
// This MIRRORS mini-fw's dataplane (seawallnetworks/mini-fw: README.md, src/acl_parse.c,
// src/bpf/mfw.bpf.c); it is not the device's own answer. Replace it with a device-side check (a
// "test packet" call to sw_configd, which would ask mini-fw) when one exists, so the two can't drift.
//
// mini-fw, for an IPv4 packet arriving on an interface:
//   stage 1, the standard list (1-99), if bound: the first entry whose source matches decides;
//     deny drops, permit goes on. No match goes on too, so a standard permit only matters ahead of
//     a deny it overlaps: it exempts its sources from that deny (match_std() is first-match).
//   stage 2, the extended list (100-199), if bound: the first entry that matches decides, permit
//     passes and deny drops; no match drops (the implicit deny). With none bound, the packet passes.
//   An entry's protocol "ip" (0) matches every protocol; ports count only for TCP and UDP;
//   "established" needs TCP with ACK or RST; "reply" a reply to a connection the device opened,
//   which for TCP also has ACK or RST, so it matches "established" too.
//   Outgoing traffic isn't filtered, non-IPv4 always passes, and non-first fragments skip stage 2.

import {
  inNet, intToIp, netContains, parseAce, parseAceRule, type AceRule, type AceView, type PortRange,
} from './ace'
import type { AclEntry, DeviceConfig } from './types'

type Config = DeviceConfig['config']

export const isStandard = (acl: number) => acl < 100

/** The lists an interface applies: at most one standard and one extended. */
export function boundLists(config: Config, iface: string): { std: number | null; ext: number | null } {
  const lists = config.interfaces[iface]?.acls_in ?? []
  return { std: lists.find(isStandard) ?? null, ext: lists.find((a) => !isStandard(a)) ?? null }
}

// ---------- the Effective Policy table ----------

/** Identifies the row that decides for a packet. */
export type RowKey = string
export const entryKey = (acl: number, seq: number): RowKey => `${acl}:${seq}`
export const KEY_IMPLICIT_DENY: RowKey = 'implicit-deny'
export const KEY_NO_EXT: RowKey = 'no-ext'

export type PolicyRow =
  | { kind: 'header'; key: RowKey; text: string }
  | {
      kind: 'entry'
      key: RowKey
      /** Its place in the whole table, 1 first. */
      n: number
      acl: number
      seq: number
      ace: string
      view: AceView | null
      result: string
      resultType: 'drop' | 'pass' | 'next'
      /** Why the entry does nothing, when it doesn't. */
      note?: string
    }
  | { kind: 'implicit'; key: RowKey; text: string; result: string; resultType: 'drop' | 'pass' | 'next' }

const STD_PERMIT_NOTE = 'No effect: a standard list already passes what it does not deny'
const STD_EXEMPT_NOTE = 'Exempts these sources from the deny entries after it'

const overlaps = (a: AceRule['src'], b: AceRule['src']) => netContains(a, b) || netContains(b, a)

/** A standard permit does something only if a later deny overlaps its source. */
function stdPermitNote(entries: AclEntry[], i: number): string {
  const r = parseAceRule(entries[i].ace, true)
  if (!r) return STD_PERMIT_NOTE
  const shields = entries.slice(i + 1).some((e) => {
    const later = parseAceRule(e.ace, true)
    return later?.action === 'deny' && overlaps(later.src, r.src)
  })
  return shields ? STD_EXEMPT_NOTE : STD_PERMIT_NOTE
}

/** Every entry a packet arriving on `iface` can meet, in the order it meets them. */
export function policyRows(config: Config, iface: string): PolicyRow[] {
  const { std, ext } = boundLists(config, iface)
  const rows: PolicyRow[] = []
  let n = 0
  if (std !== null) {
    rows.push({ kind: 'header', key: 'h1', text: `Stage 1 · Standard list ${std}` })
    const entries = config.acls[std] ?? []
    entries.forEach((e, i) => {
      const view = parseAce(e.ace, true)
      const permit = view ? view.action === 'permit' : e.ace.startsWith('permit')
      rows.push({
        kind: 'entry',
        key: entryKey(std, e.seq),
        n: ++n,
        acl: std,
        seq: e.seq,
        ace: e.ace,
        view,
        result: permit ? 'Go on to stage 2' : 'Drop',
        resultType: permit ? 'next' : 'drop',
        note: permit ? stdPermitNote(entries, i) : undefined,
      })
    })
    rows.push({ kind: 'implicit', key: 'implicit-std', text: 'Anything else', result: 'Go on to stage 2', resultType: 'next' })
  }
  if (ext !== null) {
    rows.push({ kind: 'header', key: 'h2', text: `Stage 2 · Extended list ${ext}` })
    for (const e of config.acls[ext] ?? []) {
      const view = parseAce(e.ace, false)
      const permit = view ? view.action === 'permit' : e.ace.startsWith('permit')
      rows.push({
        kind: 'entry',
        key: entryKey(ext, e.seq),
        n: ++n,
        acl: ext,
        seq: e.seq,
        ace: e.ace,
        view,
        result: permit ? 'Pass' : 'Drop',
        resultType: permit ? 'pass' : 'drop',
      })
    }
    rows.push({ kind: 'implicit', key: KEY_IMPLICIT_DENY, text: 'Anything else', result: 'Drop (implicit)', resultType: 'drop' })
  } else {
    rows.push({ kind: 'header', key: 'h2', text: 'Stage 2 · No extended list' })
    rows.push({
      kind: 'implicit',
      key: KEY_NO_EXT,
      text: 'Everything that gets past stage 1',
      result: 'Pass',
      resultType: 'pass',
    })
  }
  return rows
}

// ---------- testing a packet ----------

/** TCP: SYN only / ACK or RST set / a reply to a connection this device opened (ACK set too). */
export type PacketState = 'new' | 'established' | 'reply'

export interface Packet {
  /** IP protocol number: 6 TCP, 17 UDP, 1 ICMP, ... */
  proto: number
  src: number
  dst: number
  /** null: left blank. Only for TCP and UDP. */
  sport: number | null
  dport: number | null
  state: PacketState
}

export interface Verdict {
  result: 'pass' | 'drop'
  /** The row that decided. */
  key: RowKey
  /** The path, in sentences. */
  text: string
}

const hasPorts = (proto: number) => proto === 6 || proto === 17
const inRange = (p: number | null, r: PortRange | null) => r === null || (p !== null && p >= r.min && p <= r.max)

/** Whether an entry matches a packet, as mfw_ext_ace_match() (or the standard list's source check) does. */
export function ruleMatches(r: AceRule, p: Packet, standard: boolean): boolean {
  if (!inNet(p.src, r.src)) return false
  if (standard) return true
  if (r.proto !== 0 && r.proto !== p.proto) return false
  if (!inNet(p.dst, r.dst)) return false
  if (!hasPorts(p.proto)) return true
  if (!inRange(p.sport, r.sport) || !inRange(p.dport, r.dport)) return false
  const ackOrRst = p.proto === 6 && p.state !== 'new'
  if (r.established && !ackOrRst) return false
  if (r.reply && p.state !== 'reply') return false
  return true
}

const describe = (acl: number, e: AclEntry) => `entry ${e.seq} of list ${acl} (${e.ace})`

/** Entries a packet with a blank source port missed only for that: worth saying. */
function blankSportMisses(acl: number, entries: AclEntry[], p: Packet): string[] {
  if (!hasPorts(p.proto) || p.sport !== null) return []
  return entries
    .map((e) => ({ e, r: parseAceRule(e.ace, false) }))
    .filter(({ r }) => r?.sport && ruleMatches({ ...r, sport: null }, p, false))
    .map(({ e }) => `${describe(acl, e)} would match but needs a source port, and the packet's is blank.`)
}

/** What the interface's lists do to the packet, and which row decides. */
export function evaluate(config: Config, iface: string, p: Packet): Verdict {
  const { std, ext } = boundLists(config, iface)
  const said: string[] = []
  const unread = (acl: number, e: AclEntry) => said.push(`(${describe(acl, e)} can't be read here; skipped.)`)

  if (std === null) {
    said.push('Stage 1: no standard list.')
  } else {
    let decided = false
    for (const e of config.acls[std] ?? []) {
      const r = parseAceRule(e.ace, true)
      if (!r) {
        unread(std, e)
        continue
      }
      if (!ruleMatches(r, p, true)) continue
      decided = true
      if (r.action === 'deny') {
        said.push(`Stage 1: ${describe(std, e)} matches, so it is dropped.`)
        return { result: 'drop', key: entryKey(std, e.seq), text: said.join(' ') }
      }
      said.push(`Stage 1: ${describe(std, e)} matches; a standard permit goes on.`)
      break
    }
    if (!decided) said.push(`Stage 1: no deny matches ${intToIp(p.src)}.`)
  }

  if (ext === null) {
    said.push('Stage 2: no extended list, so it passes.')
    return { result: 'pass', key: KEY_NO_EXT, text: said.join(' ') }
  }
  const entries = config.acls[ext] ?? []
  for (const e of entries) {
    const r = parseAceRule(e.ace, false)
    if (!r) {
      unread(ext, e)
      continue
    }
    if (!ruleMatches(r, p, false)) continue
    // entries before this one that only the blank source port kept from deciding
    said.push(...blankSportMisses(ext, entries.filter((x) => x.seq < e.seq), p))
    said.push(`Stage 2: ${describe(ext, e)} matches.`)
    return { result: r.action === 'permit' ? 'pass' : 'drop', key: entryKey(ext, e.seq), text: said.join(' ') }
  }
  said.push(...blankSportMisses(ext, entries, p))
  said.push(`Stage 2: no entry of list ${ext} matches, so the implicit deny drops it.`)
  return { result: 'drop', key: KEY_IMPLICIT_DENY, text: said.join(' ') }
}

// ---------- the Add Entry dialog: where an entry goes, and what to warn about ----------

export interface PositionOption {
  label: string
  /** The seq the entry gets there; null where there's no free number. */
  seq: number | null
  key: string
}

/** Every place a new entry can go in a list: the top, each gap, the end. */
export function positionOptions(entries: AclEntry[]): PositionOption[] {
  if (!entries.length) return [{ key: 'end', label: 'At the end', seq: 10 }]
  const seqs = entries.map((e) => e.seq)
  const opts: PositionOption[] = []
  const top = Math.floor(seqs[0] / 2)
  opts.push({ key: 'top', label: 'At the top', seq: top >= 1 ? top : null })
  for (let i = 0; i + 1 < seqs.length; i++) {
    const [a, b] = [seqs[i], seqs[i + 1]]
    opts.push({ key: `after-${a}`, label: `After seq ${a}, before ${b}`, seq: b - a >= 2 ? a + Math.floor((b - a) / 2) : null })
  }
  const last = seqs[seqs.length - 1]
  const end = last + 10 <= 65535 ? last + 10 : last < 65535 ? last + 1 : null
  opts.push({ key: 'end', label: 'At the end', seq: end })
  return opts
}

const portsContain = (outer: PortRange | null, inner: PortRange | null) =>
  outer === null || (inner !== null && outer.min <= inner.min && inner.max <= outer.max)

/** Whether `earlier` matches every packet `r` would, so `r` behind it never matches. */
export function covers(earlier: AceRule, r: AceRule, standard: boolean): boolean {
  if (!netContains(earlier.src, r.src)) return false
  if (standard) return true
  if (earlier.proto !== 0 && earlier.proto !== r.proto) return false
  if (!netContains(earlier.dst, r.dst)) return false
  if (!portsContain(earlier.sport, r.sport) || !portsContain(earlier.dport, r.dport)) return false
  // no extra flags: a flag the earlier entry has narrows it, unless the new one has it too
  if (earlier.established && !r.established) return false
  if (earlier.reply && !r.reply) return false
  return true
}

/** The first entry before `seq` that already covers the new entry, if any. */
export function shadowingEntry(entries: AclEntry[], ace: string, seq: number, standard: boolean): AclEntry | null {
  const r = parseAceRule(ace, standard)
  if (!r) return null
  for (const e of entries) {
    if (e.seq >= seq) break
    const earlier = parseAceRule(e.ace, standard)
    if (earlier && covers(earlier, r, standard)) return e
  }
  return null
}

/** permit, from any source to any destination, on every port: in an extended list, nearly everything passes. */
export function isVeryBroad(ace: string, standard: boolean): boolean {
  if (standard) return false
  const r = parseAceRule(ace, false)
  return (
    !!r && r.action === 'permit' && r.src.prefix === 0 && r.dst.prefix === 0 && !r.sport && !r.dport &&
    !r.established && !r.reply
  )
}
