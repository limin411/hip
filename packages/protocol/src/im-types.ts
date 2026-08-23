/** IM Connector shared types for protocol and sidecar. */

/** Supported IM platforms. */
export type ImPlatform = 'feishu' | 'wecom' | 'dingtalk'

/** Per-connector permission mode for HITL. */
export type ImPermissionMode = 'confirm' | 'auto'

/** Allowlist entry: a user or a chat that is authorized. */
export interface ImAllowlistEntry {
  kind: 'user' | 'chat'
  id: string
  name?: string
  role?: string
}

/** Parked (unauthorized) inbound entry. */
export interface ImParkedEntry {
  kind: 'user' | 'chat'
  id: string
  name?: string
  firstSeenAt: number
}

/** Connector status. */
export type ImConnectorStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/** Credentials per platform. */
export type ImCredentials =
  | { appId: string; appSecret: string }
  | { botId: string; secret: string }
  | { clientId: string; clientSecret: string }

/** On-disk connector record. */
export interface ImConnectorRecord {
  id: string
  platform: ImPlatform
  name: string
  enabled: boolean
  credentials: ImCredentials
  permissionMode: ImPermissionMode
  allowlist: ImAllowlistEntry[]
  parked: ImParkedEntry[]
  status: ImConnectorStatus
  lastError?: string | null
  createdAt: number
  updatedAt: number
}

/** Public view of a connector (no credentials). */
export type ImConnectorPublic = Omit<ImConnectorRecord, 'credentials'> & {
  hasCredentials: boolean
}

/** Origin metadata for sessions created from IM. */
export interface ImSessionOrigin {
  kind: 'im'
  platform: ImPlatform
  connectorId: string
  chatId: string
  chatName?: string
}
