import { useMemo } from 'react'

// ── Pure helpers (testable) ──

/** Placeholder found in a skill body. */
export interface SkillPlaceholder {
  /** The raw placeholder marker: "$0", "$1", "$ARGUMENTS", "$file", etc. */
  raw: string
  /** Human-readable hint derived from the skill's frontmatter arguments list. */
  hint: string
  /** The type of placeholder. */
  type: 'positional' | 'named' | 'arguments' | 'context'
}

/**
 * Extract argument placeholders ($N, $ARGUMENTS, $name) from a SKILL.md body
 * along with hints from the frontmatter `arguments` declarations.
 */
export function extractPlaceholders(
  body: string,
  skillArgs?: Array<{ name: string; description: string; required?: boolean }>,
): SkillPlaceholder[] {
  const seen = new Set<string>()
  const out: SkillPlaceholder[] = []

  // $N positional placeholders
  const positionalRe = /\$(\d+)/g
  let match: RegExpExecArray | null
  while ((match = positionalRe.exec(body)) !== null) {
    const raw = match[0]
    if (seen.has(raw)) continue
    seen.add(raw)
    const idx = Number(match[1])
    const hasName = skillArgs && idx < skillArgs.length
    const label = hasName ? skillArgs[idx].name : `arg ${idx}`
    out.push({
      raw,
      hint: `Positional ${label}: ${hasName ? skillArgs[idx].description : `value for $${idx}`}`,
      type: 'positional',
    })
  }

  // $ARGUMENTS
  if (/\$ARGUMENTS/.test(body) && !seen.has('$ARGUMENTS')) {
    seen.add('$ARGUMENTS')
    out.push({
      raw: '$ARGUMENTS',
      hint: 'Full arguments string (space-separated)',
      type: 'arguments',
    })
  }

  // Named arguments from skillArgs ($file, $style, etc.) — in the body
  if (skillArgs) {
    for (const arg of skillArgs) {
      const re = new RegExp(`\\$${escapeRegex(arg.name)}(?!\\w)`)
      if (re.test(body) && !seen.has(`$${arg.name}`)) {
        seen.add(`$${arg.name}`)
        out.push({
          raw: `$${arg.name}`,
          hint: arg.required
            ? `(required) ${arg.description}`
            : arg.description || arg.name,
          type: 'named',
        })
      }
    }
  }

  return out
}

/** Extract /skill-name from the composer text, if present at the start of a line. */
export function extractSkillInvocation(text: string): { skillName: string; argsText: string } | null {
  const m = text.match(/^\/(\S+)(?:\s+(.*))?$/)
  if (!m) return null
  return { skillName: m[1], argsText: m[2] ?? '' }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ── Component ──

export interface SkillArgInputProps {
  /** Current text in the composer. */
  value: string
  /** The skill's SKILL.md body (frontmatter stripped) for placeholder extraction. */
  skillBody?: string
  /** The skill's declared arguments from frontmatter. */
  skillArgs?: Array<{ name: string; description: string; required?: boolean }>
}

/**
 * Shows argument hints when the user types `/skill-name` in the chat composer.
 * Displays extracted $N and $ARGUMENTS placeholders with human-readable hints
 * derived from the skill's frontmatter.
 *
 * MUST NOT interfere with normal chat input — only activates when value starts
 * with `/skill-name`.
 */
export function SkillArgInput({ value, skillBody, skillArgs }: SkillArgInputProps) {
  const invocation = useMemo(() => extractSkillInvocation(value), [value])
  const placeholders = useMemo(
    () => (skillBody ? extractPlaceholders(skillBody, skillArgs) : []),
    [skillBody, skillArgs],
  )

  if (!invocation || placeholders.length === 0) return null

  return (
    <div className="rounded-lg border border-accent/30 bg-surface-subtle px-3 py-2 text-caption">
      <div className="font-medium text-ink-secondary">
        /{invocation.skillName} arguments:
      </div>
      <ul className="mt-1 space-y-0.5">
        {placeholders.map((p) => (
          <li key={p.raw} className="text-ink-tertiary">
            <code className="rounded bg-accent/10 px-1 py-0.5 text-caption font-mono text-accent">
              {p.raw}
            </code>
            <span className="ml-1.5">{p.hint}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
