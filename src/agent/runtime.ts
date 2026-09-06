import { createHash, randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { UIMessage, UIMessageChunk } from 'ai'
import { loadDatasetFromFile, normalizeDataset, type NormalizeOptions } from '../ingestion/normalize.js'
import type { RelinkScope } from '../contracts/index.js'
import {
  AgentService,
  type AgentDataSource,
  type AgentMode,
  type AgentModelConfig,
  type AgentProgress,
  type AgentRunOptions,
  type AgentScope,
} from './services/agentModelLedService.js'
import {
  DatasetProvider,
  getRelinkDataProvider,
  runWithRelinkDataProvider,
  type DatasetLike,
  type RelinkDataProvider,
} from './services/dataProvider.js'
import { runWithAgentRuntimeContext } from './services/agentRuntimeContext.js'
import type { AgentRunSnapshot } from './services/agentRunStore.js'
import {
  synthesizeAgentMemoryFromConversation,
  synthesizeAgentMemoryFromFeedback,
  reviseAgentMemorySummary,
  refreshAgentMemorySummary,
  type AgentMemoryConversationExchange,
  type AgentMemorySynthesisResult,
} from './services/agentMemorySynthesisService.js'
import {
  AgentFeedbackStore,
  type AgentAnswerFeedback,
  type AgentFeedbackMemoryEvidence,
  type AgentFeedbackSummary,
} from './services/agentFeedbackStore.js'
import { generateAgentTitle, type AgentTitleResult } from './services/agentTitleService.js'

export type RelinkRuntimeOptions = {
  dataset?: unknown
  datasetFile?: string
  normalize?: NormalizeOptions
  dataProvider?: RelinkDataProvider
  modelConfig?: AgentModelConfig
  dataDir?: string
  cacheEncryptionSecret?: string
  /** Stable tenant/user fingerprint used to isolate resumable runs and raw-page caches. */
  ownerFingerprint?: string
  sourceFingerprint?: string
  /** Automatically consolidate stable user preferences after a completed run. */
  memorySynthesis?: boolean
}

export type AgentMessageInput = UIMessage | {
  id?: string
  role: 'user' | 'assistant' | 'system'
  content?: string
  parts?: Array<Record<string, unknown>>
  [key: string]: unknown
}

export type RelinkRunInput = {
  prompt?: string
  question?: string
  messages?: AgentMessageInput[]
  scope?: AgentScope | RelinkScope
  mode?: AgentMode
  modelConfig?: AgentModelConfig
  runId?: string
  resumeFromRunId?: string
  conversationId?: number | null
  debugLogEnabled?: boolean
  memorySynthesis?: boolean
  runtimeDataContext?: AgentRunOptions['runtimeDataContext']
  signal?: AbortSignal
  onChunk?: (chunk: UIMessageChunk | '[DONE]') => void
  onProgress?: (progress: AgentProgress) => void
}

export type RelinkRunResult = {
  runId: string
  answer: string
  chunks: Array<UIMessageChunk | '[DONE]'>
  progress: AgentProgress[]
  state: AgentRunSnapshot | null
  memory?: AgentMemorySynthesisResult
}

export type RelinkStreamEvent =
  | { type: 'chunk'; chunk: UIMessageChunk | '[DONE]' }
  | { type: 'progress'; progress: AgentProgress }
  | { type: 'result'; result: RelinkRunResult }
  | { type: 'error'; error: string }

function hasInteractions(value: unknown): value is DatasetLike & { interactions: unknown[] } {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as { interactions?: unknown }).interactions))
}

function asDataset(value: unknown, normalizeOptions?: NormalizeOptions): DatasetLike {
  if (hasInteractions(value)) {
    const record = value as DatasetLike
    if (Array.isArray(record.entities) && record.entities.every((entity) => entity && typeof entity.id === 'string')) return record
  }
  return normalizeDataset(value || [], normalizeOptions)
}

function messageText(message: AgentMessageInput): string {
  const record = message as Record<string, unknown>
  if (typeof record.content === 'string') return record.content
  if (!Array.isArray(record.parts)) return ''
  return record.parts.map((part) => {
    if (!part || typeof part !== 'object') return ''
    const value = part as Record<string, unknown>
    return typeof value.text === 'string' ? value.text : typeof value.content === 'string' ? value.content : ''
  }).join('')
}

