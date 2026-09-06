# SDK

[English](SDK.md) | [Simplified Chinese](SDK.zh-CN.md)

## Create a Runtime

```ts
import { createRelink } from 'relink'

const agent = createRelink({
  datasetFile: './sample.json',
  dataDir: './.relink',
  ownerFingerprint: 'tenant-or-user-stable-id',
  sourceFingerprint: 'source-snapshot-or-revision',
  cacheEncryptionSecret: process.env.RELINK_CACHE_SECRET,
  modelConfig: {
    protocol: 'openai-compatible',
    provider: 'openai-compatible',
    baseURL: process.env.RELINK_MODEL_BASE_URL,
    apiKey: process.env.RELINK_MODEL_API_KEY,
    model: process.env.RELINK_MODEL,
  },
})
```

`createRelink` returns a complete `RelinkRuntime`.

When multiple tenants share a persistence root, assign a stable `ownerFingerprint` that contains no plaintext identity information. Update `sourceFingerprint` whenever the data revision changes. The Runtime also computes `datasetFingerprint` for built-in datasets. Together, these values constrain run resumption and cache reuse.

Provide `cacheEncryptionSecret` when raw-page disk caching is required. Without a secret, raw pages are not written to the disk cache.

## Run and Stream Events

```ts
const result = await agent.run({
  prompt: 'Which periods show verifiable changes in interaction?',
  scope: { kind: 'global' },
  mode: 'deep-research',
  memorySynthesis: true,
  onProgress: (event) => console.error(event.stage, event.title, event.detail),
  onChunk: (chunk) => console.log(chunk),
})

console.log(result.runId)
console.log(result.answer)
console.log(result.state?.research)
console.log(result.memory?.summary)
```

`chunks` is a sequence of AI SDK `UIMessageChunk` values: `start`, text deltas, tool calls and results, `finish`, and final `[DONE]`. `progress` contains structured phase events. `state` is the persisted `AgentRunSnapshot`, including tool calls, research pages, source findings, token usage, stop reason, and recovery information.

`messages` accepts standard AI SDK UI messages. If `prompt` is also present, it is appended as the final user message.

Supported `scope` forms:

- `{ kind: 'global', filters?: { datePreset, startDate, endDate, source, targetSessions } }`
- `{ kind: 'session', sessionId, displayName?, filters? }`
- Pair shorthand `{ entityA, entityB }`, resolved to a stable session by the Provider

Use `mode: 'standard'` for focused questions. `deep-research` enables the full plan, cross-period reading, and research-feedback loop.

## Custom Provider

Implement `RelinkDataProvider` directly:

```ts
import { createRelink } from 'relink'

const provider = {
  async connect() { return { success: true } },
  async getSessions() { return { success: true, sessions: await source.listRelationSessions() } },
  async getSessionDetail(id) { return { success: true, detail: await source.sessionDetail(id) } },
  async getMessages(id, offset, limit, begin, end, ascending) {
    return source.pageRecords(id, { offset, limit, begin, end, ascending })
  },
  async getMessagesAround(id, target, count) { return source.recordsAround(id, target, count) },
  async getMessageWindowForJump(id, target, count) { return source.recordWindow(id, target, count) },
  async getMessageDateCounts(id) { return { success: true, counts: await source.dateCounts(id) } },
  async scanConversationMessagesForAnalysis(id, options, onBatch) {
    return source.scanRecords(id, options, onBatch)
  },
  async searchMessages(query, id, limit, offset, begin, end) {
    return source.searchRecords(query, { id, limit, offset, begin, end })
  },
  async getDatasetSummary() { return source.summary() },
}

const agent = createRelink({ dataProvider: provider, modelConfig })
```

Each Provider record should include:

- `content`, `parsedContent`, and `rawContent`
- `createTime` in Unix seconds
- `localId`, `sortSeq`, and a stable `messageKey`

When the data contains an explicit actor, provide `senderUsername` and optionally `senderDisplayName`. If actor information is absent, the Agent keeps it unresolved and does not infer authorship.

Optional methods `getVoiceTranscript`, `getImageData`, `getTimeline`, `downloadImage`, and `searchWeb` enable their corresponding tools. An omitted method produces an explicit unavailable-capability result.

The Provider must return only data the caller is authorized to access and enforce tenant and permission checks in its query layer. All Runtime data reads go through the Provider.

## Replace Data at Runtime

```ts
agent.setDataset(nextDataset)
agent.setDataProvider(nextProvider)

const dataset = await agent.getDataset()
const summary = await agent.getDatasetSummary()
const sessions = await agent.listSessions()
const matches = await agent.search({ text: 'deadline', limit: 20 })
```

`setDataset` creates a new `DatasetProvider`. Use `setDataProvider` for a custom live data implementation.

## Resume, Abort, and Replay

```ts
const continued = await agent.run({
  prompt: 'Continue checking the unresolved findings',
  resumeFromRunId: previousRunId,
})

agent.abort(continued.runId)
const runs = agent.listRuns()
const snapshot = agent.loadRun(continued.runId)
const replay = await agent.replay(completedRunId)
```

Resume checks the request, scope, data fingerprints, prompt version, and model-context compatibility. A changed data revision cannot reuse mismatched evidence. Replay returns the stored answer and evidence summary without calling a model.

## Memory, Conversations, and Feedback

Internal Agent tools `remember`, `forget`, and `read_memory` operate on the Runtime's `dataDir` through transactional updates and summary rebuilding.

The Runtime performs incremental memory synthesis after a completed run by default. Set `memorySynthesis: false` to disable it for one run. The lifecycle is also available explicitly:

```ts
const title = await agent.generateTitle('The first user message')
const summary = agent.getMemorySummary()
const memories = agent.listMemories()
const memory = memories[0] ? agent.loadMemory(memories[0].id) : null

await agent.reviseMemory('Keep only output-format preferences I stated explicitly')
await agent.refreshMemory()

agent.saveFeedback({
  messageId: 'answer-1',
  runId: result.runId,
  rating: 'up',
  reason: 'evidence',
})
await agent.synthesizeMemoryFromFeedback()
```

Conversation methods are `listConversations`, `loadConversation`, `createConversation`, `saveConversation`, `renameConversation`, `updateConversationMetadata`, and `deleteConversation`. They share `dataDir` with run snapshots and remain isolated across concurrent Runtime instances.

## Model Protocols

`AgentModelConfig` supports:

| `protocol` | Required fields |
| --- | --- |
| `openai-compatible` | `baseURL`, `apiKey`, `model` |
| `openai-responses` | `baseURL`, `apiKey`, `model` |
| `anthropic` | `baseURL`, `apiKey`, `model` |
| `google` | `baseURL`, `apiKey`, `model` |

Optional fields are `reasoningEffort`, `contextWindow`, and `maxOutputTokens`. Prompt-cache state and Provider token usage are recorded in the run's research trace.
