// Shared API types. Kept free of imports so both api.ts and mock.ts can use them.

// Field names and values as docs/api.md (in lua-resty-sw-admin) has them: snake_case names,
// lowercase enum values, timestamps in Unix epoch seconds. Labels for display are the views' job.

/** An access list's entry. `ace` is the rule in Cisco syntax, as the device writes it. */
export interface AclEntry {
  seq: number
  ace: string
}

export interface DeviceConfig {
  /** Counts changes to the running configuration; only in the `running` reply. */
  generation?: number
  /**
   * Only in the `startup` reply: whether a configuration is saved. False on a fresh install, and `config`
   * is then the defaults the device starts with.
   */
  present?: boolean
  config: {
    hostname: string
    /** By Linux interface name; `acls_in` are the lists applied to incoming traffic, sorted. */
    interfaces: Record<string, { acls_in: number[] }>
    /** By list number, as a string: 1-99 standard, 100-199 extended. Entries sorted by `seq`. */
    acls: Record<string, AclEntry[]>
    voidGate: object
    feed: object
  }
}

/** GET /config/pending. */
export interface ConfigPending {
  /** Whether a restart would lose a change: the running configuration differs from the startup one. */
  dirty: boolean
  /** Whether a configuration is saved at all; false on a fresh install, until the first save. */
  present: boolean
}

/** Every change call's reply; deleting or adding an entry also gives its `seq`. */
export interface ChangeReply {
  generation: number
  seq?: number
}

export type AclEngineState = 'applied' | 'pending' | 'unreachable' | 'refused' | 'off'

export interface AclEngine {
  state: AclEngineState
  /** When it entered `state`, epoch seconds. */
  since: number
  /** null when `off`. */
  socket: string | null
  /** Why mfwd refused it, when `refused`. */
  error?: string
  /** Only when `applied`. */
  config_generation?: number
  mfwd_generation?: number
  /** mfwd answered just now; only then are there `attached` and `counters`. */
  live: boolean
  attached?: string[]
  /** Interfaces that apply a list but don't exist on the device. */
  missing?: string[]
  /**
   * Only when `live`: 'sw_flowd' while mfwd reads sw_flowd's table of the device's own connections, whose
   * replies then pass with no entry; 'none' without it, a broken install (Seawall proposal 0015 §6):
   * replies fall back to "established", so UDP replies such as DNS's, and ICMP but path MTU errors, are
   * dropped unless a list permits them.
   */
  flows?: 'sw_flowd' | 'none'
  counters?: Record<string, number>
  /**
   * Only when `live`: the packets behind the counter `reply_miss`, newest first, at most 16 (Seawall
   * proposal 0015 §7). They looked like replies to the device's own connections but matched none sw_flowd
   * recorded, and the extended list dropped them.
   */
  reply_misses?: ReplyMiss[]
}

/** One of `reply_miss`'s samples, as sw_configd's acl_engine gives it. */
export interface ReplyMiss {
  /** Unix time, ms. */
  time_ms: number
  interface: string
  /** IP protocol number: 6 TCP, 17 UDP, 1 ICMP. */
  proto: number
  src: string
  dst: string
  /** TCP and UDP; 0 otherwise. */
  sport: number
  dport: number
  /** TCP's flags byte (16 ACK, 4 RST); 0 otherwise. */
  tcp_flags: number
  /** ICMP; 0 otherwise. */
  icmp_type: number
  icmp_code: number
}

/** Every event's severity (Seawall proposal 0012 §3). */
export type Severity = 'info' | 'warning' | 'critical'

/** A state alert: raised by sw_logd, and later cleared. */
export interface Alert {
  id: number
  /** One word, for the program: 'voidgate_unreachable', 'mfwd_no_flow_table', ... */
  condition: string
  severity: Severity
  /** For a person. */
  message: string
  raised: number
  /** null, or missing in GET /alerts: still open. */
  cleared?: number | null
}

