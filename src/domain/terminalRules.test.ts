/**
 * terminalRules 规则评估测试（terminal-shared-pty T4）。
 */
import { describe, it, expect } from 'vitest'
import {
  commandRuleDecision,
  matchesCommandRule,
  patternToRegExp,
  PRESET_TERMINAL_RULES,
  rulePatternFromCommand,
  type CommandRule,
} from './terminalRules'

describe('pattern matching', () => {
  it('prefix-matches with * wildcard', () => {
    expect(matchesCommandRule('git status -s', 'git status*')).toBe(true)
    expect(matchesCommandRule('git push --force origin main', 'git push --force*')).toBe(true)
    expect(matchesCommandRule('git status', 'git push*')).toBe(false)
    expect(matchesCommandRule('rm -rf /tmp/x', 'rm -rf*')).toBe(true)
    expect(matchesCommandRule('rm -rf /', 'rm -rf /')).toBe(true)
    expect(matchesCommandRule('anything', '')).toBe(false)
  })

  it('escapes regex metacharacters in patterns', () => {
    expect(matchesCommandRule('dd if=/dev/zero of=/dev/sda bs=1M', 'dd if=*')).toBe(true)
    expect(patternToRegExp('> /dev/sd*').test('> /dev/sda1')).toBe(true)
  })
})

describe('commandRuleDecision (deny > ask > allow)', () => {
  it('preset deny blocks exact root-level rm without any prompt', () => {
    expect(commandRuleDecision('rm -rf /', {})).toBe('deny')
    expect(commandRuleDecision('rm -fr /', {})).toBe('deny')
    // Flag variants / extra args fall back to ask (still never auto-runs).
    expect(commandRuleDecision('rm -rf / --no-preserve-root', {})).toBe('ask')
  })

  it('preset ask flags destructive commands', () => {
    expect(commandRuleDecision('rm -rf /var/lib/docker', {})).toBe('ask')
    expect(commandRuleDecision('git push --force origin main', {})).toBe('ask')
    expect(commandRuleDecision('kill -9 1234', {})).toBe('ask')
    expect(commandRuleDecision('mkfs.ext4 /dev/sdb1', {})).toBe('ask')
    expect(commandRuleDecision('shutdown -h now', {})).toBe('ask')
  })

  it('benign commands match nothing', () => {
    expect(commandRuleDecision('df -h', {})).toBeNull()
    expect(commandRuleDecision('ls -la', {})).toBeNull()
  })

  it('user allow rules upgrade ask → allow', () => {
    const user: CommandRule[] = [{ action: 'allow', pattern: 'git push *' }]
    expect(commandRuleDecision('git push --force origin main', { userRules: user })).toBe('allow')
  })

  it('user deny rules win over preset ask', () => {
    const user: CommandRule[] = [{ action: 'deny', pattern: 'rm -rf*' }]
    expect(commandRuleDecision('rm -rf /var/lib/docker', { userRules: user })).toBe('deny')
  })

  it('preset deny still protects root deletion even with user allow', () => {
    const user: CommandRule[] = [{ action: 'allow', pattern: 'rm -rf *' }]
    expect(commandRuleDecision('rm -rf /', { userRules: user })).toBe('deny')
  })
})

describe('rulePatternFromCommand', () => {
  it('takes the first two tokens plus wildcard', () => {
    expect(rulePatternFromCommand('git push --force origin main')).toBe('git push *')
    expect(rulePatternFromCommand('rm -rf /tmp/x')).toBe('rm -rf *')
    expect(rulePatternFromCommand('df -h')).toBe('df -h *')
  })
})

describe('preset rule sanity', () => {
  it('every preset rule has a non-empty pattern and valid action', () => {
    for (const r of PRESET_TERMINAL_RULES) {
      expect(['allow', 'ask', 'deny']).toContain(r.action)
      expect(r.pattern.trim().length).toBeGreaterThan(0)
    }
  })
})
