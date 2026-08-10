// packages/sidecar/src/session/skills/router.ts
// Skill routing evaluation primitives: pure, dependency-free text similarity
// over skill name+description. Used by the free routing regression
// (e2e/eval/skills/router.eval.test.ts) to guard "the right skill surfaces for
// the right task" — and by collision checks that keep skill descriptions
// distinguishable. Kept in the sidecar so the eval tests the real product
// surface (skillsBlock listing), not a test-only copy.
//
// Known limitation (documented, by design): similarity is lexical, so a query
// in language X only matches descriptions in language X. Builtin hip skills
// describe themselves in English; cross-language routing is the model's job
// (description-based use_skill selection), not this guard's.

// ── Tokenization ─────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is',
  'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these',
  'those', 'as', 'at', 'by', 'from', 'up', 'down', 'out', 'into', 'your',
  'you', 'we', 'our', 'i', 'my', 'me', 'do', 'does', 'did', 'not', 'no', 'yes',
  'when', 'what', 'which', 'who', 'how', 'use', 'using', 'used', 'can', 'could',
  'should', 'would', 'will', 'may', 'might', 'if', 'then', 'than', 'so', 'also',
  'very', 'just', 'about', 'over', 'under', 'more', 'most', 'some', 'any', 'all',
  'each', 'every', 'other', 'such', 'only', 'own', 'same', 'too', 'make',
])

const CJK_RE = /[\u4e00-\u9fff]+/g
const LATIN_RE = /[a-z0-9][a-z0-9_-]*/g

/**
 * Tokenize mixed EN/CJK text: latin words (lowercased, stopwords dropped) plus
 * 2-char sliding bigrams over CJK runs (bigrams keep CJK phrases selective).
 */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const out: string[] = []

  for (const m of lower.match(LATIN_RE) ?? []) {
    if (!STOPWORDS.has(m)) out.push(m)
  }
  for (const run of lower.match(CJK_RE) ?? []) {
    if (run.length === 1) {
      out.push(run)
    } else {
      for (let i = 0; i + 1 < run.length; i++) out.push(run.slice(i, i + 2))
    }
  }
  return out
}

/** Term-frequency vector for a text (l2-normed, so cosine = dot product). */
function tfVector(text: string): Map<string, number> {
  const vec = new Map<string, number>()
  for (const t of tokenize(text)) vec.set(t, (vec.get(t) ?? 0) + 1)
  // l2 normalize
  let normSq = 0
  for (const n of vec.values()) normSq += n * n
  const norm = Math.sqrt(normSq) || 1
  for (const [k, n] of vec) vec.set(k, n / norm)
  return vec
}

/** Cosine similarity between two texts (0..1). Equal texts → 1; disjoint → 0. */
export function textSimilarity(a: string, b: string): number {
  const va = tfVector(a)
  const vb = tfVector(b)
  let dot = 0
  for (const [k, n] of va) {
    const m = vb.get(k)
    if (m !== undefined) dot += n * m
  }
  return dot
}

// ── Ranking ──────────────────────────────────────────────────────────────────

export interface RankedSkill {
  /** Skill id (or any stable identifier supplied by the caller). */
  id: string
  /** Matching score, 0..1. */
  score: number
}

export interface RankableSkill {
  id: string
  name: string
  description: string
}

/**
 * Rank skills against a task query by name+description similarity.
 * Returns the top `topK` skills, best first. Deterministic: ties break
 * alphabetically by id.
 */
export function rankSkills(
  query: string,
  skills: RankableSkill[],
  topK = 3,
): RankedSkill[] {
  const scored = skills
    .map((s) => ({ id: s.id, score: textSimilarity(query, `${s.name} ${s.description}`) }))
    .sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id))
  return scored.slice(0, topK)
}

// ── Collision detection ──────────────────────────────────────────────────────

export interface SkillCollision {
  a: string
  b: string
  score: number
}

/**
 * Detect pairwise description collisions. Two skills whose combined
 * name+description similarity is >= threshold are reported; identical skill
 * pairs (same id) are ignored. Used as a CI guard so new skills cannot blur
 * routing.
 */
export function findSkillCollisions(
  skills: RankableSkill[],
  threshold = 0.75,
): SkillCollision[] {
  const out: SkillCollision[] = []
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const a = skills[i]
      const b = skills[j]
      if (a.id === b.id) continue
      const score = textSimilarity(`${a.name} ${a.description}`, `${b.name} ${b.description}`)
      // epsilon: floating-point cosine can land just below the threshold (e.g. 0.7499999…)
      if (score >= threshold - 1e-9) out.push({ a: a.id, b: b.id, score })
    }
  }
  return out.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
}
