import type { TraceRun } from './tool-trace.js'

/** Localized note appended when the model claims a file write that never happened. */
const NOTE: Record<'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko', string> = {
  en: '⚠️ No files were actually created this turn — no write tool was called.',
  'zh-CN': '⚠️ 本回合没有真正创建任何文件——没有调用写入工具。',
  'zh-TW': '⚠️ 本回合沒有真正建立任何檔案——沒有呼叫寫入工具。',
  ja: '⚠️ このターンでは実際にはファイルが作成されていません——書き込みツールは呼び出されませんでした。',
  ko: '⚠️ 이번 턴에서 실제로 생성된 파일이 없습니다——쓰기 도구가 호출되지 않았습니다.',
}

const WRITE_TOOLS = new Set(['write_file', 'edit_file'])

const FILE_TOKEN = String.raw`(?:[\w./-]*[\w-]\.[A-Za-z0-9]+|\/[\w./-]+)`
const EN_VERB = String.raw`(?:created|wrote|saved|generated)`
const CJK_VERB = String.raw`(?:已创建|已生成|已保存|建立)`
// Detection is intentionally conservative: a claim must name a concrete file (word.ext
// or /path) next to a past-tense creation verb. We do NOT match generic nouns ("the file"),
// because phrases like "no files were created" would then falsely trigger a correction, and
// a robust negation guard for those is fragile. Prompt hardening (agents.ts) is the primary
// defense against phantom-file claims; this regex is the safety net for fabricated paths.
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
  language: 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko',
): { correction?: string } {
  let hasFinishedWrite = false
  outer: for (const run of trajectory.values()) {
    for (const tc of run.toolCalls.values()) {
      if (WRITE_TOOLS.has(tc.name) && tc.status === 'finished') { hasFinishedWrite = true; break outer }
    }
  }
  if (claimsCreation(supervisorText) && !hasFinishedWrite) {
    return { correction: NOTE[language] ?? NOTE.en }
  }
  return {}
}
