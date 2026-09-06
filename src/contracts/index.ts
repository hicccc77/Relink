/**
 * Stable, product-neutral contracts at the ingestion boundary.
 * The model-led Agent itself exposes its richer run types from `agent/runtime`.
 */

export type EntityType = 'person' | 'organization' | 'group' | 'place' | 'custom'

export type Entity = {
  id: string
  type: EntityType
  name: string
  aliases?: string[]
  metadata?: Record<string, unknown>
}

export type SourceRef = {
  datasetId: string
  locator: string
  label?: string
}

export type Interaction = {
  id: string
  participants: string[]
  /** Optional explicit actor/author. Omitted means the source did not provide direction. */
  actorId?: string
  occurredAt: string
  kind: string
  content?: string
  metadata?: Record<string, unknown>
  sourceRef: SourceRef
}

export type Dataset = {
  id: string
  name: string
  version: 1
  entities: Entity[]
  interactions: Interaction[]
  metadata?: Record<string, unknown>
}

export type DatasetInput = Partial<Omit<Dataset, 'version'>> & {
  version?: number
  messages?: unknown[]
  records?: unknown[]
  events?: unknown[]
  items?: unknown[]
}

export type DateRange = { from?: string; to?: string }

/** Pair scope shorthand accepted by the SDK and translated to AgentScope. */
export type RelinkScope = {
  entityA?: string
  entityB?: string
  entityIds?: string[]
  dateRange?: DateRange
}

/** Generic model configuration accepted by adapters; the runtime adds protocol-specific fields. */
export type ModelConfig = {
  provider?: string
  baseUrl?: string
  baseURL?: string
  apiKey?: string
  model?: string
  protocol?: 'openai-responses' | 'openai-compatible' | 'anthropic' | 'google'
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  contextWindow?: number
  maxTokens?: number
  maxOutputTokens?: number
}

/**
 * Optional high-level source interface. The SDK converts it to the Agent's
 * lower-level RelinkDataProvider; direct integrations should implement
 * that richer interface instead.
 */
export interface RelinkDataSource {
  getDataset(): Promise<Dataset>
  search?(query: { text?: string; entityIds?: string[]; from?: string; to?: string; limit?: number }): Promise<unknown[]>
  timeline?(query: { entityIds?: string[]; from?: string; to?: string; limit?: number }): Promise<unknown>
  aggregate?(query: { entityIds?: string[]; from?: string; to?: string }): Promise<unknown>
  readContext?(interactionIds: string[], includeRawContent?: boolean): Promise<unknown[]>
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function stringValue(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const result = String(value).trim()
  return result || undefined
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}
