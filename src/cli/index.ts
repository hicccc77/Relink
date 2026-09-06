#!/usr/bin/env node
import { resolve } from 'node:path'
import { writeFileSync } from 'node:fs'
import { createApiServer } from '../api/server.js'
import { createMcpServer, startMcpStdio } from '../mcp/server.js'
import { createRelink, modelConfigFromEnvironment, type AgentModelConfig } from '../sdk/index.js'
import { loadDatasetFromFile } from '../ingestion/normalize.js'

type Flags = Record<string, string | boolean>

function parseFlags(values: string[]): Flags {
  const flags: Flags = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value?.startsWith('--')) continue
    const token = value.slice(2)
    const equals = token.indexOf('=')
    if (equals >= 0) { flags[token.slice(0, equals)] = token.slice(equals + 1); continue }
    const next = values[index + 1]
    if (next && !next.startsWith('--')) { flags[token] = next; index += 1 } else flags[token] = true
  }
  return flags
}

function flag(flags: Flags, name: string): string | undefined {
  const value = flags[name]
  return typeof value === 'string' ? value : undefined
}

function boolFlag(flags: Flags, name: string): boolean {
  return flags[name] === true || flag(flags, name) === 'true'
}

function jsonObjectFlag(flags: Flags, name: string): Record<string, unknown> {
  const value = flag(flags, name)
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch { /* Report one stable CLI validation message below. */ }
  throw new Error(`--${name} must be a JSON object`)
}

function requiredNumberFlag(flags: Flags, name: string): number {
  const value = Number(flag(flags, name))
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`)
  return value
}

function requiredFlag(flags: Flags, name: string): string {
  const value = flag(flags, name)
  if (!value) throw new Error(`Missing required option --${name}`)
  return value
}

function modelConfig(flags: Flags): AgentModelConfig {
  return modelConfigFromEnvironment({
    ...(flag(flags, 'provider') ? { provider: flag(flags, 'provider') } : {}),
    ...(flag(flags, 'protocol') ? { protocol: flag(flags, 'protocol') as AgentModelConfig['protocol'] } : {}),
    ...(flag(flags, 'api-key') ? { apiKey: flag(flags, 'api-key') } : {}),
    ...(flag(flags, 'base-url') ? { baseURL: flag(flags, 'base-url') } : {}),
    ...(flag(flags, 'model') ? { model: flag(flags, 'model') } : {}),
    ...(flag(flags, 'reasoning-effort') ? { reasoningEffort: flag(flags, 'reasoning-effort') as AgentModelConfig['reasoningEffort'] } : {}),
    ...(flag(flags, 'context-window') ? { contextWindow: Number(flag(flags, 'context-window')) } : {}),
    ...(flag(flags, 'max-output-tokens') ? { maxOutputTokens: Number(flag(flags, 'max-output-tokens')) } : {}),
  })
}

function printHelp(): void {
  process.stdout.write(`Relink 0.1.0\n\nUsage:\n  relink run --file data.json --prompt "Question" [options]\n  relink import --file raw.json --out dataset.json\n  relink summary --file dataset.json\n  relink search --file dataset.json --text "keyword"\n  relink serve --file dataset.json [--host 127.0.0.1 --port 8787]\n  relink mcp --file dataset.json\n  relink runs --data-dir .relink\n  relink replay --run-id <id>\n  relink abort --run-id <id>\n  relink conversations --action <list|get|create|save|rename|metadata|delete>\n  relink memory --action <list|get|summary|create|update|delete|revise|refresh|enable|clear>\n  relink title --text "First conversation message"\n  relink feedback --action <list|save|delete|summary|synthesize>\n\nRun options:\n  --entity-a <id>       First entity in a pair scope\n  --entity-b <id>       Second entity in a pair scope\n  --question <text>     Alias for --prompt\n  --mode <standard|deep-research>\n  --resume-from <id>    Continue from a stored run\n  --memory-synthesis <bool> Run post-answer memory synthesis\n  --json                Print the complete result, including chunks, progress, and state\n  --model <id>          Override the model; related model options are also available\n\nModel configuration defaults to RELINK_MODEL_* environment variables.\nUse --payload '{"field":"value"}' for structured conversation and memory fields.\nSee README.md and docs/ for the Runtime, Provider, HTTP API, MCP, and optional Skill.\n`)
}

function runScope(flags: Flags): Record<string, unknown> | undefined {
  const entityA = flag(flags, 'entity-a')
  const entityB = flag(flags, 'entity-b')
  if (!entityA && !entityB) return undefined
  return { ...(entityA ? { entityA } : {}), ...(entityB ? { entityB } : {}) }
}

async function runCommand(flags: Flags): Promise<void> {
  const file = flag(flags, 'file')
  const prompt = flag(flags, 'prompt') || flag(flags, 'question')
  if (!file) throw new Error('run requires --file')
  if (!prompt) throw new Error('run requires --prompt or --question')
  const runtime = createRelink({ datasetFile: resolve(file), dataDir: flag(flags, 'data-dir'), modelConfig: modelConfig(flags) })
  const json = boolFlag(flags, 'json')
  const result = await runtime.run({
    prompt,
    scope: runScope(flags),
    mode: flag(flags, 'mode') as 'standard' | 'deep-research' | undefined,
    resumeFromRunId: flag(flags, 'resume-from'),
    ...(flags['memory-synthesis'] !== undefined ? { memorySynthesis: boolFlag(flags, 'memory-synthesis') } : {}),
    onProgress: json ? undefined : (event) => process.stderr.write(`[${event.stage}] ${event.title}${event.detail ? `：${event.detail}` : ''}\n`),
  })
  if (json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  else process.stdout.write(`${result.answer}\n\nrunId: ${result.runId}\n`)
}

async function importCommand(flags: Flags): Promise<void> {
  const file = flag(flags, 'file')
  const out = flag(flags, 'out')
  if (!file || !out) throw new Error('import requires --file and --out')
  const dataset = loadDatasetFromFile(resolve(file), { sourceName: file })
  writeFileSync(resolve(out), `${JSON.stringify(dataset, null, 2)}\n`, 'utf8')
  process.stdout.write(`Wrote ${resolve(out)} with ${dataset.entities.length} entities and ${dataset.interactions.length} interactions.\n`)
}

async function summaryCommand(flags: Flags): Promise<void> {
  const file = flag(flags, 'file')
  if (!file) throw new Error('summary requires --file')
  const runtime = createRelink({ datasetFile: resolve(file) })
  process.stdout.write(`${JSON.stringify(await runtime.getDatasetSummary(), null, 2)}\n`)
}

async function searchCommand(flags: Flags): Promise<void> {
  const file = flag(flags, 'file')
  if (!file) throw new Error('search requires --file')
  const runtime = createRelink({ datasetFile: resolve(file) })
  const result = await runtime.search({ text: flag(flags, 'text') || flag(flags, 'query') || '', sessionId: flag(flags, 'session-id'), limit: Number(flag(flags, 'limit') || 50), offset: Number(flag(flags, 'offset') || 0), from: flag(flags, 'from'), to: flag(flags, 'to') })
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

async function serveCommand(flags: Flags): Promise<void> {
  const file = flag(flags, 'file')
  const api = createApiServer({
    ...(file ? { datasetFile: resolve(file) } : {}),
    dataDir: flag(flags, 'data-dir'),
    modelConfig: modelConfig(flags),
    host: flag(flags, 'host') || process.env.RELINK_HOST || '127.0.0.1',
    port: Number(flag(flags, 'port') || process.env.RELINK_PORT || 8787),
  })
  const address = await api.listen()
  process.stdout.write(`Relink API listening at http://${address.host}:${address.port}\n`)
  const shutdown = async () => { await api.close().catch(() => {}); process.exit(0) }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  await new Promise<void>(() => {})
}

