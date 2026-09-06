import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { URL } from 'node:url'
import {
  createRelink,
  type CreateRelinkOptions,
  type RelinkRuntime,
  type RelinkRunInput,
} from '../sdk/index.js'
import { normalizeDataset } from '../ingestion/normalize.js'

export type ApiServerOptions = CreateRelinkOptions & {
  host?: string
  port?: number
  maxBodyBytes?: number
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  if (response.writableEnded) return
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('access-control-allow-headers', 'content-type, authorization')
  response.end(JSON.stringify(value))
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > maxBytes) throw new Error(`Request body exceeds the ${maxBytes}-byte limit`)
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  try { return JSON.parse(text) } catch { throw new Error('Request body must be valid JSON') }
}

function objectPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function runInput(body: Record<string, unknown>): RelinkRunInput {
  const nested = objectPayload(body.input || body.request)
  const merged = { ...body, ...nested }
  const input: RelinkRunInput = {
    prompt: typeof merged.prompt === 'string' ? merged.prompt : typeof merged.question === 'string' ? merged.question : undefined,
    question: typeof merged.question === 'string' ? merged.question : undefined,
    messages: Array.isArray(merged.messages) ? merged.messages as RelinkRunInput['messages'] : undefined,
    scope: merged.scope as RelinkRunInput['scope'],
    mode: merged.mode as RelinkRunInput['mode'],
    modelConfig: merged.modelConfig as RelinkRunInput['modelConfig'],
    runId: typeof merged.runId === 'string' ? merged.runId : undefined,
    resumeFromRunId: typeof merged.resumeFromRunId === 'string' ? merged.resumeFromRunId : undefined,
    conversationId: typeof merged.conversationId === 'number' ? merged.conversationId : undefined,
    debugLogEnabled: merged.debugLogEnabled === true,
    memorySynthesis: typeof merged.memorySynthesis === 'boolean' ? merged.memorySynthesis : undefined,
    runtimeDataContext: objectPayload(merged.runtimeDataContext) as RelinkRunInput['runtimeDataContext'],
  }
  return input
}

function writeSse(response: ServerResponse, event: string, value: unknown): void {
  if (!response.writableEnded) response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)
}

function setupSse(response: ServerResponse): void {
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream; charset=utf-8')
  response.setHeader('cache-control', 'no-cache, no-transform')
  response.setHeader('connection', 'keep-alive')
  response.setHeader('access-control-allow-origin', '*')
}

