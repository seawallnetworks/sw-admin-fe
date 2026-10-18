// Shared API types. Kept free of imports so both api.ts and mock.ts can use them.

export type AclAction = 'allow' | 'deny'
export type Protocol = 'TCP' | 'UDP' | 'ICMP' | 'ANY'

export interface AclRule {
  id: number
  priority: number
  name: string
  source: string
  protocol: Protocol
  port: string
  action: AclAction
  hits: number
  enabled: boolean
}

export type AclRuleInput = Omit<AclRule, 'id' | 'hits'>

export interface BlockedEvent {
  time: string
  srcIp: string
  type: string
  target: string
  action: string
}

export interface DashboardData {
  inboundPps: number
  droppedPps: number
  activeAclRules: number
  synProtection: boolean
  traffic: { time: string; inbound: number; dropped: number }[]
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
