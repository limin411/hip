export {
  memoryConfigPath,
  loadMemoryConfig,
  saveMemoryConfig,
  mergeMemoryConfig,
  resolveSessionMemoryFlags,
  type SessionMemoryFlagsInput,
  type ResolvedSessionMemoryFlags,
} from './config.js'
export { redactSecrets } from './redact.js'
export { scanMemoryContent } from './threat-scan.js'
export { getMemoryCoreBudget, getMemoryPrefetchBudget } from './budget.js'
export { resolveProjectKey } from './project-key.js'
export {
  MemoryService,
  type MemoryUpsertInput,
  type MemoryImportConflict,
  type MemoryInjectBlock,
  type MemoryEmbeddingClientFactory,
  type MemoryIndexStatus,
  type MemoryReindexResult,
} from './service.js'
export {
  createOpenAICompatibleEmbeddingClient,
  embeddingModelKey,
  truncateForEmbed,
  type MemoryEmbeddingClient,
} from './embedding-client.js'
export {
  encodeEmbedding,
  decodeEmbedding,
  upsertEmbedding,
  getEmbedding,
  deleteEmbedding,
  deleteEmbeddings,
  embeddingIndexStatus,
  ensureVec0Table,
  memoryVecTableName,
} from './vec.js'
export {
  cosine,
  hybridScore,
  searchHybrid,
  maybeRerank,
  DEFAULT_HYBRID_WEIGHTS,
  type HybridWeights,
  type SearchHybridOpts,
} from './hybrid-search.js'
export { buildMemoryTools } from './tools.js'
export {
  MemoryInjector,
  refreshMemoryCoreSnapshot,
  type RefreshMemoryCoreSnapshotArgs,
  type RefreshMemoryCoreSnapshotResult,
} from './inject.js'
export {
  MemoryStore,
  type MemoryListFilter,
  type MemorySearchOpts,
  type MemorySearchInScopesOpts,
  type MemoryStage1Row,
  type MemoryStage1ListFilter,
  type MemorySummaryRow,
} from './store.js'
export { parseMemoryCitations, bumpMemoryUseCounts } from './citations.js'
export {
  createDefaultMemoryLlmClient,
  parseJsonFromLlmText,
  resolveMemoryExtractModel,
  type MemoryLlmClient,
  type MemoryLlmCompleteOpts,
} from './llm-client.js'
export {
  PHASE1_SYSTEM_PROMPT,
  PHASE2_SYSTEM_PROMPT,
  buildPhase1UserPrompt,
  buildPhase2UserPrompt,
  type Stage1LlmOutput,
  type Phase2LlmItem,
  type Phase2LlmOutput,
  type Phase2PromptInput,
} from './pipeline/prompts.js'
export {
  buildPhase1Transcript,
  transcriptMeetsMinContent,
  shouldIncludeAssistantInPhase1,
  countUserContent,
  PHASE1_INPUT_MAX_CHARS,
} from './pipeline/transcript.js'
export {
  runPhase1Extract,
  type Phase1ExtractResult,
  type Phase1ExtractStatus,
  type RunPhase1ExtractOpts,
  type SessionMessagesLoader,
} from './pipeline/phase1-extract.js'
export {
  runPhase2Consolidate,
  applyPhase2PostPass,
  parsePhase2LlmOutput,
  normalizeSummaryMd,
  simpleExtractFromStage1,
  PHASE2_MAX_STAGE1_DEFAULT,
  PHASE2_NEW_EXTRACT_CONFIDENCE_CAP,
  type Phase2ConsolidateResult,
  type Phase2ConsolidateStatus,
  type RunPhase2ConsolidateOpts,
  type Phase2PostPassItem,
  type Phase2PostPassResult,
} from './pipeline/phase2-consolidate.js'
export {
  runDecayJob,
  applyDecayStep,
  isDecayCandidate,
  itemUnusedAgeMs,
  type DecayJobResult,
} from './pipeline/evolution.js'
export { runTrashRetentionJob } from './trash.js'
export {
  writeMemoryMirror,
  atomicWriteFile,
  formatMemoryMirrorMarkdown,
  memoriesRootDir,
  globalMemoryMirrorPath,
  projectMemoryMirrorPath,
  type WriteMemoryMirrorOpts,
} from './mirror.js'
export {
  enqueuePhase1,
  processQueue,
  scheduleMemoryExtractAfterTurn,
  maybeEnqueueMemoryExtract,
  resetPhase1Queue,
  setPhase1QueueConcurrency,
  setLastExtractSuccessAt,
  assertUnderDailyExtractLimit,
  recordExtractSuccess,
  type Phase1QueueJob,
} from './pipeline/queue.js'
