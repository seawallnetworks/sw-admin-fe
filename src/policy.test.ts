import { describe, expect, it } from 'vitest'
import { ipToInt, parseAddrLines, parseAddress, parseAceRule, stdAce } from './ace'
import {
  DENY_HOST_NOTE, EXT_MAX_ENTRIES, KEY_IMPLICIT_DENY, KEY_NO_EXT, KEY_REPLIES, STD_MAX_ENTRIES, deniedHost, limitError, listFill, parseLimitRefusal, covers, defaultStdPosition, entryKey, entryNotes, evaluate, isVeryBroad,
  nextFreeList, permitsTcpPort, placeEntries, policyRows, positionAfter, positionOptions, shadowingEntry,
  type Packet,
} from './policy'
import type { AclEntry, DeviceConfig } from './types'

const ip = (s: string) => ipToInt(s)!

function config(interfaces: Record<string, number[]>, acls: Record<string, string[]>): DeviceConfig['config'] {
  return {
    hostname: 'sw1',
    interfaces: Object.fromEntries(Object.entries(interfaces).map(([k, v]) => [k, { acls_in: v }])),
    acls: Object.fromEntries(
      Object.entries(acls).map(([k, v]) => [k, v.map((ace, i) => ({ seq: (i + 1) * 10, ace }))]),
    ),
    voidGate: {},
    feed: {},
  }
}

const tcp = (src: string, dst: string, dport: number | null, extra: Partial<Packet> = {}): Packet => ({
  proto: 6, src: ip(src), dst: ip(dst), sport: 40000, dport, state: 'new', ...extra,
})

// the mock's eth0, as on a device written back by mfw_format_ace
const cfg = config(
  { eth0: [10, 100], eth1: [10], eth2: [100], eth3: [120] },
  {
    10: ['deny host 203.0.113.66', 'deny 198.51.100.0 0.0.0.255', 'permit any'],
    100: [
      'permit tcp 192.168.1.0 0.0.0.255 any eq 22',
      'deny tcp any any eq 22',
      'permit tcp any host 10.0.0.5 eq 443',
      'permit tcp any any established',
      'permit udp any any eq 53',
      'permit icmp any any',
    ],
    120: [],
  },
)

describe('parseAceRule', () => {
  it('reads addresses in every form the device and the form use', () => {
    expect(parseAceRule('deny host 203.0.113.66', true)?.src).toEqual({ net: ip('203.0.113.66'), prefix: 32 })
    expect(parseAceRule('deny 198.51.100.0 0.0.0.255', true)?.src).toEqual({ net: ip('198.51.100.0'), prefix: 24 })
    expect(parseAceRule('deny 198.51.100.0/24', true)?.src).toEqual({ net: ip('198.51.100.0'), prefix: 24 })
    expect(parseAceRule('permit any', true)?.src.prefix).toBe(0)
    expect(parseAceRule('deny 10.0.0.0 0.0.255.0', true)).toBeNull() // not contiguous
  })

  it('reads protocols and ports as parse_port does', () => {
    const r = parseAceRule('permit tcp any gt 1023 any range 8000 8080 established', false)!
    expect(r.proto).toBe(6)
    expect(r.sport).toEqual({ min: 1024, max: 65535 })
    expect(r.dport).toEqual({ min: 8000, max: 8080 })
    expect(r.established).toBe(true)
    expect(parseAceRule('permit tcp any any lt 1024', false)?.dport).toEqual({ min: 1, max: 1023 })
    expect(parseAceRule('permit ip any any', false)?.proto).toBe(0)
    expect(parseAceRule('deny 47 any any', false)?.proto).toBe(47)
  })

  it('refuses what mini-fw refuses', () => {
    // replies pass with no entry (Seawall proposal 0015): mini-fw refuses the keyword
    expect(parseAceRule('permit udp any any reply', false)).toBeNull()
    expect(parseAceRule('permit tcp any any established reply', false)).toBeNull()
    expect(parseAceRule('permit icmp any any eq 1', false)).toBeNull()
    expect(parseAceRule('permit udp any any established', false)).toBeNull()
    expect(parseAceRule('permit tcp any any gt 65535', false)).toBeNull()
    expect(parseAceRule('permit tcp any any lt 1', false)).toBeNull()
    expect(parseAceRule('permit tcp any any range 9 8', false)).toBeNull()
    expect(parseAceRule('allow tcp any any', false)).toBeNull()
  })
})

