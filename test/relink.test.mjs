import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sdk = await import(pathToFileURL(resolve(root, 'dist/sdk/index.js')).href)
const { createApiServer } = await import(pathToFileURL(resolve(root, 'dist/api/server.js')).href)
const { createMcpServer } = await import(pathToFileURL(resolve(root, 'dist/mcp/server.js')).href)
const execFileAsync = promisify(execFile)

const records = [
  { id: '1', from: 'alice', to: 'bob', timestamp: '2025-01-01T10:00:00Z', kind: 'message', text: 'Thanks, this is great!' },
  { id: '2', from: 'bob', to: 'alice', timestamp: '2025-01-01T11:00:00Z', kind: 'message', text: 'I agree and will help.' },
  { id: '3', from: 'alice', to: 'bob', timestamp: '2025-01-08T10:00:00Z', kind: 'meeting', text: 'Let us review the plan.' },
  { id: '4', from: 'bob', to: 'alice', timestamp: '2025-01-08T12:00:00Z', kind: 'message', text: 'The plan looks good.' },
]

async function createTestDataDir(prefix) {
  return mkdtemp(resolve(tmpdir(), `${prefix}-`))
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return (await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : entry.name.endsWith('.ts') ? [path] : []
  }))).flat()
}

test('runtime source has no absolute, native-module or application-shell coupling', async () => {
  const forbidden = /(?:^|[\s'"`(])[a-z]:[\\/]|\.dll\b|\.node\b|node:(?:child_process|cluster|worker_threads)|\bwindow\.[a-z_$][\w$]*\s*\(/im
  const matches = []
  for (const file of await sourceFiles(resolve(root, 'src'))) {
    const source = await readFile(file, 'utf8')
    if (forbidden.test(source)) matches.push(file)
  }
  assert.deepEqual(matches, [])
})

test('normalizes generic records and exposes stable relation sessions', async () => {
  const dataset = sdk.normalizeDataset(records, { id: 'test', name: 'Test' })
  assert.equal(dataset.entities.length, 2)
  assert.equal(dataset.interactions.length, records.length)
  assert.equal(dataset.interactions[0].actorId, 'alice')
  const dataDir = await createTestDataDir('relink-runtime')
  try {
    const runtime = sdk.createRelink({ dataset, dataDir })
    assert.equal(runtime.getDatasetSummary instanceof Function, true)
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})

test('normalizes delimited participant fields without guessing direction', async () => {
  const dataset = sdk.normalizeDataset([
    { id: 'csv-1', participants: 'team-a;team-b;team-c', timestamp: 1735725600, text: 'shared update' },
  ])
  assert.deepEqual(dataset.interactions[0].participants, ['team-a', 'team-b', 'team-c'])
  assert.equal(dataset.interactions[0].actorId, undefined)
})

test('provider adapter supplies paging, search and pair scope without source-specific code', async () => {
  const dataDir = await createTestDataDir('relink-provider')
  try {
    const runtime = sdk.createRelink({ dataset: records, dataDir })
    const summary = await runtime.getDatasetSummary()
    assert.equal(summary.interactionCount, 4)
    assert.equal(summary.sessionCount, 1)
    const sessions = await runtime.listSessions()
    assert.equal(sessions.sessions.length, 1)
    const searched = await runtime.search({ text: 'plan' })
    assert.equal(searched.messages.length, 2)
    const result = await runtime.dataProvider.getMessages(sessions.sessions[0].username, 0, 2, 0, 0, true)
    assert.equal(result.messages.length, 2)
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})

test('structured participants identify groups without encoding meaning in session IDs', async () => {
  const dataDir = await createTestDataDir('relink-group')
  try {
    const runtime = sdk.createRelink({
      dataset: [{
        id: 'group-event',
        participants: ['alice', 'bob', 'carol'],
        occurredAt: '2025-01-09T10:00:00Z',
        kind: 'meeting',
        content: 'Three-party project review.',
      }],
      dataDir,
    })
    const result = await runtime.listSessions()
    assert.equal(result.sessions.length, 1)
    assert.equal(result.sessions[0].isGroup, true)
    assert.equal(result.sessions[0].type, 2)
    assert.match(result.sessions[0].username, /^rel_[a-f0-9]{16}$/)
    const page = await runtime.dataProvider.getMessages(result.sessions[0].username, 0, 10)
    assert.equal(page.messages[0].senderUsername, '')

    runtime.setDataset([{
      id: 'attributed-group-event',
      participants: ['alice', 'bob', 'carol'],
      actorId: 'bob',
      occurredAt: '2025-01-09T11:00:00Z',
      kind: 'meeting',
      content: 'Bob presents the revised plan.',
    }])
    const attributedSessions = await runtime.listSessions()
    const scanned = []
    await runtime.dataProvider.scanConversationMessagesForAnalysis(
      attributedSessions.sessions[0].username,
      {},
      (batch) => scanned.push(...batch),
    )
    assert.equal(scanned[0].actorId, 'bob')
    assert.equal(scanned[0].senderDisplayName, 'bob')
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})

test('runtime persistence remains isolated through direct conversation and memory facades', async () => {
  const firstDataDir = await createTestDataDir('relink-first-runtime')
  const secondDataDir = await createTestDataDir('relink-second-runtime')
  try {
    const first = sdk.createRelink({ dataset: records, dataDir: firstDataDir })
    const second = sdk.createRelink({ dataset: records, dataDir: secondDataDir })
    first.conversations.create({ title: 'First runtime' })
    second.conversations.create({ title: 'Second runtime' })
    first.memories.create({ content: 'First memory', category: 'preference' })
    second.memories.create({ content: 'Second memory', category: 'preference' })

    assert.deepEqual(first.conversations.list().map((item) => item.title), ['First runtime'])
    assert.deepEqual(second.conversations.list().map((item) => item.title), ['Second runtime'])
    assert.deepEqual(first.memories.list().map((item) => item.content), ['First memory'])
    assert.deepEqual(second.memories.list().map((item) => item.content), ['Second memory'])
  } finally {
    await Promise.all([
      rm(firstDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }),
      rm(secondDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 }),
    ])
  }
})

test('CLI performs conversation and memory CRUD against the selected data directory', async () => {
  const dataDir = await createTestDataDir('relink-cli')
  const cli = resolve(root, 'dist/cli/index.js')
  const invoke = async (...args) => JSON.parse((await execFileAsync(process.execPath, [cli, ...args], { cwd: root })).stdout)
  try {
    const createdConversation = await invoke('conversations', '--action', 'create', '--title', 'CLI conversation', '--data-dir', dataDir)
    assert.equal(createdConversation.conversation.title, 'CLI conversation')
    const conversations = await invoke('conversations', '--action', 'list', '--data-dir', dataDir)
    assert.equal(conversations.conversations.length, 1)

    const createdMemory = await invoke('memory', '--action', 'create', '--content', 'CLI memory', '--category', 'preference', '--data-dir', dataDir)
    assert.equal(createdMemory.memory.content, 'CLI memory')
    const loadedMemory = await invoke('memory', '--action', 'get', '--id', createdMemory.memory.id, '--data-dir', dataDir)
    assert.equal(loadedMemory.memory.id, createdMemory.memory.id)
    const memories = await invoke('memory', '--action', 'list', '--data-dir', dataDir)
    assert.equal(memories.memories.length, 1)
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})

test('API exposes runtime dataset, session, search and run state endpoints', async () => {
  const dataDir = await createTestDataDir('relink-api')
  const api = createApiServer({ dataset: records, dataDir })
  const address = await api.listen(0)
  try {
    const base = `http://${address.host}:${address.port}`
    assert.equal((await fetch(`${base}/v1/health`).then((response) => response.json())).runtime, 'relink-runtime')
    assert.equal((await fetch(`${base}/v1/dataset/summary`).then((response) => response.json())).interactionCount, 4)
    assert.equal((await fetch(`${base}/v1/sessions`).then((response) => response.json())).sessions.length, 1)
    const searchResponse = await fetch(`${base}/v1/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'plan' }) })
    assert.equal((await searchResponse.json()).messages.length, 2)
    const createdConversation = await fetch(`${base}/v1/conversations`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'API conversation', scope: { kind: 'global' } }) }).then((response) => response.json())
    assert.equal(createdConversation.conversation.title, 'API conversation')
    assert.equal((await fetch(`${base}/v1/conversations`).then((response) => response.json())).conversations.length, 1)
    const createdMemory = await fetch(`${base}/v1/memories`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'Prefer concise evidence tables', category: 'preference' }) }).then((response) => response.json())
    assert.equal(createdMemory.memory.content, 'Prefer concise evidence tables')
    assert.equal((await fetch(`${base}/v1/memories/${createdMemory.memory.id}`).then((response) => response.json())).id, createdMemory.memory.id)
    assert.equal((await fetch(`${base}/v1/memories`).then((response) => response.json())).memories.length, 1)
    const feedback = await fetch(`${base}/v1/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: 'answer-api-1', rating: 'up', reason: 'evidence' }) }).then((response) => response.json())
    assert.equal(feedback.feedback.rating, 'up')
    const title = await fetch(`${base}/v1/title`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Review changes in project collaboration' }) }).then((response) => response.json())
    assert.ok(title.title)
    const runResponse = await fetch(`${base}/v1/analyze`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'test without model' }) })
    assert.equal(runResponse.status, 400)
    assert.match((await runResponse.json()).error, /API Key|model/i)
  } finally {
    await api.close()
    await rm(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})

test('MCP exposes the complete runtime tool surface', async () => {
  const dataDir = await createTestDataDir('relink-mcp')
  try {
    const server = createMcpServer({ dataset: records, dataDir })
    const initialized = JSON.parse(await server.handle({ id: 1, method: 'initialize' }))
    assert.equal(initialized.result.serverInfo.name, 'relink')
    const listed = JSON.parse(await server.handle({ id: 2, method: 'tools/list' }))
    const names = listed.result.tools.map((tool) => tool.name)
  assert.ok(names.includes('relink_run'))
  assert.ok(names.includes('relink_abort'))
  assert.ok(names.includes('relink_memory'))
  assert.ok(names.includes('relink_conversations'))
  assert.ok(names.includes('relink_feedback'))
  assert.ok(names.includes('relink_title'))
    const summary = JSON.parse(await server.handle({ id: 3, method: 'tools/call', params: { name: 'relink_dataset_summary', arguments: {} } }))
    assert.equal(summary.result.structuredContent.interactionCount, 4)
    const conversation = JSON.parse(await server.handle({ id: 4, method: 'tools/call', params: { name: 'relink_conversations', arguments: { action: 'create', title: 'MCP conversation' } } }))
    assert.equal(conversation.result.structuredContent.conversation.title, 'MCP conversation')
    const memory = JSON.parse(await server.handle({ id: 5, method: 'tools/call', params: { name: 'relink_memory', arguments: { action: 'create', content: 'MCP memory', category: 'preference' } } }))
    assert.equal(memory.result.structuredContent.memory.content, 'MCP memory')
    const loadedMemory = JSON.parse(await server.handle({ id: 6, method: 'tools/call', params: { name: 'relink_memory', arguments: { action: 'get', id: memory.result.structuredContent.memory.id } } }))
    assert.equal(loadedMemory.result.structuredContent.memory.id, memory.result.structuredContent.memory.id)
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})

test('complete model-led Agent runs through an OpenAI-compatible stream and persists state', async () => {
  const dataDir = await mkdtemp(resolve(tmpdir(), 'relink-e2e-'))
  const modelServer = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    assert.equal(request.url, '/v1/chat/completions')
    assert.ok(Array.isArray(input.tools))
    const id = `mock-${Date.now()}`
    const model = input.model || 'mock-model'
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' })
    const emit = (value) => response.write(`data: ${JSON.stringify(value)}\n\n`)
    emit({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: { role: 'assistant', content: 'Test answer: evidence review complete.' }, finish_reason: null }] })
    emit({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 18, total_tokens: 138 } })
    response.end('data: [DONE]\n\n')
  })
  await new Promise((resolveListen) => modelServer.listen(0, '127.0.0.1', resolveListen))
  try {
    const port = modelServer.address().port
    const agent = sdk.createRelink({
      dataset: records,
      dataDir,
      modelConfig: { protocol: 'openai-compatible', provider: 'test-provider', apiKey: 'test-key', baseURL: `http://127.0.0.1:${port}/v1`, model: 'test-model' },
    })
    const result = await agent.run({ prompt: 'Give a concise answer.', mode: 'standard', memorySynthesis: false })
    assert.equal(result.state.status, 'completed')
    assert.equal(result.answer, 'Test answer: evidence review complete.')
    assert.ok(result.chunks.some((chunk) => chunk !== '[DONE]' && chunk.type === 'text-delta'))
    assert.ok(result.state.research)
    assert.ok(agent.loadRun(result.runId))
  } finally {
    await new Promise((resolveClose) => modelServer.close(resolveClose))
    await rm(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})