function toUiMessage(message: AgentMessageInput, index: number): UIMessage {
  const record = message as Record<string, unknown>
  const role = message.role === 'assistant' || message.role === 'system' ? message.role : 'user'
  const parts = Array.isArray(message.parts) && message.parts.length
    ? message.parts
    : [{ type: 'text', text: messageText(message) }]
  return {
    ...record,
    id: typeof message.id === 'string' && message.id ? message.id : `message-${index + 1}-${randomUUID()}`,
    role,
    parts,
  } as UIMessage
}

function textFromChunks(chunks: Array<UIMessageChunk | '[DONE]'>): string {
  return chunks.map((chunk) => {
    if (chunk === '[DONE]' || !chunk || typeof chunk !== 'object') return ''
    const record = chunk as Record<string, unknown>
    return record.type === 'text-delta' && typeof record.delta === 'string' ? record.delta : ''
  }).join('')
}

function stableFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('base64url')
}

function envModelConfig(): AgentModelConfig {
  const protocol = String(process.env.RELINK_MODEL_PROTOCOL || '').trim() as AgentModelConfig['protocol']
  const provider = process.env.RELINK_MODEL_PROVIDER || 'openai-compatible'
  return {
    provider,
    apiKey: process.env.RELINK_MODEL_API_KEY || '',
    model: process.env.RELINK_MODEL || '',
    baseURL: process.env.RELINK_MODEL_BASE_URL || '',
    ...(protocol ? { protocol } : {}),
    ...(process.env.RELINK_MODEL_REASONING_EFFORT ? { reasoningEffort: process.env.RELINK_MODEL_REASONING_EFFORT as AgentModelConfig['reasoningEffort'] } : {}),
    ...(process.env.RELINK_MODEL_CONTEXT_WINDOW ? { contextWindow: Number(process.env.RELINK_MODEL_CONTEXT_WINDOW) } : {}),
    ...(process.env.RELINK_MODEL_MAX_OUTPUT_TOKENS ? { maxOutputTokens: Number(process.env.RELINK_MODEL_MAX_OUTPUT_TOKENS) } : {}),
  }
}

function normalizeScope(scope: AgentScope | RelinkScope | undefined, provider: RelinkDataProvider): AgentScope {
  if (scope && 'kind' in scope && (scope.kind === 'global' || scope.kind === 'session')) return scope as AgentScope
  const pairScope = scope as RelinkScope | undefined
  const entityIds = Array.from(new Set([
    ...(pairScope?.entityIds || []),
    ...(pairScope?.entityA ? [pairScope.entityA] : []),
    ...(pairScope?.entityB ? [pairScope.entityB] : []),
  ].map(String).filter(Boolean)))
  const sessions = provider.findSessionsForEntities?.(entityIds) || (provider.findSessionForEntities?.(entityIds) ? [provider.findSessionForEntities(entityIds) as string] : [])
  const dateRange = (pairScope as RelinkScope & { dateRange?: { from?: string; to?: string } } | undefined)?.dateRange
  const filters = {
    ...(sessions.length ? { targetSessions: sessions.map((sessionId) => ({ sessionId, displayName: entityIds.join(' + ') })) } : {}),
    ...(dateRange?.from ? { startDate: dateRange.from } : {}),
    ...(dateRange?.to ? { endDate: dateRange.to } : {}),
  }
  return { kind: 'global', ...(Object.keys(filters).length ? { filters } : {}) }
}

/**
 * The single public runtime used by the SDK, HTTP API, CLI and MCP adapters.
 * It owns no source-specific logic: all source access is routed through the
 * injected RelinkDataProvider before entering the AgentService.
 */
export class RelinkRuntime {
  private readonly service: AgentService
  readonly dataDir: string
  private provider: RelinkDataProvider
  private dataset?: DatasetLike
  private readonly modelConfig: AgentModelConfig
  private readonly cacheEncryptionSecret?: string
  private readonly ownerFingerprint?: string
  private readonly sourceFingerprint?: string
  private readonly memorySynthesis: boolean
  private readonly controllers = new Map<string, AbortController>()
  private readonly contextualConversations: AgentService['conversations']
  private readonly contextualMemories: AgentService['memories']
  readonly feedback: AgentFeedbackStore

