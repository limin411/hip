/**
 * Adapter factory — creates platform adapters from connector config.
 * Uses dynamic imports so the app doesn't crash if SDK packages aren't installed.
 */

import type { ImConnectorRecord } from '@hip/protocol'
import type { BaseImAdapter } from './types.js'
import { FeishuAdapter } from './adapters/feishu.js'

export function createAdapter(connector: ImConnectorRecord): BaseImAdapter | null {
  switch (connector.platform) {
    case 'feishu':
      return createFeishuAdapter(connector)
    case 'wecom':
      return createWeComAdapter(connector)
    case 'dingtalk':
      return createDingtalkAdapter(connector)
    default:
      return null
  }
}

function createFeishuAdapter(connector: ImConnectorRecord): BaseImAdapter | null {
  const creds = connector.credentials as { appId?: string; appSecret?: string } | undefined
  if (!creds?.appId || !creds?.appSecret) return null

  // Try to dynamically import Lark SDK
  let larkClient: unknown
  let wsClient: unknown
  let eventDispatcher: unknown
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sdk = require('@larksuiteoapi/node-sdk')
    larkClient = new sdk.Client({
      appId: creds.appId,
      appSecret: creds.appSecret,
    })
    eventDispatcher = new sdk.EventDispatcher({})
    wsClient = new sdk.WSClient({
      appId: creds.appId,
      appSecret: creds.appSecret,
      eventDispatcher,
      loggerLevel: sdk.LoggerLevel.WARN,
    })
  } catch {
    // SDK not installed — adapter will fail on connect with a clear error
    return new FeishuAdapter(
      { connectorId: connector.id, appId: creds.appId, appSecret: creds.appSecret },
      {},
    )
  }

  return new FeishuAdapter(
    { connectorId: connector.id, appId: creds.appId, appSecret: creds.appSecret },
    {
      larkClient: larkClient as any,
      wsClient: wsClient as any,
      eventDispatcher: eventDispatcher as any,
    },
  )
}

function createWeComAdapter(connector: ImConnectorRecord): BaseImAdapter | null {
  // WeCom adapter not yet implemented
  return null
}

function createDingtalkAdapter(connector: ImConnectorRecord): BaseImAdapter | null {
  // DingTalk adapter not yet implemented
  return null
}