test('model-led loop can request a capability, read a provider page, then answer', async () => {
  const dataDir = await mkdtemp(resolve(tmpdir(), 'relink-tools-'))
  const modelServer = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    modelServer.requests ||= []
    modelServer.requests.push(input)
    const step = modelServer.requestCount || 0
    modelServer.requestCount = step + 1
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
    const emit = (value) => response.write(`data: ${JSON.stringify(value)}\n\n`)
    const id = `tool-mock-${step}`
    const serializedInput = JSON.stringify(input)
    const availableToolNames = (input.tools || []).map((entry) => entry.function?.name)
    const modelSawManifest = serializedInput.includes('alice + bob + carol')
    const choice = modelSawManifest
      ? { index: 0, delta: { role: 'assistant', content: 'Relationship catalog reviewed.' }, finish_reason: 'stop' }
      : availableToolNames.includes('list_conversation_manifest')
        ? { index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `manifest-${step}`, type: 'function', function: { name: 'list_conversation_manifest', arguments: '{"limit":10}' } }] }, finish_reason: 'tool_calls' }
        : { index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: `request-tools-${step}`, type: 'function', function: { name: 'request_tools', arguments: '{"tools":["list_conversation_manifest"]}' } }] }, finish_reason: 'tool_calls' }
    emit({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: input.model || 'tool-model', choices: [choice] })
    emit({ id, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: input.model || 'tool-model', choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }], usage: { prompt_tokens: 180, completion_tokens: 24, total_tokens: 204 } })
    response.end('data: [DONE]\n\n')
  })
  await new Promise((resolveListen) => modelServer.listen(0, '127.0.0.1', resolveListen))
  try {
    const port = modelServer.address().port
    const agent = sdk.createRelink({
      dataset: [
        ...records,
        {
          id: 'group-tool-event',
          participants: ['alice', 'bob', 'carol'],
          actorId: 'carol',
          occurredAt: '2025-01-09T10:00:00Z',
          kind: 'meeting',
          content: 'Team review.',
        },
      ],
      dataDir,
      modelConfig: { protocol: 'openai-compatible', provider: 'tool-provider', apiKey: 'test-key', baseURL: `http://127.0.0.1:${port}/v1`, model: 'tool-model' },
    })
    const result = await agent.run({ prompt: 'Read the catalog before answering.', mode: 'standard', memorySynthesis: false })
    assert.equal(result.answer, 'Relationship catalog reviewed.')
    assert.deepEqual(result.state.toolCalls.map((call) => call.toolName), ['request_tools', 'list_conversation_manifest'])
    assert.equal(result.state.toolCalls[1].status, 'completed')
    assert.equal(result.state.toolCalls[1].outputSummary.sessionCount, 2)
    assert.ok(modelServer.requestCount >= 3)
    const modelSawManifest = JSON.stringify(modelServer.requests)
    assert.match(modelSawManifest, /alice \+ bob \+ carol/)
  } finally {
    await new Promise((resolveClose) => modelServer.close(resolveClose))
    await rm(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})

