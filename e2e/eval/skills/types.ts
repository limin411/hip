// e2e/eval/skills/types.ts
// Skill eval case schema (schemaVersion 1) — routing + behavioral evals.

export type EvalKind = 'execution' | 'dialogue'

export interface SkillEvalCase {
  /** Free-form id of the behavioral eval, unique within the case file. */
  id: string
  /** Prompt given to a headless session for this eval. */
  prompt: string
  /** Optional expected output snippet (grader hint). */
  expected_output?: string
  /** Relative paths the eval may need inside the prepared workspace. */
  files?: string[]
  /** Grading criteria; every expectation must hold for a pass. */
  expectations: string[]
  kind?: EvalKind
}

export interface SkillCase {
  schemaVersion: 1
  /** Skill id the case file targets. */
  skill: string
  /** Routing examples: positive must rank top-1, negative must score 0. */
  trigger: {
    positive: string[]
    negative: string[]
  }
  /** Behavioral evals (paid, longrun-gate). */
  evals?: SkillEvalCase[]
}