describe('evaluate', () => {
  it('drops a standard deny in stage 1', () => {
    const v = evaluate(cfg, 'eth0', tcp('203.0.113.66', '10.0.0.5', 443))
    expect(v).toMatchObject({ result: 'drop', key: entryKey(10, 10) })
    expect(v.text).toContain('Stage 1: entry 10 of list 10')
  })

  it('goes on after a standard permit, and stage 2 decides', () => {
    const v = evaluate(cfg, 'eth0', tcp('203.0.113.9', '10.0.0.5', 22))
    expect(v).toMatchObject({ result: 'drop', key: entryKey(100, 20) })
    expect(v.text).toContain('a standard permit goes on')
    expect(v.text).toContain('Stage 2: entry 20 of list 100 (deny tcp any any eq 22) matches.')
  })

  it('takes the first match in stage 2', () => {
    expect(evaluate(cfg, 'eth0', tcp('192.168.1.7', '10.0.0.9', 22))).toMatchObject({ result: 'pass', key: entryKey(100, 10) })
  })

  it('drops what the extended list does not permit (implicit deny)', () => {
    const v = evaluate(cfg, 'eth0', tcp('203.0.113.9', '10.0.0.9', 8080))
    expect(v).toMatchObject({ result: 'drop', key: KEY_IMPLICIT_DENY })
    expect(v.text).toContain('so the implicit deny drops it')
  })

  it('drops everything on an empty extended list', () => {
    expect(evaluate(cfg, 'eth3', tcp('192.168.1.7', '10.0.0.5', 443))).toMatchObject({ result: 'drop', key: KEY_IMPLICIT_DENY })
  })

  it('passes what stage 1 lets through when no extended list is bound (fail-open)', () => {
    const v = evaluate(cfg, 'eth1', tcp('192.0.2.1', '10.0.0.9', 8080))
    expect(v).toMatchObject({ result: 'pass', key: KEY_NO_EXT })
    expect(v.text).toContain('Stage 1: entry 30 of list 10 (permit any) matches')
  })

  it('says when stage 1 has no list, and no deny matches', () => {
    expect(evaluate(cfg, 'eth2', tcp('192.0.2.1', '10.0.0.5', 443)).text).toMatch(/^Stage 1: no standard list\./)
    const c = config({ e: [10] }, { 10: ['deny host 203.0.113.66'] })
    expect(evaluate(c, 'e', tcp('203.0.113.9', '10.0.0.5', 443)).text).toContain('Stage 1: no deny matches 203.0.113.9.')
  })

  it('matches established on ACK or RST', () => {
    expect(evaluate(cfg, 'eth2', tcp('192.0.2.1', '10.0.0.9', 5000)).result).toBe('drop')
    expect(evaluate(cfg, 'eth2', tcp('192.0.2.1', '10.0.0.9', 5000, { state: 'established' })).key).toBe(entryKey(100, 40))
  })

  it('passes a reply before the extended list, with no entry', () => {
    const c = config({ e: [100] }, { 100: ['permit tcp any any eq 22'] })
    const udp: Packet = { proto: 17, src: ip('8.8.8.8'), dst: ip('10.0.0.5'), sport: 53, dport: 40000, state: 'new' }
    expect(evaluate(c, 'e', udp)).toMatchObject({ result: 'drop', key: KEY_IMPLICIT_DENY })
    const v = evaluate(c, 'e', { ...udp, state: 'reply' })
    expect(v).toMatchObject({ result: 'pass', key: KEY_REPLIES })
    expect(v.text).toContain('passes before list 100, with no entry')
    const ping: Packet = { proto: 1, src: ip('8.8.8.8'), dst: ip('10.0.0.5'), sport: null, dport: null, state: 'reply' }
    expect(evaluate(c, 'e', ping)).toMatchObject({ result: 'pass', key: KEY_REPLIES })
  })

  it('counts a UDP reply only to an ephemeral port', () => {
    const c = config({ e: [100] }, { 100: ['permit udp any any eq 1234'] })
    const udp: Packet = { proto: 17, src: ip('8.8.8.8'), dst: ip('10.0.0.5'), sport: 53, dport: 5353, state: 'reply' }
    const v = evaluate(c, 'e', udp)
    expect(v).toMatchObject({ result: 'drop', key: KEY_IMPLICIT_DENY })
    expect(v.text).toContain('only to an ephemeral port (32768 to 60999)')
    expect(evaluate(c, 'e', { ...udp, dport: 1234 })).toMatchObject({ result: 'pass', key: entryKey(100, 10) })
    expect(evaluate(c, 'e', { ...udp, dport: 32768 }).key).toBe(KEY_REPLIES)
    expect(evaluate(c, 'e', { ...udp, dport: 60999 }).key).toBe(KEY_REPLIES)
    expect(evaluate(c, 'e', { ...udp, dport: 61000 }).key).toBe(KEY_IMPLICIT_DENY)
  })

  it('counts a UDP reply to 123, record_udp_ports, as ntpd sends from it', () => {
    const c = config({ e: [100] }, { 100: ['permit tcp any any eq 22'] })
    const ntp: Packet = { proto: 17, src: ip('203.0.113.5'), dst: ip('10.0.0.5'), sport: 123, dport: 123, state: 'reply' }
    expect(evaluate(c, 'e', ntp).key).toBe(KEY_REPLIES)
    expect(evaluate(c, 'e', { ...ntp, dport: 124 }).text).toContain('or to 123, so list 100 decides')
  })

  it("passes a DHCP server's answer with no entry, reply or not", () => {
    const c = config({ e: [10, 100] }, { 10: ['deny host 192.0.2.66'], 100: ['permit tcp any any eq 22'] })
    const dhcp: Packet = { proto: 17, src: ip('10.0.0.1'), dst: ip('255.255.255.255'), sport: 67, dport: 68, state: 'new' }
    const v = evaluate(c, 'e', dhcp)
    expect(v).toMatchObject({ result: 'pass', key: KEY_REPLIES })
    expect(v.text).toContain("a DHCP server's answer")
    expect(evaluate(c, 'e', { ...dhcp, state: 'reply' }).key).toBe(KEY_REPLIES)
    expect(evaluate(c, 'e', { ...dhcp, sport: 66 }).key).toBe(KEY_IMPLICIT_DENY)
    expect(evaluate(c, 'e', { ...dhcp, proto: 6 }).result).toBe('drop')
    // the standard list still stops it
    expect(evaluate(c, 'e', { ...dhcp, src: ip('192.0.2.66') }).result).toBe('drop')
  })

  it('lets a stage 1 deny stop a reply, and not a stage 2 deny', () => {
    const c = config({ e: [10, 100] }, { 10: ['deny host 192.0.2.1'], 100: ['deny ip host 192.0.2.2 any'] })
    expect(evaluate(c, 'e', tcp('192.0.2.1', '10.0.0.5', 40000, { state: 'reply' })).result).toBe('drop')
    expect(evaluate(c, 'e', tcp('192.0.2.2', '10.0.0.5', 40000, { state: 'reply' }))).toMatchObject({
      result: 'pass',
      key: KEY_REPLIES,
    })
  })

  it('lets "ip" match every protocol, and ignores ports for ICMP', () => {
    const c = config({ e: [100] }, { 100: ['deny ip host 192.0.2.1 any', 'permit icmp any any'] })
    const icmp: Packet = { proto: 1, src: ip('192.0.2.1'), dst: ip('10.0.0.5'), sport: null, dport: null, state: 'new' }
    expect(evaluate(c, 'e', icmp).key).toBe(entryKey(100, 10))
    expect(evaluate(c, 'e', { ...icmp, src: ip('192.0.2.2') }).result).toBe('pass')
  })

  it('says when a blank source port is why an entry did not match', () => {
    const c = config({ e: [100] }, { 100: ['permit udp any eq 53 any'] })
    const v = evaluate(c, 'e', { proto: 17, src: ip('8.8.8.8'), dst: ip('10.0.0.5'), sport: null, dport: 40000, state: 'new' })
    expect(v.result).toBe('drop')
    expect(v.text).toContain("needs a source port, and the packet's is blank")
  })
})

