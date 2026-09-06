import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { createRelink, type CreateRelinkOptions, type RelinkRuntime } from '../sdk/index.js'

type JsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

function result(id: JsonRpcRequest['id'], value: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result: value })
}

function error(id: JsonRpcRequest['id'], code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
}

const runInputSchema = {
  type: 'object',
  properties: {
    prompt: { type: 'string', description: 'Relationship question or investigation objective.' },
    question: { type: 'string', description: 'Alias for prompt.' },
    messages: { type: 'array', description: 'Optional AI SDK UI messages; prompt is appended when both are supplied.' },
    scope: { type: 'object', description: 'Agent scope: {kind:"global"} or {kind:"session",sessionId}; pair shorthand with entityA/entityB is also accepted.' },
    mode: { type: 'string', enum: ['standard', 'deep-research'] },
    modelConfig: { type: 'object', description: 'Optional per-run model configuration.' },
    resumeFromRunId: { type: 'string' },
    runId: { type: 'string', description: 'Optional caller-supplied run id for cancellation and state lookup.' },
    conversationId: { type: 'number' },
    memorySynthesis: { type: 'boolean' },
    runtimeDataContext: { type: 'object', description: 'Optional owner/source/dataset fingerprints and cache encryption secret.' },
  },
} as const

export const MCP_TOOLS = [
  {
    name: 'relink_run',
    description: 'Run Relink against the configured user-provided data. The result includes the answer, model stream chunks, progress, evidence trace and resumable state.',
    inputSchema: runInputSchema,
  },
  {
    name: 'relink_dataset_summary',
    description: 'Return metadata and coverage for the configured provider dataset.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'relink_sessions',
    description: 'List stable relation sessions exposed by the configured provider.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'relink_search',
    description: 'Search user-provided records through the configured provider.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        sessionId: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
    },
  },
  {
    name: 'relink_runs',
    description: 'List, load, or replay persisted Agent run states for recovery and audit.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'replay'] },
        runId: { type: 'string' },
        limit: { type: 'number' },
        modelConfig: { type: 'object' },
      },
    },
  },
  {
    name: 'relink_abort',
    description: 'Abort a running Agent and persist its resumable aborted state.',
    inputSchema: { type: 'object', properties: { runId: { type: 'string' } }, required: ['runId'] },
  },
  {
    name: 'relink_memory',
    description: 'Read or update the Runtime memory store. Actions: list, get, summary, create, update, delete, revise, refresh, enable, clear.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'summary', 'create', 'update', 'delete', 'revise', 'refresh', 'enable', 'clear'] },
        id: { type: 'string' },
        query: { type: 'string' },
        includeArchived: { type: 'boolean' },
        content: { type: 'string' },
        category: { type: 'string' },
        confidence: { type: 'number' },
        scope: { type: 'object' },
        source: { type: 'object' },
        expiresAt: { type: 'number' },
        archived: { type: 'boolean' },
        instruction: { type: 'string' },
        enabled: { type: 'boolean' },
        disable: { type: 'boolean' },
        modelConfig: { type: 'object' },
      },
    },
  },
  {
    name: 'relink_conversations',
    description: 'Manage persisted Agent conversations. Actions: list, get, create, save, rename, metadata, delete.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'get', 'create', 'save', 'rename', 'metadata', 'delete'] },
        id: { type: 'number' },
        title: { type: 'string' },
        scope: { type: 'object' },
        messages: { type: 'array' },
        modelProvider: { type: 'string' },
        modelId: { type: 'string' },
        pinned: { type: 'boolean' },
      },
    },
  },
  {
    name: 'relink_feedback',
    description: 'Save, list or delete answer feedback used by the Runtime learning loop.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'save', 'delete', 'summary', 'synthesize'] },
        messageId: { type: 'string' },
        runId: { type: 'string' },
        rating: { type: 'string', enum: ['up', 'down'] },
        reason: { type: 'string' },
        answer: { type: 'string' },
        conversationId: { type: 'number' },
        modelConfig: { type: 'object' },
      },
    },
  },
  {
    name: 'relink_title',
    description: 'Generate a short title for a saved Agent conversation.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' }, modelConfig: { type: 'object' } }, required: ['text'] },
  },
] as const

