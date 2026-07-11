/**
 * Prompt template for `/init` — analyze the workspace and create/update AGENTS.md.
 * Inspired by OpenCode, Kimi Code, and Codex `/init` designs.
 */

const INIT_PROMPT_BODY = `Create or update \`AGENTS.md\` for this repository.

The goal is a compact instruction file that helps future hip (and other coding-agent) sessions avoid mistakes and ramp up quickly. Every line should answer: "Would an agent likely miss this without help?" If not, leave it out.

## How to investigate

Read the highest-value sources first:
- \`README*\`, root manifests, workspace config, lockfiles
- build, test, lint, formatter, typecheck, and codegen config
- CI workflows and pre-commit / task runner config
- existing instruction files (\`AGENTS.md\`, \`CLAUDE.md\`, \`Claude.md\`, \`.hip/AGENTS.md\`, \`.cursor/rules/\`, \`.cursorrules\`, \`.github/copilot-instructions.md\`)
- repo-local agent config if present

If architecture is still unclear after reading config and docs, inspect a small number of representative code files to find the real entrypoints, package boundaries, and execution flow. Prefer reading the files that explain how the system is wired together over random leaf files.

Prefer executable sources of truth over prose. If docs conflict with config or scripts, trust the executable source and only keep what you can verify.

## What to extract

Look for the highest-signal facts for an agent working in this repo:
- exact developer commands, especially non-obvious ones
- how to run a single test, a single package, or a focused verification step
- required command order when it matters (e.g. lint → typecheck → test)
- monorepo or multi-package boundaries, ownership of major directories, and real app/library entrypoints
- framework or toolchain quirks: generated code, migrations, codegen, build artifacts, special env loading, dev servers
- repo-specific style or workflow conventions that differ from defaults
- testing quirks: fixtures, integration test prerequisites, snapshot workflows, required services, flaky or expensive suites
- important constraints from existing instruction files worth preserving

Good \`AGENTS.md\` content is usually hard-earned context that took reading multiple files to infer.

## Writing rules

Include only high-signal, repo-specific guidance such as:
- exact commands and shortcuts the agent would otherwise guess wrong
- architecture notes that are not obvious from filenames
- conventions that differ from language or framework defaults
- setup requirements, environment quirks, and operational gotchas
- pointers to deeper module guides when the repo uses nested \`AGENTS.md\` files

Exclude:
- generic software advice
- long tutorials or exhaustive file trees
- obvious language conventions
- speculative claims or anything you could not verify

When in doubt, omit.

Prefer short sections and bullets. If the repo is simple, keep the file simple. If the repo is large, summarize the few structural facts that actually change how an agent should work.

Write in the natural language mainly used in the project's comments and documentation.

Title the document clearly (e.g. \`# AGENTS.md\` or a short project-oriented heading). Use Markdown headings and actionable bullets.

## Existing files

If \`AGENTS.md\` already exists at the project root, **read it first** and improve it in place rather than rewriting blindly. Preserve verified useful guidance, delete fluff or stale claims, and reconcile with the current codebase. The result should be one coherent, up-to-date file — not an append-only dump.

If the repo already splits guidance (e.g. root \`AGENTS.md\` for general agent rules and \`CLAUDE.md\` for project-specific stack/commands), preserve that split: put behavioral guidelines in \`AGENTS.md\` and keep project stack/commands where they already live, or document the split clearly so agents know which file to trust for what.

If nested package/module \`AGENTS.md\` files already exist, do not flatten them into the root file; keep the root as an orientation layer that points to module guides.

After writing, briefly confirm the path of the file you created or updated.`

/** Build the user message sent when the user runs `/init` (optional free-text focus). */
export function buildInitPrompt(focus?: string): string {
  const extra = focus?.trim()
  if (!extra) return INIT_PROMPT_BODY
  return `${INIT_PROMPT_BODY}

## User-provided focus or constraints (honor these)

${extra}`
}

/** Trailing text after `/init` becomes optional focus, e.g. `/init focus on testing`. */
export function extractInitFocus(value: string): string | undefined {
  const m = value.match(/(?:^|\s)\/init(?:\s+(.*))?$/i)
  const rest = m?.[1]?.trim()
  return rest || undefined
}
