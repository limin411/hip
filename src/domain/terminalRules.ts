/**
 * terminal_exec 命令规则评估（terminal-shared-pty T4）。
 *
 * 取代黑名单正则 + window.confirm：allow / ask / deny 三元规则，
 * 前缀匹配 + `*` 通配（Claude Code `Bash(git status:*)` 同语义）。
 * 优先级 deny > ask > allow（命中 deny 直接拒绝，不进 UI）。
 */

export type CommandRuleAction = 'allow' | 'ask' | 'deny'

export interface CommandRule {
  action: CommandRuleAction
  /** Command prefix pattern; `*` matches anything (e.g. `git push --force*`). */
  pattern: string
}

/** `git push --force*` → /^git push --force/  (escaped, `*` → `.*`); no `*` → exact match. */
export function patternToRegExp(pattern: string): RegExp {
  const p = pattern.trim()
  const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return p.includes('*') ? new RegExp(`^${escaped}`) : new RegExp(`^${escaped}$`)
}

/** Prefix match with `*` wildcard; exact match without `*`. Empty pattern never matches. */
export function matchesCommandRule(command: string, pattern: string): boolean {
  const p = pattern.trim()
  if (!p) return false
  return patternToRegExp(p).test(command.trim())
}

/** 预置规则：高风险命令 ask 确认；仅根级不可逆操作 deny（不进 UI）。 */
export const PRESET_TERMINAL_RULES: CommandRule[] = [
  { action: 'deny', pattern: 'rm -rf /' },
  { action: 'deny', pattern: 'rm -fr /' },
  { action: 'ask', pattern: 'rm -rf*' },
  { action: 'ask', pattern: 'rm -fr*' },
  { action: 'ask', pattern: 'git push --force*' },
  { action: 'ask', pattern: 'git push -f*' },
  { action: 'ask', pattern: 'kill -9*' },
  { action: 'ask', pattern: 'killall*' },
  { action: 'ask', pattern: 'chmod -R*' },
  { action: 'ask', pattern: 'mkfs*' },
  { action: 'ask', pattern: 'dd if=*' },
  { action: 'ask', pattern: 'shutdown*' },
  { action: 'ask', pattern: 'reboot*' },
  { action: 'ask', pattern: 'sudo rm*' },
  { action: 'ask', pattern: '> /dev/sd*' },
]

/**
 * 合并预置 + 用户规则。优先级：
 *   preset deny（根删除保护）> user deny > user allow（显式提升）>
 *   ask（预置 + 用户）> 无匹配（null）。
 */
export function commandRuleDecision(
  command: string,
  opts: { userRules?: CommandRule[] },
): CommandRuleAction | null {
  const user = opts.userRules ?? []
  const presetDeny = PRESET_TERMINAL_RULES.filter((r) => r.action === 'deny')
  const presetAsk = PRESET_TERMINAL_RULES.filter((r) => r.action === 'ask')
  for (const r of presetDeny) {
    if (matchesCommandRule(command, r.pattern)) return 'deny'
  }
  for (const r of user) {
    if (r.action === 'deny' && matchesCommandRule(command, r.pattern)) return 'deny'
  }
  for (const r of user) {
    if (r.action === 'allow' && matchesCommandRule(command, r.pattern)) return 'allow'
  }
  for (const r of [...presetAsk, ...user]) {
    if (r.action === 'ask' && matchesCommandRule(command, r.pattern)) return 'ask'
  }
  return null
}

/** 从命令生成"总是允许/拒绝"规则 pattern：前两个词 + `*`（`git push --force origin` → `git push *`）。 */
export function rulePatternFromCommand(command: string): string {
  const tokens = command.trim().split(/\s+/)
  const base = tokens.slice(0, 2).join(' ')
  return base ? `${base} *` : `${tokens[0] ?? ''} *`
}