function mcpText(value: unknown): { content: Array<{ type: 'text'; text: string }>; structuredContent?: unknown } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) ?? 'null' }], structuredContent: value }
}

function mcpToolError(value: unknown): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  const message = value instanceof Error ? value.message : String(value || 'Tool execution failed')
  return { content: [{ type: 'text', text: message }], isError: true }
}

export class RelinkMcpServer {
  readonly runtime: RelinkRuntime
  private readonly requestRuns = new Map<string, string>()

  constructor(options: CreateRelinkOptions = {}) {
    this.runtime = createRelink(options)
  }

  async handle(request: JsonRpcRequest): Promise<string | null> {
    const method = request.method || ''
    if (method === 'notifications/cancelled') {
      const requestId = String(request.params?.requestId ?? '')
      const runId = this.requestRuns.get(requestId)
      if (runId) this.runtime.abort(runId, String(request.params?.reason || 'MCP request cancelled'))
      return null
    }
    if (method === 'notifications/initialized' || method.startsWith('notifications/')) return null
    if (method === 'initialize') {
      return result(request.id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'relink', version: '0.1.0' },
      })
    }
    if (method === 'ping') return result(request.id, {})
    if (method === 'tools/list') return result(request.id, { tools: MCP_TOOLS })
    if (method !== 'tools/call') return error(request.id, -32601, `Unsupported method: ${method}`)
    const name = String(request.params?.name || '')
    const args = request.params?.arguments && typeof request.params.arguments === 'object'
      ? request.params.arguments as Record<string, unknown>
      : {}
    try {
      if (name === 'relink_run') {
        const runId = typeof args.runId === 'string' && args.runId ? args.runId : randomUUID()
        const requestId = String(request.id ?? '')
        if (requestId) this.requestRuns.set(requestId, runId)
        try {
          return result(request.id, mcpText(await this.runtime.run({ ...args, runId, prompt: typeof args.prompt === 'string' ? args.prompt : typeof args.question === 'string' ? args.question : undefined })))
        } finally {
          if (requestId) this.requestRuns.delete(requestId)
        }
      }
      if (name === 'relink_dataset_summary') return result(request.id, mcpText(await this.runtime.getDatasetSummary()))
      if (name === 'relink_sessions') return result(request.id, mcpText(await this.runtime.listSessions()))
      if (name === 'relink_search') return result(request.id, mcpText(await this.runtime.search({ text: String(args.text || args.query || ''), sessionId: typeof args.sessionId === 'string' ? args.sessionId : undefined, from: typeof args.from === 'string' ? args.from : undefined, to: typeof args.to === 'string' ? args.to : undefined, limit: Number(args.limit) || 50, offset: Number(args.offset) || 0 })))
      if (name === 'relink_runs') {
        const action = String(args.action || 'list')
        if (action === 'list') return result(request.id, mcpText({ runs: this.runtime.listRuns(Number(args.limit) || 100) }))
        const runId = String(args.runId || '')
        if (!runId) return result(request.id, mcpToolError('runId is required'))
        if (action === 'get') return result(request.id, mcpText({ run: this.runtime.loadRun(runId) }))
        if (action === 'replay') return result(request.id, mcpText(await this.runtime.replay(runId, args.modelConfig as any)))
        return result(request.id, mcpToolError(`Unknown runs action: ${action}`))
      }
      if (name === 'relink_abort') {
        const runId = String(args.runId || '')
        if (!runId) return result(request.id, mcpToolError('runId is required'))
        return result(request.id, mcpText({ runId, aborted: this.runtime.abort(runId) }))
      }
      if (name === 'relink_memory') {
        const action = String(args.action || 'summary')
        if (action === 'list') return result(request.id, mcpText({ memories: this.runtime.listMemories({ query: typeof args.query === 'string' ? args.query : undefined, includeArchived: args.includeArchived === true }) }))
        if (['get', 'update', 'delete'].includes(action) && !String(args.id || '')) return result(request.id, mcpToolError('id is required'))
        if (action === 'get') return result(request.id, mcpText({ memory: this.runtime.loadMemory(String(args.id)) }))
        if (action === 'summary') return result(request.id, mcpText({ summary: this.runtime.getMemorySummary() }))
        if (action === 'create') return result(request.id, mcpText({ memory: this.runtime.createMemory(args) }))
        if (action === 'update') return result(request.id, mcpText({ memory: this.runtime.updateMemory(String(args.id || ''), args) }))
        if (action === 'delete') return result(request.id, mcpText({ deleted: this.runtime.deleteMemory(String(args.id || '')) }))
        if (action === 'revise') return result(request.id, mcpText(await this.runtime.reviseMemory(String(args.instruction || ''), args.modelConfig as any)))
        if (action === 'refresh') return result(request.id, mcpText(await this.runtime.refreshMemory(args.modelConfig as any)))
        if (action === 'enable') return result(request.id, mcpText({ summary: this.runtime.setMemoryEnabled(args.enabled === true) }))
        if (action === 'clear') return result(request.id, mcpText({ summary: this.runtime.clearMemory({ disable: args.disable === true }) }))
        return result(request.id, mcpToolError(`Unknown memory action: ${action}`))
      }
      if (name === 'relink_conversations') {
        const action = String(args.action || 'list')
        if (action === 'list') return result(request.id, mcpText({ conversations: this.runtime.listConversations(args.scope as any) }))
        const id = Number(args.id)
        if (action !== 'create' && (!Number.isFinite(id) || id <= 0)) return result(request.id, mcpToolError('id must be a positive integer'))
        if (action === 'get') return result(request.id, mcpText({ conversation: this.runtime.loadConversation(id) }))
        if (action === 'create') return result(request.id, mcpText({ conversation: this.runtime.createConversation(args) }))
        if (action === 'save') return result(request.id, mcpText({ conversation: this.runtime.saveConversation({ ...args, id }) }))
        if (action === 'rename') return result(request.id, mcpText({ conversation: this.runtime.renameConversation(id, String(args.title || '')) }))
        if (action === 'metadata') return result(request.id, mcpText({ conversation: this.runtime.updateConversationMetadata(id, { pinned: args.pinned === true }) }))
        if (action === 'delete') return result(request.id, mcpText({ deleted: this.runtime.deleteConversation(id) }))
        return result(request.id, mcpToolError(`Unknown conversations action: ${action}`))
      }
      if (name === 'relink_feedback') {
        const action = String(args.action || 'list')
        if (action === 'list') return result(request.id, mcpText({ feedback: this.runtime.listFeedback(Number(args.limit) || 500) }))
        if (action === 'save') return result(request.id, mcpText({ feedback: this.runtime.saveFeedback(args as any) }))
        if (action === 'delete') return result(request.id, mcpText({ deleted: this.runtime.deleteFeedback(String(args.messageId || '')) }))
        if (action === 'summary') return result(request.id, mcpText({ summary: this.runtime.feedbackSummary(Number(args.conversationId) || null) }))
        if (action === 'synthesize') return result(request.id, mcpText(await this.runtime.synthesizeMemoryFromFeedback(args.modelConfig as any)))
        return result(request.id, mcpToolError(`Unknown feedback action: ${action}`))
      }
      if (name === 'relink_title') return result(request.id, mcpText(await this.runtime.generateTitle(String(args.text || ''), args.modelConfig as any)))
      return result(request.id, mcpToolError(`Unknown tool: ${name}`))
    } catch (toolError) {
      return result(request.id, mcpToolError(toolError))
    }
  }
}

export function createMcpServer(options: CreateRelinkOptions = {}): RelinkMcpServer {
  return new RelinkMcpServer(options)
}

export async function startMcpStdio(server: RelinkMcpServer): Promise<void> {
  const readline = createInterface({ input: process.stdin, crlfDelay: Infinity })
  const pending = new Set<Promise<void>>()
  for await (const line of readline) {
    if (!line.trim()) continue
    let request: JsonRpcRequest
    try { request = JSON.parse(line) as JsonRpcRequest } catch { process.stdout.write(`${error(null, -32700, 'Parse error')}\n`); continue }
    const task = server.handle(request)
      .then((response) => { if (response) process.stdout.write(`${response}\n`) })
      .catch((cause: unknown) => { process.stdout.write(`${error(request.id, -32603, cause instanceof Error ? cause.message : String(cause))}\n`) })
      .finally(() => pending.delete(task))
    pending.add(task)
  }
  await Promise.allSettled(pending)
}
