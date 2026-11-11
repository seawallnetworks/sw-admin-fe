// What an interface's access lists do to a packet: the policy table, "Test a packet", and the
// checks of the Add Entry, Apply and New List dialogs. Pure functions, no Vue.
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
//     passes and deny drops; no match drops (the implicit deny), even for an empty list. With none
//     bound, the packet passes.
//   An entry's protocol "ip" (0) matches every protocol; ports count only for TCP and UDP;
//   "established" needs TCP with ACK or RST; "reply" a reply to a connection the device opened,
//   which for TCP also has ACK or RST, so it matches "established" too.
//   Outgoing traffic isn't filtered, non-IPv4 always passes, and non-first fragments skip stage 2.

import {
  inNet, intToIp, netContains, parseAce, parseAceRule, type AceRule, type AceView, type Net, type PortRange,
} from './ace'
import type { AclEntry, DeviceConfig } from './types'

type Config = DeviceConfig['config']

export const isStandard = (acl: number) => acl < 100

/** The lists an interface applies: at most one standard and one extended. */
export function boundLists(config: Config, iface: string): { std: number | null; ext: number | null } {
  const lists = config.interfaces[iface]?.acls_in ?? []
  return { std: lists.find(isStandard) ?? null, ext: lists.find((a) => !isStandard(a)) ?? null }
}

/** The interfaces that apply a list. */
export const interfacesUsing = (config: Config, acl: number) =>
  Object.entries(config.interfaces)
    .filter(([, i]) => i.acls_in.includes(acl))
    .map(([name]) => name)

// ---------- notes on entries ----------

export interface EntryNote {
  text: string
  /** warn: the entry is dead weight that looks like it does something. */
  kind: 'muted' | 'warn'
}

const overlaps = (a: Net, b: Net) => netContains(a, b) || netContains(b, a)

/** Whether a deny after `seq` overlaps `src`: only then does a standard permit at `seq` do anything. */
export function stdPermitHasEffect(entries: AclEntry[], seq: number, src: Net): boolean {
  return entries.some((e) => {
    if (e.seq <= seq) return false
    const later = parseAceRule(e.ace, true)
    return later?.action === 'deny' && overlaps(later.src, src)
  })
}

export const NO_EFFECT_NOTE = 'No effect: nothing after it in this list denies this source'

/** For each entry: why it does nothing, if it doesn't. */
export function entryNotes(entries: AclEntry[], standard: boolean): (EntryNote | undefined)[] {
  const rules = entries.map((e) => parseAceRule(e.ace, standard))
  return entries.map((e, i) => {
    const r = rules[i]
    if (!r) return undefined
    const j = rules.findIndex((earlier, k) => k < i && earlier !== null && covers(earlier, r, standard))
    if (j >= 0) return { text: `Never matches: seq ${entries[j].seq} covers it`, kind: 'warn' }
    if (standard && r.action === 'permit' && !stdPermitHasEffect(entries, e.seq, r.src)) {
      return { text: NO_EFFECT_NOTE, kind: 'muted' }
    }
    return undefined
  })
}

// ---------- the policy table ----------

/** Identifies the row that decides for a packet. */
export type RowKey = string
export const entryKey = (acl: number, seq: number): RowKey => `${acl}:${seq}`
export const KEY_IMPLICIT_DENY: RowKey = 'implicit-deny'
/** No extended list bound: the stage 2 heading is the row that passes the packet. */
export const KEY_NO_EXT: RowKey = 'no-ext'

export type ResultType = 'drop' | 'pass' | 'next'

export type PolicyRow =
  /** A stage's heading; `acl` null when the interface applies no list for it. */
  | { kind: 'stage'; key: RowKey; stage: 1 | 2; acl: number | null; text: string }
  | {
      kind: 'entry'
      key: RowKey
      stage: 1 | 2
      acl: number
      seq: number
      ace: string
      /** null: a form the page can't split into columns; it is shown as its text. */
      view: AceView | null
      result: string
      resultType: ResultType
      note?: EntryNote
    }
  | { kind: 'implicit'; key: RowKey; stage: 1 | 2; text: string; result: string; resultType: ResultType }