describe('deniedHost', () => {
  it('names the host of an extended deny of one source', () => {
    expect(deniedHost('deny ip host 203.0.113.9 any', false)).toBe('203.0.113.9')
    expect(deniedHost('deny tcp 203.0.113.9/32 any eq 22', false)).toBe('203.0.113.9')
  })

  it('says nothing of a permit, a network, any, or a standard list', () => {
    expect(deniedHost('permit ip host 203.0.113.9 any', false)).toBeNull()
    expect(deniedHost('deny ip 203.0.113.0 0.0.0.255 any', false)).toBeNull()
    expect(deniedHost('deny ip any host 10.0.0.5', false)).toBeNull()
    expect(deniedHost('deny host 203.0.113.9', true)).toBeNull()
  })

  it('notes it in the policy table', () => {
    const notes = entryNotes([{ seq: 10, ace: 'deny ip host 203.0.113.9 any' }], false)
    expect(notes).toEqual([{ text: DENY_HOST_NOTE, kind: 'muted' }])
  })
})

describe('policyRows', () => {
  it('lists both stages in order, with the implicit rows', () => {
    const rows = policyRows(cfg, 'eth0')
    expect(rows.map((r) => (r.kind === 'entry' ? `${r.acl}/${r.seq}` : r.kind))).toEqual([
      'stage', '10/10', '10/20', '10/30', 'implicit',
      'stage', 'implicit', '100/10', '100/20', '100/30', '100/40', '100/50', '100/60', 'implicit',
    ])
    expect(rows[6]).toMatchObject({ key: KEY_REPLIES, result: 'Pass', resultType: 'pass' })
    expect(rows.at(-1)).toMatchObject({ key: KEY_IMPLICIT_DENY, result: 'Drop (implicit)' })
  })

  it('marks a standard permit with no deny after it as having no effect, and not one before a deny', () => {
    const noEffect = policyRows(cfg, 'eth0').find((r) => r.kind === 'entry' && r.seq === 30 && r.acl === 10)
    expect(noEffect).toMatchObject({ note: { text: expect.stringMatching(/^No effect/), kind: 'muted' } })
    const c = config({ e: [10] }, { 10: ['permit host 198.51.100.7', 'deny 198.51.100.0/24'] })
    expect(policyRows(c, 'e').find((r) => r.kind === 'entry')).toMatchObject({ note: undefined })
  })

  it('marks an entry an earlier one covers as never matching', () => {
    const notes = entryNotes(
      [{ seq: 10, ace: 'permit tcp any any' }, { seq: 20, ace: 'deny tcp host 192.0.2.1 any eq 22' }, { seq: 30, ace: 'deny udp any any' }],
      false,
    )
    expect(notes).toEqual([undefined, { text: 'Never matches: seq 10 covers it', kind: 'warn' }, undefined])
  })

  it('heads stage 2 with "everything passes" when no extended list is bound', () => {
    expect(policyRows(cfg, 'eth1').at(-1)).toMatchObject({ kind: 'stage', key: KEY_NO_EXT, acl: null })
    expect(policyRows(cfg, 'eth2')[0]).toMatchObject({ kind: 'stage', acl: null, text: 'Stage 1 · No standard list' })
  })
})

