/**
 * DeepSeek V4 DSML tool-call recovery.
 *
 * V4 sometimes emits DSML markup inside assistant `content` instead of structured
 * OpenAI-style `tool_calls`. Parse those blocks so the agent loop can execute tools.
 *
 * Accepts fullwidth bar forms (`｜DSML｜`) and degraded ASCII (`||DSML||` / `|DSML|`).
 */

export interface DsmlToolCall {
  name: string
  args: Record<string, string>
  id: string
}

export interface DsmlParseResult {
  content: string
  toolCalls: DsmlToolCall[]
  recovered: boolean
}

/** Marker between angle brackets: |DSML| or ||DSML|| or fullwidth ｜ variants. */
const MARK = String.raw`(?:\|{1,2}|｜{1,2})\s*DSML\s*(?:\|{1,2}|｜{1,2})`

const OPEN_TOOL_CALLS = new RegExp(`<\\s*${MARK}\\s*tool_calls\\s*>`, 'i')
const CLOSE_TOOL_CALLS = new RegExp(`</\\s*${MARK}\\s*tool_calls\\s*>`, 'i')
const INVOKE_OPEN = new RegExp(`<\\s*${MARK}\\s*invoke\\s+name="([^"]+)"\\s*>`, 'gi')
const INVOKE_CLOSE = new RegExp(`</\\s*${MARK}\\s*invoke\\s*>`, 'i')
const PARAMETER = new RegExp(
  `<\\s*${MARK}\\s*parameter\\s+name="([^"]+)"[^>]*>([\\s\\S]*?)</\\s*${MARK}\\s*parameter\\s*>`,
  'gi',
)
const ANY_DSML_TAG = new RegExp(`</?\\s*${MARK}[^>]*>`, 'gi')

export function hasDsmlToolCalls(text: string): boolean {
  return OPEN_TOOL_CALLS.test(text)
}

function nextCallId(i: number): string {
  return `dsml_call_${Date.now().toString(36)}_${i}`
}

/**
 * Extract DSML tool calls from assistant text. Strips the tool_calls block from
 * content (and any leftover DSML tags if parse fails partially).
 */
export function parseDsmlToolCalls(text: string): DsmlParseResult {
  if (!text || !OPEN_TOOL_CALLS.test(text)) {
    return { content: text, toolCalls: [], recovered: false }
  }
  // Reset lastIndex after .test on global-ish patterns (OPEN is non-global but recreate safety)
  OPEN_TOOL_CALLS.lastIndex = 0

  const openMatch = text.match(OPEN_TOOL_CALLS)
  if (!openMatch || openMatch.index === undefined) {
    return { content: text, toolCalls: [], recovered: false }
  }

  const start = openMatch.index
  const afterOpen = start + openMatch[0].length
  CLOSE_TOOL_CALLS.lastIndex = 0
  const closeMatch = text.slice(afterOpen).match(CLOSE_TOOL_CALLS)
  if (!closeMatch || closeMatch.index === undefined) {
    // Incomplete block — strip what we can so raw markup is not shown as the answer.
    const stripped = text.replace(ANY_DSML_TAG, '').trim()
    return { content: stripped, toolCalls: [], recovered: false }
  }

  const blockEnd = afterOpen + closeMatch.index + closeMatch[0].length
  const block = text.slice(afterOpen, afterOpen + closeMatch.index)
  const before = text.slice(0, start).trimEnd()
  const after = text.slice(blockEnd).trimStart()
  const content = [before, after].filter(Boolean).join('\n').trim()

  const toolCalls: DsmlToolCall[] = []
  INVOKE_OPEN.lastIndex = 0
  let inv: RegExpExecArray | null
  while ((inv = INVOKE_OPEN.exec(block)) !== null) {
    const name = inv[1]
    const invStart = inv.index + inv[0].length
    const rest = block.slice(invStart)
    const closeInv = rest.match(INVOKE_CLOSE)
    const invBody = closeInv && closeInv.index !== undefined ? rest.slice(0, closeInv.index) : rest

    const args: Record<string, string> = {}
    PARAMETER.lastIndex = 0
    let pm: RegExpExecArray | null
    while ((pm = PARAMETER.exec(invBody)) !== null) {
      args[pm[1]] = pm[2]
    }

    toolCalls.push({ name, args, id: nextCallId(toolCalls.length) })
  }

  return { content, toolCalls, recovered: toolCalls.length > 0 }
}

/** True when text is empty or essentially only DSML markup (no real prose outside the block). */
export function isDsmlOnlyOrEmpty(text: string): boolean {
  const t = text.trim()
  if (!t) return true
  OPEN_TOOL_CALLS.lastIndex = 0
  if (OPEN_TOOL_CALLS.test(t)) {
    OPEN_TOOL_CALLS.lastIndex = 0
    // Prose is only content outside the tool_calls block (parameter bodies are not prose).
    const parsed = parseDsmlToolCalls(t)
    return parsed.content.trim().length < 20
  }
  ANY_DSML_TAG.lastIndex = 0
  if (!ANY_DSML_TAG.test(t)) return false
  ANY_DSML_TAG.lastIndex = 0
  const stripped = t.replace(ANY_DSML_TAG, '').replace(/\s+/g, ' ').trim()
  return stripped.length < 20
}
