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
}

export type EventType = 'acl_deny' | 'syn_flood' | 'http_flood' | 'cc' | 'brute_force'

export interface BlockedEvent {
  time: number
  src_ip: string
  type: EventType
  target: string
  action: 'drop'
}

export interface DashboardData {
  inbound_pps: number
  dropped_pps: number
  /** Entries in the access lists that interfaces apply. */
  active_acl_rules: number
  syn_protection: boolean
  /** Oldest first, one point every 5 seconds. */
  traffic: { time: number; inbound_pps: number; dropped_pps: number }[]
  /** Newest first, at most 10. */
  events: BlockedEvent[]
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