  constructor(options: RelinkRuntimeOptions = {}) {
    this.dataDir = resolve(options.dataDir || process.env.RELINK_DATA_DIR || resolve(process.cwd(), '.relink'))
    this.modelConfig = options.modelConfig || envModelConfig()
    this.cacheEncryptionSecret = options.cacheEncryptionSecret
    this.ownerFingerprint = options.ownerFingerprint
    this.sourceFingerprint = options.sourceFingerprint
    this.memorySynthesis = options.memorySynthesis !== false
    if (options.dataProvider) {
      this.provider = options.dataProvider
    } else {
      this.dataset = options.datasetFile
        ? loadDatasetFromFile(resolve(options.datasetFile), options.normalize)
        : asDataset(options.dataset === undefined ? [] : options.dataset, options.normalize)
      this.provider = new DatasetProvider(this.dataset)
    }
    this.service = new AgentService()
    this.feedback = new AgentFeedbackStore(this.dataDir)
    this.contextualConversations = this.contextualStore(this.service.conversations)
    this.contextualMemories = this.contextualStore(this.service.memories)
  }

  private withRuntimeContext<T>(operation: () => T | Promise<T>): T | Promise<T> {
    return runWithAgentRuntimeContext(
      { provider: this.provider, dataDir: this.dataDir },
      () => runWithRelinkDataProvider(this.provider, operation),
    )
  }

  private contextualStore<T extends object>(store: T): T {
    return new Proxy(store, {
      get: (target, property) => {
        const value = Reflect.get(target, property, target)
        if (typeof value !== 'function') return value
        return (...args: unknown[]) => this.withRuntimeContext(() => Reflect.apply(value, target, args))
      },
    })
  }

  get dataProvider(): RelinkDataProvider {
    return this.provider
  }

  setDataProvider(provider: RelinkDataProvider): void {
    this.provider = provider
    this.dataset = undefined
  }

  setDataset(value: unknown, normalizeOptions?: NormalizeOptions): DatasetLike {
    const dataset = asDataset(value, normalizeOptions)
    this.dataset = dataset
    this.provider = new DatasetProvider(dataset)
    return dataset
  }

  async getDataset(): Promise<DatasetLike | undefined> {
    return await this.withRuntimeContext(async () => {
      const value = await this.provider.getDataset?.()
      return value || this.dataset
    })
  }

  async getDatasetSummary(): Promise<Record<string, unknown>> {
    return await this.withRuntimeContext(async () => {
      if (this.provider.getDatasetSummary) return await this.provider.getDatasetSummary()
      const dataset = await this.provider.getDataset?.() || this.dataset
      const interactions = dataset?.interactions || []
      return { id: dataset?.id, name: dataset?.name, entityCount: dataset?.entities?.length || 0, interactionCount: interactions.length }
    })
  }

  async listSessions(): Promise<unknown> {
    return await this.withRuntimeContext(() => this.provider.getSessions())
  }

  async search(query: { text?: string; sessionId?: string; limit?: number; offset?: number; from?: string; to?: string }): Promise<unknown> {
    return await this.withRuntimeContext(() => {
      const begin = query.from ? Math.floor(Date.parse(query.from) / 1_000) : 0
      const end = query.to ? Math.floor(Date.parse(query.to) / 1_000) : 0
      return this.provider.searchMessages(String(query.text || ''), query.sessionId, query.limit || 50, query.offset || 0, begin, end)
    })
  }

  private inputMessages(input: RelinkRunInput): UIMessage[] {
    const messages = (input.messages || []).map(toUiMessage)
    const prompt = String(input.prompt || input.question || '').trim()
    if (prompt) messages.push(toUiMessage({ role: 'user', content: prompt }, messages.length))
    return messages
  }