export function createApiServer(options: ApiServerOptions = {}) {
  let runtime: RelinkRuntime = createRelink(options)
  const maxBodyBytes = options.maxBodyBytes || 10 * 1024 * 1024
  const server = createServer(async (request, response) => {
    try {
      if (request.method === 'OPTIONS') {
        response.statusCode = 204
        response.setHeader('access-control-allow-origin', '*')
        response.setHeader('access-control-allow-methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
        response.setHeader('access-control-allow-headers', 'content-type, authorization')
        response.end()
        return
      }
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
      const path = url.pathname.replace(/^\/v1(?=\/|$)/, '') || '/'
      if (request.method === 'GET' && path === '/health') {
        writeJson(response, 200, { ok: true, service: 'relink', version: 1, runtime: 'relink-runtime' })
        return
      }
      if (request.method === 'GET' && path === '/dataset') {
        writeJson(response, 200, await runtime.getDataset() || null)
        return
      }
      if (request.method === 'GET' && path === '/dataset/summary') {
        writeJson(response, 200, await runtime.getDatasetSummary())
        return
      }
      if (request.method === 'GET' && path === '/sessions') {
        writeJson(response, 200, await runtime.listSessions())
        return
      }
      if (request.method === 'GET' && path === '/conversations') {
        writeJson(response, 200, { success: true, conversations: runtime.listConversations() })
        return
      }
      if (request.method === 'POST' && path === '/conversations') {
        const body = objectPayload(await readBody(request, maxBodyBytes))
        writeJson(response, 201, { success: true, conversation: runtime.createConversation(body) })
        return
      }
      const conversationMatch = path.match(/^\/conversations\/([^/]+)$/)
      if (conversationMatch && request.method === 'GET') {
        const conversation = runtime.loadConversation(Number(decodeURIComponent(conversationMatch[1])))
        writeJson(response, conversation ? 200 : 404, conversation || { error: 'Conversation not found' })
        return
      }
      if (conversationMatch && (request.method === 'PUT' || request.method === 'PATCH')) {
        const body = objectPayload(await readBody(request, maxBodyBytes))
        const id = Number(decodeURIComponent(conversationMatch[1]))
        let conversation = runtime.loadConversation(id)
        if (conversation && ['messages', 'scope', 'modelProvider', 'modelId'].some((key) => body[key] !== undefined)) {
          conversation = runtime.saveConversation({ ...body, id } as Record<string, unknown> & { id: number })
        }
        if (conversation && body.title !== undefined) conversation = runtime.renameConversation(id, String(body.title || ''))
        if (conversation && body.pinned !== undefined) conversation = runtime.updateConversationMetadata(id, { pinned: body.pinned === true })
        writeJson(response, conversation ? 200 : 404, conversation || { error: 'Conversation not found' })
        return
      }
      if (conversationMatch && request.method === 'DELETE') {
        const id = Number(decodeURIComponent(conversationMatch[1]))
        const deleted = runtime.deleteConversation(id)
        writeJson(response, deleted ? 200 : 404, { id, deleted })
        return
      }
      if (request.method === 'POST' && path === '/datasets') {
        const payload = await readBody(request, maxBodyBytes)
        const body = objectPayload(payload)
        const raw = Array.isArray(payload) ? payload : body.dataset ?? body.data ?? body
        const dataset = normalizeDataset(raw, { sourceName: String(body.name || 'api-upload') })
        runtime.setDataset(dataset)
        writeJson(response, 201, { dataset: await runtime.getDatasetSummary() })
        return
      }
      if (request.method === 'POST' && (path === '/analyze' || path === '/runs')) {
        const body = objectPayload(await readBody(request, maxBodyBytes))
        const result = await runtime.run(runInput(body))
        writeJson(response, 200, result)
        return
      }
      if (request.method === 'POST' && (path === '/analyze/stream' || path === '/runs/stream')) {
        const body = objectPayload(await readBody(request, maxBodyBytes))
        setupSse(response)
        const input = runInput(body)
        input.runId ||= randomUUID()
        const abort = new AbortController()
        request.once('aborted', () => abort.abort(new Error('Client disconnected')))
        const abortOnResponseClose = () => {
          if (!response.writableEnded) abort.abort(new Error('Client disconnected'))
        }
        response.once('close', abortOnResponseClose)
        input.signal = abort.signal
        writeSse(response, 'ready', { ok: true, runId: input.runId })
        try {
          const result = await runtime.run({
            ...input,
            onProgress: (progress) => writeSse(response, 'progress', progress),
            onChunk: (chunk) => writeSse(response, 'chunk', chunk),
          })
          writeSse(response, 'result', result)
          writeSse(response, 'done', { runId: result.runId })
        } catch (error) {
          writeSse(response, 'error', { error: error instanceof Error ? error.message : String(error) })
        } finally {
          response.removeListener('close', abortOnResponseClose)
          response.end()
        }
        return
      }
      const runMatch = path.match(/^\/runs\/([^/]+)$/)
      if (request.method === 'GET' && runMatch) {
        const state = runtime.loadRun(decodeURIComponent(runMatch[1]))
        if (!state) { writeJson(response, 404, { error: 'Run not found' }); return }
        writeJson(response, 200, state)
        return
      }
      const abortMatch = path.match(/^\/runs\/([^/]+)\/abort$/)
      if (request.method === 'POST' && abortMatch) {
        const runId = decodeURIComponent(abortMatch[1])
        const aborted = runtime.abort(runId)
        writeJson(response, aborted ? 200 : 404, { runId, aborted })
        return
      }
      const replayMatch = path.match(/^\/runs\/([^/]+)\/replay$/)
      if (request.method === 'POST' && replayMatch) {
        const result = await runtime.replay(decodeURIComponent(replayMatch[1]))
        writeJson(response, 200, result)
        return
      }
      if (request.method === 'GET' && path === '/runs') {
        writeJson(response, 200, { runs: runtime.listRuns(Number(url.searchParams.get('limit') || 100)) })
        return
      }
      if (request.method === 'GET' && path === '/memories') {
        writeJson(response, 200, { success: true, memories: runtime.listMemories({
          query: url.searchParams.get('query') || undefined,
          includeArchived: url.searchParams.get('includeArchived') === 'true',
        }) })
        return
      }
      if (request.method === 'GET' && path === '/memories/summary') {
        writeJson(response, 200, { success: true, summary: runtime.getMemorySummary() })
        return
      }
      if (request.method === 'POST' && path === '/memories') {
        const body = objectPayload(await readBody(request, maxBodyBytes))
        try { writeJson(response, 201, { success: true, memory: runtime.createMemory(body) }) } catch (error) { writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) }) }
        return
      }
      const memoryMatch = path.match(/^\/memories\/([^/]+)$/)
      if (memoryMatch && request.method === 'GET') {
        const memory = runtime.loadMemory(decodeURIComponent(memoryMatch[1]))
        writeJson(response, memory ? 200 : 404, memory || { error: 'Memory not found' })
        return
      }
      if (memoryMatch && (request.method === 'PATCH' || request.method === 'PUT')) {
        const body = objectPayload(await readBody(request, maxBodyBytes))
        const memory = runtime.updateMemory(decodeURIComponent(memoryMatch[1]), body)
        writeJson(response, memory ? 200 : 404, memory || { error: 'Memory not found' })
        return
      }
      if (memoryMatch && request.method === 'DELETE') {
        const id = decodeURIComponent(memoryMatch[1])
        const deleted = runtime.deleteMemory(id)
        writeJson(response, deleted ? 200 : 404, { id, deleted })
        return
      }
      if (request.method === 'POST' && path === '/memories/summary/revise') {
        const body = objectPayload(await readBody(request, maxBodyBytes))
        writeJson(response, 200, await runtime.reviseMemory(String(body.instruction || ''), body.modelConfig as any))
        return
      }
      if (request.method === 'POST' && path === '/memories/summary/refresh') {
        const body = objectPayload(await readBody(request, maxBodyBytes))
        writeJson(response, 200, await runtime.refreshMemory(body.modelConfig as any))
        return
      }
      if (request.method === 'POST' && path === '/memories/from-feedback') {
        const body = objectPayload(await readBody(request, maxBodyBytes))
        writeJson(response, 200, await runtime.synthesizeMemoryFromFeedback(body.modelConfig as any))
        return
      }
      if (request.method === 'POST' && path === '/memories/enabled') {
        const body = objectPayload(await readBody(request, maxBodyBytes))
        writeJson(response, 200, { success: true, summary: runtime.setMemoryEnabled(body.enabled === true) })
        return
      }
      if (request.method === 'POST' && path === '/memories/clear') {
        const body = objectPayload(await readBody(request, maxBodyBytes))
        writeJson(response, 200, { success: true, summary: runtime.clearMemory({ disable: body.disable === true }) })
        return
      }
      if (request.method === 'GET' && path === '/feedback') {
        writeJson(response, 200, { success: true, feedback: runtime.listFeedback(Number(url.searchParams.get('limit') || 500)) })
        return
      }
      if (request.method === 'POST' && path === '/feedback') {
        const body = objectPayload(await readBody(request, maxBodyBytes))
        try { writeJson(response, 201, { success: true, feedback: runtime.saveFeedback(body as any) }) } catch (error) { writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) }) }
        return
      }
      if (request.method === 'GET' && path === '/feedback/summary') {
        writeJson(response, 200, { success: true, summary: runtime.feedbackSummary(Number(url.searchParams.get('conversationId') || 0) || null) })
        return
      }
      const feedbackMatch = path.match(/^\/feedback\/([^/]+)$/)
      if (feedbackMatch && request.method === 'DELETE') {
        const messageId = decodeURIComponent(feedbackMatch[1])
        const deleted = runtime.deleteFeedback(messageId)
        writeJson(response, deleted ? 200 : 404, { messageId, deleted })
        return
      }
      if (request.method === 'POST' && path === '/title') {
        const body = objectPayload(await readBody(request, maxBodyBytes))
        writeJson(response, 200, await runtime.generateTitle(String(body.text || body.firstMessage || ''), body.modelConfig as any))
        return
      }
      if (request.method === 'POST' && path === '/search') {
        const body = objectPayload(await readBody(request, maxBodyBytes))
        writeJson(response, 200, await runtime.search({ text: String(body.text || body.query || ''), sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined, limit: Number(body.limit) || 50, offset: Number(body.offset) || 0, from: typeof body.from === 'string' ? body.from : undefined, to: typeof body.to === 'string' ? body.to : undefined }))
        return
      }
      writeJson(response, 404, { error: 'Not found' })
    } catch (error) {
      writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  })
  return {
    server,
    runtime,
    listen: (port = options.port ?? 8787, host = options.host ?? '127.0.0.1') => new Promise<{ port: number; host: string }>((resolveAddress, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        server.removeListener('error', reject)
        const address = server.address()
        resolveAddress({ port: typeof address === 'object' && address ? address.port : port, host: typeof address === 'object' && address ? address.address : host })
      })
    }),
    close: () => new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())),
  }
}
