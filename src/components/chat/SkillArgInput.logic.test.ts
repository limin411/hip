import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'
import { extractPlaceholders, extractSkillInvocation } from './SkillArgInput'

const sampleFormatDir = path.resolve(import.meta.dirname, '../../../e2e/fixtures/sample-plugin/skills/sample-format')

function readSampleFormat() {
  const raw = readFileSync(path.join(sampleFormatDir, 'SKILL.md'), 'utf8')
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const frontmatter = frontmatterMatch ? frontmatterMatch[1] : ''
  const body = frontmatterMatch ? frontmatterMatch[2].trim() : raw.trim()

  const args: Array<{ name: string; description: string; required?: boolean }> = []
  const argRe = /^\s+- name:\s*(.+)\n\s+description:\s*(.+)$/gm
  let match: RegExpExecArray | null
  while ((match = argRe.exec(frontmatter)) !== null) {
    args.push({ name: match[1].trim(), description: match[2].trim() })
  }

  return { body, args }
}

describe('extractSkillInvocation', () => {
  it('returns null for normal chat text', () => {
    expect(extractSkillInvocation('Hello world')).toBeNull()
    expect(extractSkillInvocation('Just talking')).toBeNull()
    expect(extractSkillInvocation('')).toBeNull()
  })

  it('detects /skill-name at start with no args', () => {
    const result = extractSkillInvocation('/my-skill')
    expect(result).toEqual({ skillName: 'my-skill', argsText: '' })
  })

  it('detects /skill-name with arguments', () => {
    const result = extractSkillInvocation('/fmt src/index.ts prettier')
    expect(result).toEqual({ skillName: 'fmt', argsText: 'src/index.ts prettier' })
  })

  it('works with hyphens and underscores in skill name', () => {
    const result = extractSkillInvocation('/my-tool_format test args')
    expect(result).toEqual({ skillName: 'my-tool_format', argsText: 'test args' })
  })

  it('does not match / in the middle of text', () => {
    expect(extractSkillInvocation('text /my-skill')).toBeNull()
  })
})

describe('extractPlaceholders', () => {
  it('extracts $0 and $1 positional placeholders', () => {
    const result = extractPlaceholders('Format $0 with $1')
    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ raw: '$0', type: 'positional' })
    expect(result[1]).toMatchObject({ raw: '$1', type: 'positional' })
  })

  it('extracts $ARGUMENTS placeholder', () => {
    const result = extractPlaceholders('Args: $ARGUMENTS here')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ raw: '$ARGUMENTS', type: 'arguments' })
  })

  it('extracts named placeholders from skillArgs referenced in body', () => {
    const skillArgs = [
      { name: 'file', description: 'Target file path' },
      { name: 'style', description: 'Style format' },
    ]
    const result = extractPlaceholders('Process $file using $style', skillArgs)
    expect(result).toHaveLength(2)
    const fileArg = result.find((p) => p.raw === '$file')
    expect(fileArg).toMatchObject({ type: 'named', hint: 'Target file path' })
    const styleArg = result.find((p) => p.raw === '$style')
    expect(styleArg).toMatchObject({ type: 'named', hint: 'Style format' })
  })

  it('marks required named arguments', () => {
    const skillArgs = [
      { name: 'file', description: 'Target file', required: true },
    ]
    const result = extractPlaceholders('Open $file', skillArgs)
    expect(result).toHaveLength(1)
    expect(result[0].hint).toContain('(required)')
    expect(result[0].hint).toContain('Target file')
  })

  it('only includes named args that appear in the body', () => {
    const skillArgs = [
      { name: 'file', description: 'File path' },
      { name: 'mode', description: 'Operation mode' },
    ]
    // Only $file appears in body
    const result = extractPlaceholders('Work on $file', skillArgs)
    expect(result).toHaveLength(1)
    expect(result[0].raw).toBe('$file')
  })

  it('deduplicates repeated placeholders', () => {
    const result = extractPlaceholders('$0 and $0 again')
    expect(result).toHaveLength(1)
    expect(result[0].raw).toBe('$0')
  })

  it('uses skillArgs names for positional hint labels', () => {
    const skillArgs = [
      { name: 'input', description: 'Input file' },
      { name: 'output', description: 'Output file' },
    ]
    const result = extractPlaceholders('Convert $0 to $1', skillArgs)
    expect(result[0].hint).toContain('input')
    expect(result[0].hint).toContain('Input file')
    expect(result[1].hint).toContain('output')
    expect(result[1].hint).toContain('Output file')
  })

  it('handles empty body gracefully', () => {
    const result = extractPlaceholders('')
    expect(result).toHaveLength(0)
  })

  it('handles body with no placeholders', () => {
    const result = extractPlaceholders('Just some instructions without args')
    expect(result).toHaveLength(0)
  })

  it('does not match ${VAR} context variables', () => {
    const result = extractPlaceholders('${HIP_SKILL_DIR} is the dir')
    // ${VAR} is not a positional/named/ARGUMENTS placeholder
    expect(result.find((p) => p.raw === '${HIP_SKILL_DIR}')).toBeUndefined()
  })
})

describe('fixture sample-format skill placeholders', () => {
  it('extracts $file and $style named hints from sample-format body', () => {
    const { body, args } = readSampleFormat()
    const result = extractPlaceholders(body, args)
    const file = result.find((p) => p.raw === '$file')
    const style = result.find((p) => p.raw === '$style')
    expect(file).toMatchObject({ type: 'named', hint: 'Target file path' })
    expect(style).toMatchObject({ type: 'named', hint: 'Formatting style' })
  })

  it('extracts $ARGUMENTS hint from sample-format body', () => {
    const { body, args } = readSampleFormat()
    const result = extractPlaceholders(body, args)
    const argsPlaceholder = result.find((p) => p.raw === '$ARGUMENTS')
    expect(argsPlaceholder).toMatchObject({
      type: 'arguments',
      hint: 'Full arguments string (space-separated)',
    })
  })
})
