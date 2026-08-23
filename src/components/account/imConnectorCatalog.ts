import type { ImPlatform, ImConnectorPublic, ImConnectorStatus, ImPermissionMode } from '@hip/protocol'

// ── Platform catalog ───────────────────────────────────────────────────

export interface ImPlatformEntry {
  platform: ImPlatform
  nameKey: string
  descKey: string
  gateKey: string
  brandColor: string
  credentialsFields: Array<{
    key: string
    labelKey: string
    type: 'text' | 'password'
  }>
  steps: Array<{ textKey: string }>
  available: boolean
}

export const IM_PLATFORM_CATALOG: ImPlatformEntry[] = [
  {
    platform: 'feishu',
    nameKey: 'settings.im.platform.feishu',
    descKey: 'settings.im.platform.feishuDesc',
    gateKey: 'settings.im.gate.feishu',
    brandColor: '#3370FF',
    credentialsFields: [
      { key: 'appId', labelKey: 'settings.im.field.appId', type: 'text' },
      { key: 'appSecret', labelKey: 'settings.im.field.appSecret', type: 'password' },
    ],
    steps: [
      { textKey: 'settings.im.steps.feishu.1' },
      { textKey: 'settings.im.steps.feishu.2' },
      { textKey: 'settings.im.steps.feishu.3' },
    ],
    available: true,
  },
  {
    platform: 'wecom',
    nameKey: 'settings.im.platform.wecom',
    descKey: 'settings.im.platform.wecomDesc',
    gateKey: 'settings.im.gate.wecom',
    brandColor: '#1AAD19',
    credentialsFields: [
      { key: 'botId', labelKey: 'settings.im.field.botId', type: 'text' },
      { key: 'secret', labelKey: 'settings.im.field.secret', type: 'password' },
    ],
    steps: [
      { textKey: 'settings.im.steps.wecom.1' },
      { textKey: 'settings.im.steps.wecom.2' },
      { textKey: 'settings.im.steps.wecom.3' },
    ],
    available: true,
  },
  {
    platform: 'dingtalk',
    nameKey: 'settings.im.platform.dingtalk',
    descKey: 'settings.im.platform.dingtalkDesc',
    gateKey: 'settings.im.gate.dingtalk',
    brandColor: '#0089FF',
    credentialsFields: [
      { key: 'clientId', labelKey: 'settings.im.field.clientId', type: 'text' },
      { key: 'clientSecret', labelKey: 'settings.im.field.clientSecret', type: 'password' },
    ],
    steps: [
      { textKey: 'settings.im.steps.dingtalk.1' },
      { textKey: 'settings.im.steps.dingtalk.2' },
      { textKey: 'settings.im.steps.dingtalk.3' },
    ],
    available: true,
  },
]

// ── Pure helpers ───────────────────────────────────────────────────────

/** Get platform catalog entry by platform id. */
export function getPlatformEntry(platform: ImPlatform): ImPlatformEntry | undefined {
  return IM_PLATFORM_CATALOG.find((p) => p.platform === platform)
}

/** Convert a connector record to a form draft (credentials masked). */
export function connectorFormFromRecord(connector: ImConnectorPublic): Record<string, string> {
  const entry = getPlatformEntry(connector.platform)
  if (!entry) return {}

  const form: Record<string, string> = {
    id: connector.id,
    name: connector.name,
    platform: connector.platform,
    permissionMode: connector.permissionMode,
  }

  // Mask credentials: show placeholder if already saved
  for (const field of entry.credentialsFields) {
    form[field.key] = connector.hasCredentials ? '••••••••' : ''
  }

  return form
}

/** Build a connector draft from form values. Empty credential fields preserve old values. */
export function buildConnectorDraft(
  form: Record<string, string>,
  platform: ImPlatform,
): Record<string, unknown> {
  const entry = getPlatformEntry(platform)
  if (!entry) return {}

  const credentials: Record<string, string> = {}
  for (const field of entry.credentialsFields) {
    const val = form[field.key]
    // Don't include masked/empty values (server preserves existing)
    if (val && val !== '••••••••') {
      credentials[field.key] = val
    }
  }

  return {
    id: form.id || '',
    platform,
    name: form.name || '',
    enabled: true,
    credentials,
    permissionMode: (form.permissionMode as ImPermissionMode) || 'confirm',
    allowlist: [],
    parked: [],
    status: 'disconnected',
  }
}

/** Map connector status to a badge color class. */
export function statusBadgeColor(status: ImConnectorStatus): string {
  switch (status) {
    case 'connected': return 'text-green-500'
    case 'connecting': return 'text-yellow-500'
    case 'disconnected': return 'text-gray-400'
    case 'error': return 'text-red-500'
  }
}

/** Map connector status to an i18n key. */
export function statusBadgeKey(status: ImConnectorStatus): string {
  switch (status) {
    case 'connected': return 'settings.im.status.connected'
    case 'connecting': return 'settings.im.status.connecting'
    case 'disconnected': return 'settings.im.status.disconnected'
    case 'error': return 'settings.im.status.error'
  }
}

/** Map permission mode to an i18n key. */
export function permissionModeLabelKey(mode: ImPermissionMode): string {
  switch (mode) {
    case 'confirm': return 'settings.im.permissionModeConfirm'
    case 'auto': return 'settings.im.permissionModeAuto'
  }
}

/** Map a platform error code to a friendly i18n key. */
export function errcodeToI18nKey(errcode: string): string {
  const map: Record<string, string> = {
    INVALID_CREDENTIALS: 'settings.im.errcode.invalid_credentials',
    APP_NOT_PUBLISHED: 'settings.im.errcode.app_not_published',
    BOT_REMOVED: 'settings.im.errcode.bot_removed',
    NETWORK_ERROR: 'settings.im.errcode.network_error',
  }
  return map[errcode] ?? errcode
}

/** Get all connectors for a specific platform. */
export function connectorsForPlatform(
  connectors: ImConnectorPublic[],
  platform: ImPlatform,
): ImConnectorPublic[] {
  return connectors.filter((c) => c.platform === platform)
}