test('completed runs keep the answer when the automatic memory pass succeeds', async () => {
  const dataDir = await mkdtemp(resolve(tmpdir(), 'relink-memory-'))
  const modelServer = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    const input = JSON.parse(body)
    const isMemoryPrompt = !Array.isArray(input.tools)
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
    const emit = (value) => response.write(`data: ${JSON.stringify(value)}\n\n`)
    const content = isMemoryPrompt ? '<memory_patch>[]</memory_patch>' : 'Primary answer complete.'
    const finishReason = 'stop'
    emit({ id: `memory-${Date.now()}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: input.model || 'memory-model', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })
    emit({ id: `memory-${Date.now()}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: input.model || 'memory-model', choices: [{ index: 0, delta: {}, finish_reason: finishReason }], usage: { prompt_tokens: 80, completion_tokens: 8, total_tokens: 88 } })
    response.end('data: [DONE]\n\n')
  })
  await new Promise((resolveListen) => modelServer.listen(0, '127.0.0.1', resolveListen))
  try {
    const port = modelServer.address().port
    const agent = sdk.createRelink({ dataset: records, dataDir, modelConfig: { protocol: 'openai-compatible', provider: 'memory-provider', apiKey: 'test-key', baseURL: `http://127.0.0.1:${port}/v1`, model: 'memory-model' } })
    const result = await agent.run({ prompt: 'Answer and synthesize memory.', mode: 'standard' })
    assert.equal(result.answer, 'Primary answer complete.')
    assert.equal(result.memory?.success, true)
    assert.equal(result.memory?.changed, false)
    assert.equal(result.chunks.at(-1), '[DONE]')
    assert.equal(result.progress.at(-1).category, 'memory')
    assert.equal(agent.getMemorySummary().enabled, true)
  } finally {
    await new Promise((resolveClose) => modelServer.close(resolveClose))
    await rm(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})

test('sample dataset remains importable through the generic loader', async () => {
  const sample = JSON.parse(await readFile(resolve(root, 'examples/sample.json'), 'utf8'))
  const dataDir = await createTestDataDir('relink-sample')
  try {
    const runtime = sdk.createRelink({ dataset: sample, dataDir })
    assert.equal((await runtime.getDatasetSummary()).interactionCount, 12)
  } finally {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 })
  }
})
