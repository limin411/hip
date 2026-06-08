import type { TraceRun } from './tool-trace.js'

/** Localized note appended when the model claims a file write that never happened. */
const NOTE: Record<'en' | 'zh-CN' | 'zh-TW', string> = {
  en: '⚠️ No files were actually created this turn — no write tool was called.',
  'zh-CN': '⚠️ 本回合没有真正创建任何文件——没有调用写入工具。',
  'zh-TW': '⚠️ 本回合沒有真正建立任何檔案——沒有呼叫寫入工具。',
}

const WRITE_TOOLS = new Set(['write_file', 'edit_file'])

const FILE_TOKEN = String.raw`(?:[\w./-]*[\w-]\.[A-Za-z0-9]+|\/[\w./-]+)`
const EN_VERB = String.raw`(?:created|wrote|saved|generated)`
const CJK_VERB = String.raw`(?:已创建|已生成|已保存|建立)`
const CLAIM_PATTERNS: RegExp[] = [
  new RegExp(String.raw`\b${EN_VERB}\b[\s\S]{0,80}?${FILE_TOKEN}`, 'i'),
  new RegExp(String.raw`${FILE_TOKEN}[\s\S]{0,80}?\b${EN_VERB}\b`, 'i'),
  new RegExp(String.raw`${CJK_VERB}[\s\S]{0,40}?${FILE_TOKEN}`),
  new RegExp(String.raw`${FILE_TOKEN}[\s\S]{0,40}?${CJK_VERB}`),
]

function claimsCreation(text: string): boolean {
  return CLAIM_PATTERNS.some((re) => re.test(text))
}

/**
 * Detect the "phantom write" lie: the supervisor's final text claims a file was
 * created, but no write_file/edit_file actually FINISHED this turn across any run.
 */
export function verifyWrites(
  trajectory: Map<string, TraceRun>,
  supervisorText: string,
  language: 'en' | 'zh-CN' | 'zh-TW',
): { correction?: string } {
  const writtenPaths = new Set<string>()
  for (const run of trajectory.values()) {
    for (const tc of run.toolCalls.values()) {
      if (WRITE_TOOLS.has(tc.name) && tc.status === 'finished') writtenPaths.add(tc.input)
    }
  }
  if (claimsCreation(supervisorText) && writtenPaths.size === 0) {
    return { correction: NOTE[language] }
  }
  return {}
}