async function mcpCommand(flags: Flags): Promise<void> {
  const file = flag(flags, 'file')
  await startMcpStdio(createMcpServer({ ...(file ? { datasetFile: resolve(file) } : {}), dataDir: flag(flags, 'data-dir'), modelConfig: modelConfig(flags) }))
}

async function runsCommand(flags: Flags): Promise<void> {
  const runtime = createRelink({ dataDir: flag(flags, 'data-dir'), modelConfig: modelConfig(flags) })
  process.stdout.write(`${JSON.stringify(runtime.listRuns(Number(flag(flags, 'limit') || 100)), null, 2)}\n`)
}

async function replayCommand(flags: Flags): Promise<void> {
  const runId = flag(flags, 'run-id')
  if (!runId) throw new Error('replay requires --run-id')
  const runtime = createRelink({ dataDir: flag(flags, 'data-dir'), modelConfig: modelConfig(flags) })
  process.stdout.write(`${JSON.stringify(await runtime.replay(runId), null, 2)}\n`)
}

async function abortCommand(flags: Flags): Promise<void> {
  const runId = flag(flags, 'run-id')
  if (!runId) throw new Error('abort requires --run-id')
  const runtime = createRelink({ dataDir: flag(flags, 'data-dir'), modelConfig: modelConfig(flags) })
  process.stdout.write(`${JSON.stringify({ runId, aborted: runtime.abort(runId) }, null, 2)}\n`)
}

