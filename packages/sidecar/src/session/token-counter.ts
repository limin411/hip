import type { BaseMessage } from '@langchain/core/messages'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Provider-aware token counter. Replaces the old chars/3 heuristic in compaction.ts with
 * per-provider exact counting:
 *   - OpenAI family → gpt-tokenizer (BPE, in-process, fast)
 *   - DeepSeek family → @huggingface/transformers with deepseek-ai/deepseek-v3 tokenizer
 *                       (lazy download to ~/.hip/data/tokenizers/, cached after first use)
 *   - Anthropic / Claude + unknown → chars/4 heuristic (Anthropic's API counts asynchronously
 *                                     and adds latency we don't want on the hot path)
 *
 * Per-message overhead: 3 tokens (role marker + separator), added to every message body.
 *
 * Design constraints enforced (per task spec):
 *   - TypeScript strict, no `as any` / `@ts-ignore`
 *   - @huggingface/transformers is OPTIONAL — dynamic-imported; load failure → chars/4 fallback
 *   - Tokenizer download never blocks event loop startup (lazy)
 *   - 30s timeout on remote download → heuristic fallback (no hang)
 *   - Cache invalidated on provider/model-family switch
 */

export type TokenizerStrategy = 'openai-bpe' | 'deepseek-bpe' | 'heuristic'

export interface ActiveModelInfo {
  readonly providerID: string
  readonly modelID: string
}

/** Tokens added per message (role marker + separator). Spec: 3 per message. */
export const PER_MESSAGE_TOKENS = 3

/** Fallback chars-per-token ratio for heuristic counting. Spec: chars/4. */
export const HEURISTIC_CHARS_PER_TOKEN = 4

/** Max wall-clock time to wait for a remote tokenizer download before falling back. */
export const TOKENIZER_LOAD_TIMEOUT_MS = 30_000

/** HuggingFace repo for the DeepSeek tokenizer file (lazy-downloaded on first DeepSeek use). */
export const DEEPSEEK_HF_REPO = 'deepseek-ai/deepseek-v3'

/** Modules this counter can dynamically load. */
export type DynamicModule = 'gpt-tokenizer' | '@huggingface/transformers'

/** Injection seam for tests (mock both libs without touching the real network). */
export type ModuleLoader = (name: DynamicModule) => Promise<unknown>

export interface TokenCounterOpts {
  /** Defaults to ~/.hip/data/tokenizers/. */
  readonly cacheDir?: string
  /** Defaults to dynamic import(). Tests inject fakes. */
  readonly loadModule?: ModuleLoader
  /** Override timeout (ms) for tests using fake timers. */
  readonly loadTimeoutMs?: number
}

// ---- structural types for the dynamically-imported modules ----

interface GptTokenizerModule {
  encode: (text: string) => ArrayLike<number>
}

interface HfTensor {
  readonly size: number
  readonly data: ArrayLike<number>
}

interface HfTokenizerOutput {
  input_ids: HfTensor
}

interface HfTokenizer {
  (text: string): HfTokenizerOutput
}

interface HfTransformersModule {
  env: { cacheDir: string }
  AutoTokenizer: {
    from_pretrained(repo: string, options?: Record<string, unknown>): Promise<HfTokenizer>
  }
}

// ---- helpers ----

/** Flatten a BaseMessage's content (string | content-block array) to a plain string. */
export function textOf(m: BaseMessage): string {
  if (typeof m.content === 'string') return m.content
  if (Array.isArray(m.content)) {
    return m.content
      .map((b) => (typeof b === 'string' ? b : ((b as { text?: string }).text ?? '')))
      .join('')
  }
  return ''
}

/** Pick the counting strategy from provider/model identifiers. Exported for unit tests. */
export function pickStrategy(info: ActiveModelInfo): TokenizerStrategy {
  const provider = info.providerID.toLowerCase()
  const model = info.modelID.toLowerCase()
  if (provider.startsWith('openai') || model.includes('gpt-')) return 'openai-bpe'
  if (provider === 'deepseek' || model.includes('deepseek')) return 'deepseek-bpe'
  // Anthropic / Claude + everything else → heuristic.
  return 'heuristic'
}

function defaultCacheDir(): string {
  return join(homedir(), '.hip', 'data', 'tokenizers')
}

function heuristicBody(text: string): number {
  return Math.ceil(text.length / HEURISTIC_CHARS_PER_TOKEN)
}

// ---- TokenCounter ----

export class TokenCounter {
  private readonly detect: () => ActiveModelInfo
  private readonly cacheDir: string
  private readonly loadModule: ModuleLoader
  private readonly loadTimeoutMs: number
  private gptTokenizer: GptTokenizerModule | null = null
  private deepseekTokenizer: HfTokenizer | null = null
  private deepseekLoad: Promise<HfTokenizer> | null = null
  private lastStrategy: TokenizerStrategy | null = null

  constructor(providerDetection: () => ActiveModelInfo, opts: TokenCounterOpts = {}) {
    this.detect = providerDetection
    this.cacheDir = opts.cacheDir ?? defaultCacheDir()
    this.loadModule = opts.loadModule ?? ((name) => import(name) as Promise<unknown>)
    this.loadTimeoutMs = opts.loadTimeoutMs ?? TOKENIZER_LOAD_TIMEOUT_MS
  }

  /**
   * Count tokens across a batch of messages. Returns 0 for an empty list. Each non-empty
   * message contributes body_tokens + PER_MESSAGE_TOKENS; empty messages contribute only
   * PER_MESSAGE_TOKENS.
   */
  async countMessages(messages: readonly BaseMessage[]): Promise<number> {
    if (messages.length === 0) return 0
    const strategy = pickStrategy(this.detect())
    this.invalidateCacheOnSwitch(strategy)

    let total = 0
    for (const m of messages) {
      const body = await this.countBody(textOf(m), strategy)
      total += body + PER_MESSAGE_TOKENS
    }
    return total
  }

  /** Drop cached tokenizers when the active strategy family changes. */
  private invalidateCacheOnSwitch(strategy: TokenizerStrategy): void {
    if (this.lastStrategy !== null && this.lastStrategy !== strategy) {
      this.gptTokenizer = null
      this.deepseekTokenizer = null
      this.deepseekLoad = null
    }
    this.lastStrategy = strategy
  }

  private async countBody(text: string, strategy: TokenizerStrategy): Promise<number> {
    if (text.length === 0) return 0
    if (strategy === 'openai-bpe') return this.countOpenAI(text)
    if (strategy === 'deepseek-bpe') return this.countDeepSeek(text)
    return heuristicBody(text)
  }

  private async countOpenAI(text: string): Promise<number> {
    try {
      if (!this.gptTokenizer) {
        const mod = (await this.loadModule('gpt-tokenizer')) as GptTokenizerModule
        this.gptTokenizer = mod
      }
      return this.gptTokenizer.encode(text).length
    } catch {
      // Library missing, build stripped it, or encode threw — fall back.
      return heuristicBody(text)
    }
  }

  private async countDeepSeek(text: string): Promise<number> {
    try {
      if (!this.deepseekTokenizer) {
        if (!this.deepseekLoad) this.deepseekLoad = this.loadDeepSeekTokenizer()
        this.deepseekTokenizer = await this.deepseekLoad
      }
      const out = this.deepseekTokenizer(text)
      return out.input_ids.size
    } catch {
      // Download failure, timeout, or runtime error — fall back.
      this.deepseekLoad = null
      this.deepseekTokenizer = null
      return heuristicBody(text)
    }
  }

  private async loadDeepSeekTokenizer(): Promise<HfTokenizer> {
    return this.raceWithTimeout(this.fetchDeepSeekTokenizer(), this.loadTimeoutMs)
  }

  /** Fetch the HF module + tokenizer. Lives on its own so the timeout race wraps BOTH steps
   *  (a hung dynamic import would otherwise never start the timer). */
  private async fetchDeepSeekTokenizer(): Promise<HfTokenizer> {
    const mod = (await this.loadModule('@huggingface/transformers')) as HfTransformersModule
    mod.env.cacheDir = this.cacheDir
    return mod.AutoTokenizer.from_pretrained(DEEPSEEK_HF_REPO, { cache_dir: this.cacheDir })
  }

  private raceWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let handle: ReturnType<typeof setTimeout> | undefined
    const timeoutP = new Promise<never>((_resolve, reject) => {
      handle = setTimeout(() => reject(new Error(`tokenizer load timed out after ${ms}ms`)), ms)
    })
    return Promise.race([p, timeoutP]).finally(() => {
      if (handle) clearTimeout(handle)
    })
  }
}