/** An audit record: a login, a change, a refused request. */
export interface AuditRecord {
  id: number
  time: number
  severity: Severity
  /** 'admin': changes and refusals; 'login': logins, logouts, expiries, passwords. */
  kind: string
  /** The daemon that sent it. */
  source: string
  user: string | null
  /** 'web', 'cli' or 'local'. */
  entry: string | null
  client: string | null
  op: string | null
  object: string | null
  /** 'ok', or why not. */
  result: string | null
  detail: unknown
  /** > 0: a summary of `count` more failures. */
  count: number
  /** A field was too long and was cut, ending `…[+N bytes]`. */
  truncated: boolean
}

/** A network voidgate blocked, or a summary of `more` of them. */
export interface BlockRecord {
  id: number
  /** null for a summary. */
  network: string | null
  reason: string
  started: number
  /** It started while nothing was reading: `started` is when voidgate listed it. */
  started_after_gap: boolean
  /** null: in force. */
  ended: number | null
  /** 'unblock', 'expired', 'reload', 'disarm', 'unknown'. */
  end_state: string | null
  rate: number | null
  /**
   * 'socket' (someone asked: `uid`), 'ban' (a gateway or an application banning through the ban
   * socket: `uid`) or 'self' (voidgate's policy); null when unknown.
   */
  origin: string | null
  uid: number | null
  /** Asked for outside the console and the CLI. */
  out_of_band: boolean
  more: number
}

/** A state change: voidgate's arm, disarm, reload; mfwd's apply; a gap in either. */
export interface ChangeRecord {
  id: number
  time: number
  severity: Severity
  /** 'voidgate' or 'mfwd'. */
  source: string
  /** 'arm', 'disarm', 'reload', 'apply', 'gap'. */
  op: string
  /** voidgate's 'socket', 'ban' or 'self'; mfwd's 'apply' or 'restart'. */
  origin: string | null
  uid: number | null
  user: string | null
  cause: string | null
  /** mfwd's policy generation, for an apply. */
  generation: number | null
  out_of_band: boolean
}

/** A page of an event list, newest first; pass `next` as `before` for the one after, null at the end. */
export interface EventPage<T> {
  records: T[]
  next: number | null
}

/** GET /events/trends: traffic counters in buckets of `width` seconds. */
export interface Trends {
  tier: string
  width: number
  threshold: number
  since: number
  until: number
  /** Per bucket and source, the seconds measured; a bucket not `covered`, or not listed, is a gap. */
  coverage: { time: number; source: string; secs: number; ratio: number; covered: boolean }[]
  series: { time: number; source: string; series: string; pkts: number; bytes: number; peak_pps: number }[]
}

export interface DashboardData {
  /** voidgate's latest 10-second interval; null when there is none recent: show "-". */
  inbound_pps: number | null
  dropped_pps: number | null
  /** Entries in the access lists that interfaces apply; null when unknown. */
  active_acl_rules: number | null
  /** Oldest first, one point every 10 seconds; null rates are a gap, drawn as a break. */
  traffic: { time: number; inbound_pps: number | null; dropped_pps: number | null }[]
  /** The latest blocks of the last 24 hours, newest first, at most 10. */
  blocks: Pick<BlockRecord, 'network' | 'reason' | 'started' | 'ended' | 'more'>[]
  /** The open alerts, most severe first. */
  alerts: Alert[]
}

export type Role = 'admin' | 'user'

export interface RequestOptions {
  query?: Record<string, string | number | undefined>
  body?: unknown
  /** The caller handles every error itself, a 401 included: no toast, no redirect to the login page. */
  silent?: boolean
  /**
   * Made by the page on its own, such as a poll (see usePoller.ts): sent with `X-SW-Background: 1`, so it
   * doesn't count as the user's activity and a page left open still times out.
   */
  background?: boolean
}

export class ApiError extends Error {
  status: number
  /** The backend's one-word reason ("denied", "perm", ...); null when the reply wasn't JSON. */
  code: string | null
  constructor(status: number, code: string | null, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}
