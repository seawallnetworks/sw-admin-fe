// Shared API types. Kept free of imports so both api.ts and mock.ts can use them.

// Field names and values as docs/api.md (in lua-resty-sw-admin) has them: snake_case names,
// lowercase enum values, timestamps in Unix epoch seconds. Labels for display are the views' job.

export type AclAction = 'allow' | 'deny'
export type Protocol = 'tcp' | 'udp' | 'icmp' | 'any'

export interface AclRule {
  id: number
  priority: number
  name: string
  source: string
  protocol: Protocol
  /** "443" or "8000-8080"; null for any port, and always null for icmp and any. */
  port: string | null
  action: AclAction
  hits: number
  enabled: boolean
}

export type AclRuleInput = Omit<AclRule, 'id' | 'hits'>

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
