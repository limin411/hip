import * as path from 'node:path'
import { tool } from '@langchain/core/tools'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import type { SkillMeta } from '@hip/protocol'
import { readSkillBody, listSkillFiles } from '../skills/registry.js'
import { resolveDynamicContext } from '../skills/dynamic-context.js'
import { substituteSkillBody } from './helpers.js'

export function buildSkillTools(
  skills: SkillMeta[] | undefined,
  sessionId: string | undefined,
): StructuredToolInterface[] {
  if (!skills || skills.length === 0) return []

  const useSkill = tool(
    async ({ name, arguments: args }) => {
      const s = skills.find((sk) => sk.name === name || sk.id === name)
      if (!s) return `Error: skill not found: ${name}`
      try {
        const rawBody = readSkillBody(s.dir)
        const substituted = substituteSkillBody(rawBody, args, s.arguments, s.dir, sessionId)
        const body = resolveDynamicContext(substituted, s.dir, {
          disabled: s.disableShellExecution,
        })
        const files = listSkillFiles(s.dir)
        const refFiles = files.filter((f) => f.startsWith('references/'))
        const assetFiles = files.filter((f) => f.startsWith('assets/'))
        const otherFiles = files.filter((f) => !f.startsWith('references/') && !f.startsWith('assets/'))
        const refNote = refFiles.length
          ? `\n- references/ (${refFiles.length} file${refFiles.length === 1 ? '' : 's'}): use read_file with the absolute paths below`
          : ''
        const assetNote = assetFiles.length
          ? `\n- assets/ (${assetFiles.length} file${assetFiles.length === 1 ? '' : 's'}): use read_file with the absolute paths below`
          : ''
        const manifestHeader = files.length
          ? `\n\n## Level 3 — Bundled resources (absolute paths)\n` +
            `Files shipped with this skill. These are NOT auto-read: call read_file with the ` +
            `absolute path for any file you need.${refNote}${assetNote}\n` +
            [...refFiles, ...assetFiles, ...otherFiles].map((f) => `- ${path.join(s.dir, f)}`).join('\n')
          : ''
        return `# Skill dir: ${s.dir}\n\n${body}${manifestHeader}`
      } catch (err) {
        return `Error: ${(err as Error).message}`
      }
    },
    {
      name: 'use_skill',
      description:
        'Load a skill into context by `name`. Skills use progressive disclosure: Level 1 (metadata in ' +
        'system prompt) shows name+description; Level 2 (full SKILL.md body, loaded by this tool) provides ' +
        'step-by-step instructions; Level 3 (bundled resources in references/ + assets/) are listed in the ' +
        'returned file manifest as absolute paths — read them with read_file. Call this when a task matches ' +
        'an advertised skill, then follow the loaded instructions. Pass `arguments` to substitute ' +
        '$ARGUMENTS, $0/$1, $name, and context variables.',
      schema: z.object({ name: z.string(), arguments: z.string().optional() }),
    },
  )

  return [useSkill]
}
