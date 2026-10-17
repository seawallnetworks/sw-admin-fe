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

export interface Page<T> {
  items: T[]
  total: number
}

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

export interface RequestOptions {
  query?: Record<string, string | number | undefined>
  body?: unknown
  /** Don't show a toast on error; caller handles it. */
  silent?: boolean
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
