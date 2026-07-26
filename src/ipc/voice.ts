import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { VoiceModelId } from '@hip/protocol'

export type VoiceRuntimeStatus = {
  mock: boolean
  binaryAvailable: boolean
  binaryPath?: string
  voiceEnvDisabled: boolean
}

export type VoiceModelStatus = {
  model: string
  ready: boolean
  path?: string
  bytesOnDisk?: number
  corrupt?: boolean
  approxBytes?: number
}

export type VoiceTranscriptResult = {
  text: string
  durationMs: number
  audioMs?: number
  model: string
}

export type VoiceDownloadProgress = {
  model: string
  downloaded: number
  total?: number
  phase: string
}

export async function voiceRuntimeStatus(): Promise<VoiceRuntimeStatus> {
  return invoke<VoiceRuntimeStatus>('voice_runtime_status')
}

export async function voiceModelStatus(model?: VoiceModelId): Promise<VoiceModelStatus> {
  return invoke<VoiceModelStatus>('voice_model_status', { args: { model } })
}

export async function voiceDownloadModel(model: VoiceModelId): Promise<{ path: string }> {
  return invoke<{ path: string }>('voice_download_model', { args: { model } })
}

export async function voiceCancelDownload(model: VoiceModelId): Promise<void> {
  await invoke<void>('voice_cancel_download', { args: { model } })
}

export async function voiceTranscribe(args: {
  wavBase64: string
  language?: string
  model?: VoiceModelId
}): Promise<VoiceTranscriptResult> {
  return invoke<VoiceTranscriptResult>('voice_transcribe', { args })
}

export async function voiceOpenModelsDir(): Promise<void> {
  await invoke<void>('voice_open_models_dir')
}

export async function listenVoiceDownloadProgress(
  handler: (p: VoiceDownloadProgress) => void,
): Promise<UnlistenFn> {
  return listen<VoiceDownloadProgress>('voice://download-progress', (ev) => {
    handler(ev.payload)
  })
}