async function conversationsCommand(flags: Flags): Promise<void> {
  const runtime = createRelink({ dataDir: flag(flags, 'data-dir'), modelConfig: modelConfig(flags) })
  const action = flag(flags, 'action') || 'list'
  const payload = jsonObjectFlag(flags, 'payload')
  let value: unknown
  if (action === 'list') value = { conversations: runtime.listConversations(payload.scope as any) }
  else if (action === 'create') value = { conversation: runtime.createConversation({ ...payload, ...(flag(flags, 'title') ? { title: flag(flags, 'title') } : {}) }) }
  else {
    const id = requiredNumberFlag(flags, 'id')
    if (action === 'get') value = { conversation: runtime.loadConversation(id) }
    else if (action === 'save') value = { conversation: runtime.saveConversation({ ...payload, id }) }
    else if (action === 'rename') value = { conversation: runtime.renameConversation(id, flag(flags, 'title') || String(payload.title || '')) }
    else if (action === 'metadata') value = { conversation: runtime.updateConversationMetadata(id, { pinned: flags.pinned !== undefined ? boolFlag(flags, 'pinned') : payload.pinned === true }) }
    else if (action === 'delete') value = { deleted: runtime.deleteConversation(id) }
    else throw new Error(`Unknown conversations action: ${action}`)
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function memoryCommand(flags: Flags): Promise<void> {
  const runtime = createRelink({ dataDir: flag(flags, 'data-dir'), modelConfig: modelConfig(flags) })
  const action = flag(flags, 'action') || 'summary'
  const payload = jsonObjectFlag(flags, 'payload')
  let value: unknown
  if (action === 'list') value = { memories: runtime.listMemories({ query: flag(flags, 'query'), includeArchived: boolFlag(flags, 'include-archived') }) }
  else if (action === 'get') value = { memory: runtime.loadMemory(requiredFlag(flags, 'id')) }
  else if (action === 'summary') value = { summary: runtime.getMemorySummary() }
  else if (action === 'create') value = { memory: runtime.createMemory({ ...payload, content: flag(flags, 'content') || payload.content, category: flag(flags, 'category') || payload.category }) }
  else if (action === 'update') value = { memory: runtime.updateMemory(requiredFlag(flags, 'id'), { ...payload, ...(flag(flags, 'content') ? { content: flag(flags, 'content') } : {}), ...(flag(flags, 'category') ? { category: flag(flags, 'category') } : {}) }) }
  else if (action === 'delete') value = { deleted: runtime.deleteMemory(requiredFlag(flags, 'id')) }
  else if (action === 'revise') value = await runtime.reviseMemory(flag(flags, 'instruction') || '')
  else if (action === 'refresh') value = await runtime.refreshMemory()
  else if (action === 'enable') value = { summary: runtime.setMemoryEnabled(boolFlag(flags, 'enabled')) }
  else if (action === 'clear') value = { summary: runtime.clearMemory({ disable: boolFlag(flags, 'disable') }) }
  else throw new Error(`Unknown memory action: ${action}`)
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function titleCommand(flags: Flags): Promise<void> {
  const value = flag(flags, 'text') || flag(flags, 'first-message')
  if (!value) throw new Error('title requires --text')
  const runtime = createRelink({ dataDir: flag(flags, 'data-dir'), modelConfig: modelConfig(flags) })
  process.stdout.write(`${JSON.stringify(await runtime.generateTitle(value), null, 2)}\n`)
}

async function feedbackCommand(flags: Flags): Promise<void> {
  const runtime = createRelink({ dataDir: flag(flags, 'data-dir'), modelConfig: modelConfig(flags) })
  const action = flag(flags, 'action') || 'list'
  let value: unknown
  if (action === 'list') value = { feedback: runtime.listFeedback(Number(flag(flags, 'limit') || 500)) }
  else if (action === 'summary') value = { summary: runtime.feedbackSummary(Number(flag(flags, 'conversation-id') || 0) || null) }
  else if (action === 'delete') value = { deleted: runtime.deleteFeedback(flag(flags, 'message-id') || '') }
  else if (action === 'synthesize') value = await runtime.synthesizeMemoryFromFeedback()
  else if (action === 'save') {
    const rating = flag(flags, 'rating')
    if (rating !== 'up' && rating !== 'down') throw new Error('feedback save requires --rating up|down')
    value = { feedback: runtime.saveFeedback({
      messageId: flag(flags, 'message-id') || '',
      runId: flag(flags, 'run-id'),
      conversationId: Number(flag(flags, 'conversation-id') || 0) || undefined,
      rating,
      reason: flag(flags, 'reason') as any,
      answer: flag(flags, 'answer'),
    }) }
  } else throw new Error(`Unknown feedback action: ${action}`)
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function main(): Promise<void> {
  const [command = 'help', ...values] = process.argv.slice(2)
  const flags = parseFlags(values)
  if (command === 'help' || command === '--help' || command === '-h') return printHelp()
  if (command === 'run' || command === 'analyze') return runCommand(flags)
  if (command === 'import') return importCommand(flags)
  if (command === 'summary') return summaryCommand(flags)
  if (command === 'search') return searchCommand(flags)
  if (command === 'serve') return serveCommand(flags)
  if (command === 'mcp') return mcpCommand(flags)
  if (command === 'runs') return runsCommand(flags)
  if (command === 'replay') return replayCommand(flags)
  if (command === 'abort') return abortCommand(flags)
  if (command === 'conversations') return conversationsCommand(flags)
  if (command === 'memory' || command === 'memories') return memoryCommand(flags)
  if (command === 'title') return titleCommand(flags)
  if (command === 'feedback') return feedbackCommand(flags)
  throw new Error(`Unknown command: ${command}`)
}

main().catch((error) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