  async run(input: RelinkRunInput): Promise<RelinkRunResult> {
    const messages = this.inputMessages(input)
    if (!messages.length || !messages.some((message) => message.role === 'user' && messageText(message as AgentMessageInput).trim())) throw new Error('需要提供 prompt、question 或 user messages')
    const runId = input.runId || randomUUID()
    if (this.controllers.has(runId)) throw new Error(`runId 正在运行：${runId}`)
    const controller = new AbortController()
    const forwardAbort = () => controller.abort(input.signal?.reason)
    if (input.signal) {
      if (input.signal.aborted) controller.abort(input.signal.reason)
      else input.signal.addEventListener('abort', forwardAbort, { once: true })
    }
    this.controllers.set(runId, controller)
    try {
      const chunks: Array<UIMessageChunk | '[DONE]'> = []
      const progress: AgentProgress[] = []
      let doneChunkPending = false
      const dataset = await this.getDataset()
      const runtimeDataContext = {
        ...(input.runtimeDataContext || {}),
        ...(this.cacheEncryptionSecret ? { cacheEncryptionSecret: this.cacheEncryptionSecret } : {}),
        ...(this.ownerFingerprint ? { ownerFingerprint: this.ownerFingerprint } : {}),
        ...(this.sourceFingerprint ? { sourceFingerprint: this.sourceFingerprint } : {}),
        ...(dataset ? { datasetFingerprint: stableFingerprint(dataset) } : {}),
      }
      const scope = normalizeScope(input.scope, this.provider)
      const onChunk = (chunk: UIMessageChunk | '[DONE]') => {
        if (chunk === '[DONE]') {
          doneChunkPending = true
          return
        }
        chunks.push(chunk)
        input.onChunk?.(chunk)
      }
      const onProgress = (event: AgentProgress) => {
        progress.push(event)
        input.onProgress?.(event)
      }
      const options: AgentRunOptions = {
        runId,
        resumeFromRunId: input.resumeFromRunId,
        conversationId: input.conversationId,
        messages,
        scope,
        mode: input.mode || 'deep-research',
        modelConfig: input.modelConfig || this.modelConfig,
        debugLogEnabled: input.debugLogEnabled,
        runtimeDataContext,
        dataProvider: this.provider,
        signal: controller.signal,
        onChunk,
        onProgress,
      }
      let memory: AgentMemorySynthesisResult | undefined
      await this.withRuntimeContext(async () => {
        await this.service.run(options)
        const state = this.service.loadRunState(runId, true)
        const shouldSynthesize = (input.memorySynthesis ?? this.memorySynthesis)
          && state?.status === 'completed'
          && Boolean(state.finalAnswer)
        if (shouldSynthesize) {
          onProgress({
            stage: 'finalizing',
            title: '正在整理可复用记忆',
            detail: '仅提取跨对话稳定的偏好和工作方式，不保存本次关系事实',
            category: 'memory',
            visible: false,
            at: Date.now(),
          })
          try {
            memory = await synthesizeAgentMemoryFromConversation({
              messages,
              assistantAnswer: state.finalAnswer,
              occurredAt: Number(state.finishedAt || state.updatedAt || Date.now()),
              modelConfig: input.modelConfig || this.modelConfig,
              turnId: runId,
              recentExchanges: this.recentMemoryExchanges(runId),
            })
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error || '记忆更新失败')
            let summary: AgentMemorySynthesisResult['summary']
            try { summary = this.service.memories.recordReviewFailure(message) } catch { /* 主回答已经完成，记忆磁盘错误不能覆盖它。 */ }
            memory = { success: false, error: message, ...(summary ? { summary } : {}) }
          }
        }
      })
      const state = await this.withRuntimeContext(() => this.service.loadRunState(runId, true))
      if (doneChunkPending) {
        chunks.push('[DONE]')
        input.onChunk?.('[DONE]')
      }
      return { runId, answer: state?.finalAnswer || textFromChunks(chunks), chunks, progress, state, ...(memory ? { memory } : {}) }
    } finally {
      input.signal?.removeEventListener('abort', forwardAbort)
      this.controllers.delete(runId)
    }
  }

  private recentMemoryExchanges(excludeRunId: string, limit = 12): AgentMemoryConversationExchange[] {
    return this.service.listRecentRunSnapshots(Math.max(limit * 2, 24))
      .filter((run) => run.runId !== excludeRunId && run.status === 'completed' && run.outcome === 'answered')
      .filter((run) => Boolean(run.question && run.finalAnswer))
      .sort((left, right) => Number(left.finishedAt || left.updatedAt || 0) - Number(right.finishedAt || right.updatedAt || 0))
      .slice(-limit)
      .map((run) => ({
        turnId: run.runId,
        occurredAt: Number(run.finishedAt || run.updatedAt || 0) || undefined,
        userText: run.question,
        assistantText: run.finalAnswer as string,
      }))
  }

  /** Compatibility spelling for integrations that called the first SDK draft. */
  async analyze(input: RelinkRunInput & Record<string, unknown> = {}): Promise<RelinkRunResult> {
    return this.run(input)
  }

  async *stream(input: RelinkRunInput): AsyncGenerator<RelinkStreamEvent> {
    const queue: RelinkStreamEvent[] = []
    let waiting: ((result: IteratorResult<RelinkStreamEvent>) => void) | undefined
    let settled = false
    const push = (event: RelinkStreamEvent) => {
      if (waiting) {
        const resolveNext = waiting
        waiting = undefined
        resolveNext({ value: event, done: false })
      } else queue.push(event)
    }
    const runPromise = this.run({
      ...input,
      onChunk: (chunk) => { push({ type: 'chunk', chunk }); input.onChunk?.(chunk) },
      onProgress: (progress) => { push({ type: 'progress', progress }); input.onProgress?.(progress) },
    }).then((result) => push({ type: 'result', result })).catch((error: unknown) => push({ type: 'error', error: error instanceof Error ? error.message : String(error) })).finally(() => { settled = true; if (waiting && !queue.length) waiting({ value: undefined as never, done: true }) })
    void runPromise
    while (!settled || queue.length) {
      if (queue.length) {
        yield queue.shift() as RelinkStreamEvent
        continue
      }
      const next = await new Promise<IteratorResult<RelinkStreamEvent>>((resolveNext) => { waiting = resolveNext })
      if (next.done) break
      yield next.value
    }
  }

  abort(runId: string, reason = '用户已停止'): boolean {
    const controller = this.controllers.get(runId)
    controller?.abort(new Error(reason))
    const persisted = this.withRuntimeContext(() => this.service.failIncompleteRun(runId, new Error(reason), true)) as boolean
    return persisted || Boolean(controller)
  }

  listRuns(limit = 100): ReturnType<AgentService['listRunStates']> {
    return this.withRuntimeContext(() => this.service.listRunStates(limit)) as ReturnType<AgentService['listRunStates']>
  }

  loadRun(runId: string): AgentRunSnapshot | null {
    return this.withRuntimeContext(() => this.service.loadRunState(runId, true)) as AgentRunSnapshot | null
  }

  async replay(runId: string, modelConfig?: AgentModelConfig): Promise<Awaited<ReturnType<AgentService['replayRunAnswer']>>> {
    return await this.withRuntimeContext(() => this.service.replayRunAnswer(runId, modelConfig || this.modelConfig))
  }

  async generateTitle(conversationText: string, modelConfig?: AgentModelConfig): Promise<AgentTitleResult> {
    return await this.withRuntimeContext(() => generateAgentTitle(conversationText, modelConfig || this.modelConfig))
  }

  listConversations(scope?: AgentScope): ReturnType<AgentService['conversations']['list']> {
    return this.withRuntimeContext(() => this.service.conversations.list(scope)) as ReturnType<AgentService['conversations']['list']>
  }

  loadConversation(id: number): ReturnType<AgentService['conversations']['load']> {
    return this.withRuntimeContext(() => this.service.conversations.load(Number(id))) as ReturnType<AgentService['conversations']['load']>
  }

  createConversation(payload: Record<string, unknown> = {}): ReturnType<AgentService['conversations']['create']> {
    return this.withRuntimeContext(() => this.service.conversations.create(payload as any)) as ReturnType<AgentService['conversations']['create']>
  }

  saveConversation(payload: Record<string, unknown> & { id: number }): ReturnType<AgentService['conversations']['save']> {
    return this.withRuntimeContext(() => this.service.conversations.save(payload as any)) as ReturnType<AgentService['conversations']['save']>
  }

  renameConversation(id: number, title: string): ReturnType<AgentService['conversations']['rename']> {
    return this.withRuntimeContext(() => this.service.conversations.rename(Number(id), title)) as ReturnType<AgentService['conversations']['rename']>
  }

  updateConversationMetadata(id: number, patch: { pinned?: boolean }): ReturnType<AgentService['conversations']['updateMetadata']> {
    return this.withRuntimeContext(() => this.service.conversations.updateMetadata(Number(id), patch)) as ReturnType<AgentService['conversations']['updateMetadata']>
  }

  deleteConversation(id: number): boolean {
    return this.withRuntimeContext(() => this.service.conversations.delete(Number(id))) as boolean
  }

  listMemories(options: Parameters<AgentService['memories']['list']>[0] = {}): ReturnType<AgentService['memories']['list']> {
    return this.withRuntimeContext(() => this.service.memories.list(options)) as ReturnType<AgentService['memories']['list']>
  }

  getMemorySummary(): ReturnType<AgentService['memories']['getSummary']> {
    return this.withRuntimeContext(() => this.service.memories.getSummary()) as ReturnType<AgentService['memories']['getSummary']>
  }

  loadMemory(id: string): ReturnType<AgentService['memories']['get']> {
    return this.withRuntimeContext(() => this.service.memories.get(id)) as ReturnType<AgentService['memories']['get']>
  }

  createMemory(input: Record<string, unknown>): ReturnType<AgentService['memories']['create']> {
    return this.withRuntimeContext(() => this.service.memories.create(input as any)) as ReturnType<AgentService['memories']['create']>
  }

  updateMemory(id: string, patch: Record<string, unknown>): ReturnType<AgentService['memories']['update']> {
    return this.withRuntimeContext(() => this.service.memories.update(id, patch as any)) as ReturnType<AgentService['memories']['update']>
  }

  deleteMemory(id: string): boolean {
    return this.withRuntimeContext(() => this.service.memories.delete(id)) as boolean
  }

  setMemoryEnabled(enabled: boolean): ReturnType<AgentService['memories']['setEnabled']> {
    return this.withRuntimeContext(() => this.service.memories.setEnabled(enabled)) as ReturnType<AgentService['memories']['setEnabled']>
  }

  clearMemory(options: { disable?: boolean } = {}): ReturnType<AgentService['memories']['clear']> {
    return this.withRuntimeContext(() => this.service.memories.clear(options)) as ReturnType<AgentService['memories']['clear']>
  }

  saveFeedback(input: Parameters<AgentFeedbackStore['save']>[0]): AgentAnswerFeedback {
    if (input.rating !== 'up' && input.rating !== 'down') throw new Error('反馈评分无效')
    return this.withRuntimeContext(() => this.feedback.save(input)) as AgentAnswerFeedback
  }

  deleteFeedback(messageId: string): boolean {
    return this.withRuntimeContext(() => this.feedback.delete(messageId)) as boolean
  }

  listFeedback(limit = 500): AgentAnswerFeedback[] {
    return this.withRuntimeContext(() => this.feedback.list(limit)) as AgentAnswerFeedback[]
  }

  feedbackSummary(conversationId?: number | null, limit = 20): AgentFeedbackSummary | null {
    return this.withRuntimeContext(() => this.feedback.summarizeForConversation(conversationId, limit)) as AgentFeedbackSummary | null
  }

  feedbackMemoryEvidence(limit?: number): AgentFeedbackMemoryEvidence {
    return this.withRuntimeContext(() => this.feedback.memoryEvidence(limit)) as AgentFeedbackMemoryEvidence
  }

  async synthesizeMemoryFromFeedback(modelConfig?: AgentModelConfig): Promise<AgentMemorySynthesisResult> {
    return await this.withRuntimeContext(() => synthesizeAgentMemoryFromFeedback({
      evidence: this.feedback.memoryEvidence(),
      modelConfig: modelConfig || this.modelConfig,
    }))
  }

  async reviseMemory(instruction: string, modelConfig?: AgentModelConfig): Promise<AgentMemorySynthesisResult> {
    return await this.withRuntimeContext(() => reviseAgentMemorySummary({ instruction, modelConfig: modelConfig || this.modelConfig }))
  }

  async refreshMemory(modelConfig?: AgentModelConfig): Promise<AgentMemorySynthesisResult> {
    return await this.withRuntimeContext(() => refreshAgentMemorySummary({
      modelConfig: modelConfig || this.modelConfig,
      recentExchanges: this.recentMemoryExchanges(''),
    }))
  }

  get conversations(): AgentService['conversations'] {
    return this.contextualConversations
  }

  get memories(): AgentService['memories'] {
    return this.contextualMemories
  }
}

export function createRelinkRuntime(options: RelinkRuntimeOptions = {}): RelinkRuntime {
  return new RelinkRuntime(options)
}

export function modelConfigFromEnvironment(overrides: Partial<AgentModelConfig> = {}): AgentModelConfig {
  return { ...envModelConfig(), ...overrides }
}

export type { AgentDataSource, AgentMode, AgentModelConfig, AgentProgress, AgentScope }
export { getRelinkDataProvider }