/** One list's entries as table rows. */
export function entryRows(config: Config, acl: number): Extract<PolicyRow, { kind: 'entry' }>[] {
  const standard = isStandard(acl)
  const entries = config.acls[acl] ?? []
  const notes = entryNotes(entries, standard)
  return entries.map((e, i) => {
    const view = parseAce(e.ace, standard)
    const permit = view ? view.action === 'permit' : e.ace.trim().startsWith('permit')
    return {
      kind: 'entry',
      key: entryKey(acl, e.seq),
      stage: standard ? 1 : 2,
      acl,
      seq: e.seq,
      ace: e.ace,
      view,
      result: standard ? (permit ? 'Go on to stage 2' : 'Drop') : permit ? 'Pass' : 'Drop',
      resultType: permit ? (standard ? 'next' : 'pass') : 'drop',
      note: notes[i],
    }
  })
}

/** Every entry a packet arriving on `iface` can meet, in the order it meets them. */
export function policyRows(config: Config, iface: string): PolicyRow[] {
  const { std, ext } = boundLists(config, iface)
  const rows: PolicyRow[] = []
  if (std !== null) {
    rows.push({ kind: 'stage', key: 'h1', stage: 1, acl: std, text: `Stage 1 · Standard list ${std}` })
    rows.push(...entryRows(config, std))
    rows.push({ kind: 'implicit', key: 'implicit-std', stage: 1, text: 'Anything else', result: 'Go on to stage 2', resultType: 'next' })
  } else {
    rows.push({ kind: 'stage', key: 'h1', stage: 1, acl: null, text: 'Stage 1 · No standard list' })
  }
  if (ext !== null) {
    rows.push({ kind: 'stage', key: 'h2', stage: 2, acl: ext, text: `Stage 2 · Extended list ${ext}` })
    rows.push(...entryRows(config, ext))
    rows.push({ kind: 'implicit', key: KEY_IMPLICIT_DENY, stage: 2, text: 'Anything else', result: 'Drop (implicit)', resultType: 'drop' })
  } else {
    rows.push({
      kind: 'stage',
      key: KEY_NO_EXT,
      stage: 2,
      acl: null,
      text: 'Stage 2 · No extended list: everything past stage 1 passes',
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

// ---------- where new entries go ----------

export interface PositionOption {
  /** 'top', 'after-<seq>' for a gap, or 'end'. */
  key: string
  label: string
  /** The seqs `n` new entries get there, in order; null where there's no room. */
  seqs: number[] | null
}

const MAX_SEQ = 65535

/** n numbers spread evenly between a and b, both excluded; null if they don't fit. */
function spread(a: number, b: number, n: number): number[] | null {
  const step = Math.floor((b - a) / (n + 1))
  return step < 1 ? null : Array.from({ length: n }, (_, i) => a + step * (i + 1))
}

/**
 * Every place `n` new entries can go in a list: the top, each gap, the end. At the top the first
 * takes floor(first / 2) (spread over 0..first for several); in a gap A..B they are spread with
 * step floor((B - A) / (n + 1)); at the end they take last + 10, + 20, ...
 */
export function positionOptions(entries: AclEntry[], n = 1): PositionOption[] {
  const count = Math.max(1, n)
  if (!entries.length) {
    return [{ key: 'end', label: 'At the end', seqs: Array.from({ length: count }, (_, i) => (i + 1) * 10) }]
  }
  const seqs = entries.map((e) => e.seq)
  const opts: PositionOption[] = [{ key: 'top', label: 'At the top', seqs: spread(0, seqs[0], count) }]
  for (let i = 0; i + 1 < seqs.length; i++) {
    const [a, b] = [seqs[i], seqs[i + 1]]
    opts.push({ key: `after-${a}`, label: `After seq ${a}, before ${b}`, seqs: spread(a, b, count) })
  }
  const last = seqs[seqs.length - 1]
  const end = Array.from({ length: count }, (_, i) => last + 10 * (i + 1))
  opts.push({
    key: 'end',
    label: 'At the end',
    seqs: end.at(-1)! <= MAX_SEQ ? end : spread(last, MAX_SEQ + 1, count),
  })
  return opts
}

export const NO_ROOM = 'No room here; choose another position'

/** The position just after entry `seq`: "Insert below". */
export function positionAfter(entries: AclEntry[], seq: number): string {
  return entries.at(-1)?.seq === seq ? 'end' : `after-${seq}`
}

/** The position just before the entry at `index`. */
export function positionBefore(entries: AclEntry[], index: number): string {
  if (index <= 0) return 'top'
  if (index >= entries.length) return 'end'
  return `after-${entries[index - 1].seq}`
}

/**
 * Where a new standard entry goes by default: just before the first entry that matches every
 * source (`permit any`, `deny any`), since nothing after it is reached; else at the end.
 */
export function defaultStdPosition(entries: AclEntry[]): string {
  const i = entries.findIndex((e) => parseAceRule(e.ace, true)?.src.prefix === 0)
  return i < 0 ? 'end' : positionBefore(entries, i)
}

/** The list with new entries at their seqs, marked, in order. */
export function placeEntries(entries: AclEntry[], added: AclEntry[]): (AclEntry & { isNew: boolean })[] {
  return [...entries.map((e) => ({ ...e, isNew: false })), ...added.map((e) => ({ ...e, isNew: true }))].sort(
    (a, b) => a.seq - b.seq || Number(a.isNew) - Number(b.isNew),
  )
}

// ---------- coverage: entries that never match ----------

const portsContain = (outer: PortRange | null, inner: PortRange | null) =>
  outer === null || (inner !== null && outer.min <= inner.min && inner.max <= outer.max)

/**
 * Whether `earlier` matches every packet `r` would, so `r` behind it never matches: the same or
 * `ip` protocol, source and destination networks that contain r's, port conditions that contain
 * r's, and no flag (established, reply) that r doesn't have too.
 */
export function covers(earlier: AceRule, r: AceRule, standard: boolean): boolean {
  if (!netContains(earlier.src, r.src)) return false
  if (standard) return true
  if (earlier.proto !== 0 && earlier.proto !== r.proto) return false
  if (!netContains(earlier.dst, r.dst)) return false
  if (!portsContain(earlier.sport, r.sport) || !portsContain(earlier.dport, r.dport)) return false
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

/**
 * Whether an extended list has a permit that lets in new TCP connections to `port` from somewhere:
 * TCP or `ip`, no source port, a destination port that includes it (or none), no established or
 * reply. The addresses aren't checked: the console's own address isn't known here.
 */
export function permitsTcpPort(entries: AclEntry[], port: number): boolean {
  return entries.some((e) => {
    const r = parseAceRule(e.ace, false)
    return (
      !!r && r.action === 'permit' && (r.proto === 0 || r.proto === 6) && r.sport === null &&
      (r.dport === null || (r.dport.min <= port && port <= r.dport.max)) && !r.established && !r.reply
    )
  })
}

// ---------- list numbers ----------

export const STD_RANGE = [1, 99] as const
export const EXT_RANGE = [100, 199] as const

/** The next free list number of a kind, preferring multiples of 10; null if all are taken. */
export function nextFreeList(config: Config, standard: boolean): number | null {
  const [lo, hi] = standard ? STD_RANGE : EXT_RANGE
  const taken = (n: number) => String(n) in config.acls
  for (let n = Math.ceil(lo / 10) * 10; n <= hi; n += 10) if (!taken(n)) return n
  for (let n = lo; n <= hi; n++) if (!taken(n)) return n
  return null
}

// ---------- how many entries a list can hold ----------

// mini-fw binds at most this many entries per list (include/mfw.h:24-25, MFW_MAX_STD_ACES and
// MFW_MAX_EXT_ACES). Over that, mfwd refuses the WHOLE policy (src/policy.c, "standard list N has k
// ACEs; at most 64 can be bound") and keeps running the previous one, so every later change stops
// taking effect until the list is trimmed. Only bound lists are counted, but any list can be applied.
export const STD_MAX_ENTRIES = 64
export const EXT_MAX_ENTRIES = 128

export const maxEntries = (acl: number) => (isStandard(acl) ? STD_MAX_ENTRIES : EXT_MAX_ENTRIES)

export interface ListFill {
  count: number
  max: number
  /** How many more fit; 0 when full or over. */
  room: number
  over: boolean
  /** 90% full or more: shown amber. */
  nearFull: boolean
}

export function listFill(acl: number, count: number): ListFill {
  const max = maxEntries(acl)
  return { count, max, room: Math.max(0, max - count), over: count > max, nearFull: count >= max * 0.9 }
}

/** The error for a change that would leave `after` entries in a list that has `now`; null if they fit. */
export function limitError(acl: number, now: number, after: number): string | null {
  const max = maxEntries(acl)
  return after > max ? `List ${acl} can hold at most ${max} entries; it has ${now}. Remove some first.` : null
}

/** mfwd's refusal for a list over its limit, read from engine.error; null if the error is another. */
export function parseLimitRefusal(error: string): { acl: number; count: number; max: number; remove: number } | null {
  const m = /(?:standard|extended) list (\d+) has (\d+) ACEs; at most (\d+) can be bound/.exec(error)
  if (!m) return null
  const [acl, count, max] = [Number(m[1]), Number(m[2]), Number(m[3])]
  return { acl, count, max, remove: count - max }
}
