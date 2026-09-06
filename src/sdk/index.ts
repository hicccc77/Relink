/** Public SDK for Relink. */
import type { LanguageModel, UIMessage } from 'ai'
import type { RelinkDataSource, Dataset, ModelConfig, RelinkScope } from '../contracts/index.js'
import {
  createRelinkRuntime,
  modelConfigFromEnvironment,
  RelinkRuntime,
  type AgentMessageInput,
  type RelinkRunInput,
  type RelinkRunResult,
  type RelinkRuntimeOptions,
} from '../agent/runtime.js'
import {
  DatasetProvider,
  type DatasetLike,
  type RelinkDataProvider,
} from '../agent/services/dataProvider.js'
import type {
  AgentDataSource,
  AgentMode,
  AgentModelConfig,
  AgentProgress,
  AgentQueryFilters,
  AgentReasoningEffort,
  AgentScope,
} from '../agent/services/agentModelLedService.js'

export type CreateRelinkOptions = RelinkRuntimeOptions & {
  /** Convenience alias for dataset-backed integrations. */
  dataSource?: RelinkDataSource
  /** Explicit provider is preferred when integrating a database, API, or event stream. */
  dataProvider?: RelinkDataProvider
  /** The core Agent creates its own model from this configuration. */
  modelConfig?: AgentModelConfig | ModelConfig
  /** Accepted for source compatibility; the full Agent reports progress via run callbacks. */
  onProgress?: (progress: AgentProgress) => void
}

function modelConfig(value: AgentModelConfig | ModelConfig | undefined): AgentModelConfig | undefined {
  if (!value) return undefined
  const input = value as Record<string, unknown>
  return {
    provider: typeof input.provider === 'string' ? input.provider : undefined,
    apiKey: typeof input.apiKey === 'string' ? input.apiKey : undefined,
    model: typeof input.model === 'string' ? input.model : undefined,
    baseURL: typeof input.baseURL === 'string' ? input.baseURL : typeof input.baseUrl === 'string' ? input.baseUrl : undefined,
    protocol: input.protocol as AgentModelConfig['protocol'] | undefined,
    reasoningEffort: input.reasoningEffort as AgentModelConfig['reasoningEffort'] | undefined,
    maxOutputTokens: Number(input.maxOutputTokens ?? input.maxTokens) || undefined,
    contextWindow: Number(input.contextWindow) || undefined,
  }
}

async function datasetFromDataSource(source: RelinkDataSource): Promise<DatasetLike | undefined> {
  try {
    return await source.getDataset()
  } catch {
    return undefined
  }
}

function providerFromDataSource(source: RelinkDataSource): RelinkDataProvider {
  let cached: DatasetLike | undefined
  const get = async () => {
    cached ||= await datasetFromDataSource(source)
    return cached
  }
  const provider = async () => new DatasetProvider((await get()) || {})
  return {
    connect: async () => ({ success: true }),
    getDataset: get,
    findSessionForEntities: (ids) => cached ? new DatasetProvider(cached).findSessionForEntities(ids) : undefined,
    findSessionsForEntities: (ids) => cached ? new DatasetProvider(cached).findSessionsForEntities(ids) : [],
    getSessions: async () => (await provider()).getSessions(),
    getSessionDetail: async (id) => (await provider()).getSessionDetail(id),
    getMessages: async (id, offset, limit, begin, end, ascending) => (await provider()).getMessages(id, offset, limit, begin, end, ascending),
    getMessagesAround: async (id, target, count) => (await provider()).getMessagesAround(id, target, count),
    getMessageWindowForJump: async (id, target, count) => (await provider()).getMessageWindowForJump(id, target, count),
    getMessageDateCounts: async (id) => (await provider()).getMessageDateCounts(id),
    scanConversationMessagesForAnalysis: async (id, options, onBatch) => (await provider()).scanConversationMessagesForAnalysis(id, options, onBatch),
    searchMessages: async (query, id, limit, offset, begin, end) => (await provider()).searchMessages(query, id, limit, offset, begin, end),
  }
}

function runtimeOptions(options: CreateRelinkOptions): RelinkRuntimeOptions {
  const provider = options.dataProvider || (options.dataSource ? providerFromDataSource(options.dataSource) : undefined)
  return {
    ...options,
    ...(provider ? { dataProvider: provider } : {}),
    modelConfig: modelConfig(options.modelConfig),
  }
}

/** Construct the complete model-led runtime. */
export function createRelink(options: CreateRelinkOptions = {}): RelinkRuntime {
  return createRelinkRuntime(runtimeOptions(options))
}

/** Explicitly named constructor for new integrations. */
export { createRelinkRuntime, RelinkRuntime, modelConfigFromEnvironment }

export async function runRelink(input: RelinkRunInput, options: CreateRelinkOptions = {}): Promise<RelinkRunResult> {
  return createRelink(options).run(input)
}

/** Convenience alias: this is a full Agent run, not a deterministic metric report. */
export async function analyze(
  dataset: unknown,
  request: { question?: string; prompt?: string; scope?: AgentScope | RelinkScope; mode?: AgentMode; messages?: AgentMessageInput[]; modelConfig?: AgentModelConfig } = {},
  options: Omit<CreateRelinkOptions, 'dataset' | 'datasetFile'> = {},
): Promise<RelinkRunResult> {
  const runtime = createRelink({ ...options, dataset })
  return runtime.run({ ...request, modelConfig: request.modelConfig || modelConfig(options.modelConfig), onProgress: options.onProgress })
}

export async function analyzeFile(
  filePath: string,
  request: { question?: string; prompt?: string; scope?: AgentScope | RelinkScope; mode?: AgentMode; messages?: AgentMessageInput[]; modelConfig?: AgentModelConfig } = {},
  options: Omit<CreateRelinkOptions, 'dataset' | 'datasetFile'> = {},
): Promise<RelinkRunResult> {
  const runtime = createRelink({ ...options, datasetFile: filePath })
  return runtime.run({ ...request, modelConfig: request.modelConfig || modelConfig(options.modelConfig), onProgress: options.onProgress })
}

export type {
  AgentDataSource,
  AgentMode,
  AgentModelConfig,
  AgentProgress,
  AgentQueryFilters,
  AgentReasoningEffort,
  AgentScope,
  AgentMessageInput,
  RelinkRunInput,
  RelinkRunResult,
  RelinkRuntimeOptions,
  RelinkDataProvider,
  DatasetLike,
}
export type { Dataset, ModelConfig, RelinkScope, UIMessage, LanguageModel }
export type { AgentTitleResult } from '../agent/services/agentTitleService.js'
export type {
  AgentAnswerFeedback,
  AgentFeedbackMemoryEvidence,
  AgentFeedbackMemorySample,
  AgentFeedbackReason,
  AgentFeedbackSummary,
} from '../agent/services/agentFeedbackStore.js'
export type {
  AgentMemoryConversationExchange,
  AgentMemorySynthesisResult,
} from '../agent/services/agentMemorySynthesisService.js'
export * from '../agent/services/agentRunStore.js'
export * from '../agent/services/dataProvider.js'
export * from '../ingestion/normalize.js'