describe('positions', () => {
  const list = (...seqs: number[]): AclEntry[] => seqs.map((seq) => ({ seq, ace: 'permit any' }))

  it('offers the top, every gap and the end', () => {
    expect(positionOptions(list(10, 20, 21)).map((o) => [o.label, o.seqs])).toEqual([
      ['At the top', [5]],
      ['After seq 10, before 20', [15]],
      ['After seq 20, before 21', null],
      ['At the end', [31]],
    ])
  })

  it('spreads several entries, and refuses a gap too small for them', () => {
    const o = positionOptions(list(10, 20), 3)
    expect(o.map((x) => x.seqs)).toEqual([[2, 4, 6], [12, 14, 16], [30, 40, 50]])
    expect(positionOptions(list(10, 13), 3)[1].seqs).toBeNull()
  })

  it('has no top below seq 2, and starts an empty list at 10', () => {
    expect(positionOptions(list(1))[0].seqs).toBeNull()
    expect(positionOptions([], 2)).toEqual([{ key: 'end', label: 'At the end', seqs: [10, 20] }])
  })

  it('puts a standard entry before the first one matching every source, by default', () => {
    expect(defaultStdPosition(cfg.acls[10])).toBe('after-20')
    expect(defaultStdPosition([{ seq: 10, ace: 'permit any' }])).toBe('top')
    expect(defaultStdPosition([{ seq: 10, ace: 'deny host 192.0.2.1' }])).toBe('end')
  })

  it('inserts below an entry, and places new entries in order', () => {
    expect(positionAfter(list(10, 20), 10)).toBe('after-10')
    expect(positionAfter(list(10, 20), 20)).toBe('end')
    expect(placeEntries(list(10, 20), [{ seq: 15, ace: 'x' }]).map((e) => [e.seq, e.isNew])).toEqual([
      [10, false], [15, true], [20, false],
    ])
  })
})

describe('addresses and list numbers', () => {
  it('reads one address, network or any, and names the network when host bits are set', () => {
    expect(parseAddress('192.0.2.7').net).toEqual({ net: ip('192.0.2.7'), prefix: 32 })
    expect(parseAddress('host 192.0.2.7').net?.prefix).toBe(32)
    expect(parseAddress('198.51.100.0/24').net?.prefix).toBe(24)
    expect(parseAddress('any').net?.prefix).toBe(0)
    expect(parseAddress('192.168.1.5/24').error).toBe('192.168.1.5/24 has host bits set; the network is 192.168.1.0/24')
    expect(parseAddress('300.1.1.1').error).toMatch(/not an IPv4/)
  })

  it('reads one source per line, with line numbers for errors', () => {
    const r = parseAddrLines('192.0.2.7\n\n# office\n10.0.0.0/8\nbogus\n')
    expect(r.items.map((i) => [i.line, i.text])).toEqual([[1, '192.0.2.7'], [4, '10.0.0.0/8']])
    expect(r.errors).toMatchObject([{ line: 5, text: 'bogus' }])
    expect(stdAce('deny', r.items[0].net)).toBe('deny host 192.0.2.7')
    expect(stdAce('deny', r.items[1].net)).toBe('deny 10.0.0.0/8')
  })

  it('suggests the next free list number, by tens first', () => {
    expect(nextFreeList(cfg, true)).toBe(20)
    expect(nextFreeList(cfg, false)).toBe(110)
  })

  it('knows whether a list lets in new TCP connections to a port', () => {
    expect(permitsTcpPort(cfg.acls[100], 443)).toBe(true)
    expect(permitsTcpPort(cfg.acls[100], 8443)).toBe(false) // only "established" would match
    expect(permitsTcpPort([{ seq: 10, ace: 'permit ip any any' }], 8443)).toBe(true)
    expect(permitsTcpPort([], 8443)).toBe(false)
  })
})

describe('shadowing and broad entries', () => {
  const ext = (...aces: string[]) => aces.map((ace, i) => ({ seq: (i + 1) * 10, ace }))

  it('finds an earlier entry that covers the new one', () => {
    const entries = ext('permit tcp 192.168.0.0 0.0.255.255 any', 'deny ip any any')
    expect(shadowingEntry(entries, 'deny tcp 192.168.1.0/24 any eq 22', 100, false)?.seq).toBe(10)
    expect(shadowingEntry(entries, 'deny tcp 192.168.1.0/24 any eq 22', 5, false)).toBeNull()
    expect(shadowingEntry(entries, 'permit udp host 10.1.1.1 any', 100, false)?.seq).toBe(20)
  })

  it('does not count an entry with a narrower port or an extra flag as covering', () => {
    const r = (a: string) => parseAceRule(a, false)!
    expect(covers(r('permit tcp any any eq 22'), r('permit tcp any any'), false)).toBe(false)
    expect(covers(r('permit tcp any any range 1 1024'), r('permit tcp any any eq 22'), false)).toBe(true)
    expect(covers(r('permit tcp any any established'), r('permit tcp any any'), false)).toBe(false)
    expect(covers(r('permit udp any any'), r('permit tcp any any'), false)).toBe(false)
  })

  it('flags permit any to any on every port as very broad', () => {
    expect(isVeryBroad('permit ip any any', false)).toBe(true)
    expect(isVeryBroad('permit tcp any any', false)).toBe(true)
    expect(isVeryBroad('permit tcp any any eq 22', false)).toBe(false)
    expect(isVeryBroad('deny ip any any', false)).toBe(false)
    expect(isVeryBroad('permit any', true)).toBe(false)
  })
})

describe('entry limits', () => {
  it('uses mini-fw limits: 64 standard, 128 extended', () => {
    expect(STD_MAX_ENTRIES).toBe(64)
    expect(EXT_MAX_ENTRIES).toBe(128)
    expect(listFill(10, 3)).toEqual({ count: 3, max: 64, room: 61, over: false, nearFull: false })
    expect(listFill(100, 128)).toMatchObject({ max: 128, room: 0, over: false, nearFull: true })
  })

  it('is amber from 90% full', () => {
    expect(listFill(10, 57).nearFull).toBe(false) // 57.6 is 90% of 64
    expect(listFill(10, 58).nearFull).toBe(true)
    expect(listFill(100, 115).nearFull).toBe(false) // 115.2 is 90% of 128
    expect(listFill(100, 116).nearFull).toBe(true)
    expect(listFill(10, 65)).toMatchObject({ over: true, room: 0 })
  })

  it('refuses a change that would go over, and only then', () => {
    expect(limitError(10, 63, 64)).toBeNull()
    expect(limitError(10, 64, 65)).toBe('List 10 can hold at most 64 entries; it has 64. Remove some first.')
    expect(limitError(100, 120, 130)).toBe('List 100 can hold at most 128 entries; it has 120. Remove some first.')
  })

  it("reads mfwd's refusal for a list over the limit", () => {
    expect(parseLimitRefusal('line 3: extended list 100 has 131 ACEs; at most 128 can be bound')).toEqual({
      acl: 100, count: 131, max: 128, remove: 3,
    })
    expect(parseLimitRefusal('standard list 7 has 70 ACEs; at most 64 can be bound')?.remove).toBe(6)
    expect(parseLimitRefusal('rule table full')).toBeNull()
  })
})
