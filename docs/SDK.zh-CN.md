# SDK

[English](SDK.md) | [简体中文](SDK.zh-CN.md)

## 创建 Runtime

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

`createRelink` 返回完整的 `RelinkRuntime`。

同一个持久化目录服务多个租户时，应为每个租户设置稳定且不含明文身份信息的 `ownerFingerprint`；数据版本变化时更新 `sourceFingerprint`。Runtime 还会根据内置 Dataset 计算 `datasetFingerprint`。三者共同限制续跑和缓存复用范围。

需要原文页磁盘缓存时应提供 `cacheEncryptionSecret`；没有密钥时不会将原文页写入磁盘缓存。

## 运行与流式事件

```ts
const result = await agent.run({
  prompt: '哪些时期出现可验证的互动变化？',
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

`chunks` 是 AI SDK `UIMessageChunk` 序列，包括 `start`、文本增量、工具调用与结果、`finish` 和最终 `[DONE]`。`progress` 是结构化阶段事件。`state` 是持久化的 `AgentRunSnapshot`，包含工具调用、研究页、来源发现、token 使用、停止原因和恢复信息。

`messages` 可以传入标准 AI SDK UI messages。如果同时传入 `prompt`，prompt 会追加为最后一条 user 消息。

`scope` 支持：

- `{ kind: 'global', filters?: { datePreset, startDate, endDate, source, targetSessions } }`
- `{ kind: 'session', sessionId, displayName?, filters? }`
- 实体对简写 `{ entityA, entityB }`，由 Provider 解析为稳定 session

`mode: 'standard'` 适合较短问题；`deep-research` 启用完整计划、跨期阅读和研究反馈循环。

## 自定义 Provider

直接实现 `RelinkDataProvider`：

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

Provider 的每条记录至少应提供：

- `content`、`parsedContent` 和 `rawContent`
- Unix 秒格式的 `createTime`
- `localId`、`sortSeq` 和稳定的 `messageKey`

如果数据中有明确发起者，请提供 `senderUsername` 和可选的 `senderDisplayName`。缺失时 Agent 保持参与者未解析状态，不猜测作者。

可选的 `getVoiceTranscript`、`getImageData`、`getTimeline`、`downloadImage` 和 `searchWeb` 会启用对应工具。未实现的能力会返回不可用结果。

Provider 必须只返回调用者有权访问的数据，并在查询层实施租户与权限校验。Runtime 的所有数据读取都通过 Provider 完成。

## 更换数据

```ts
agent.setDataset(nextDataset)
agent.setDataProvider(nextProvider)

const dataset = await agent.getDataset()
const summary = await agent.getDatasetSummary()
const sessions = await agent.listSessions()
const matches = await agent.search({ text: 'deadline', limit: 20 })
```

`setDataset` 会创建新的 `DatasetProvider`。`setDataProvider` 适用于自定义实时数据实现。

## 续跑、中止与重放

```ts
const continued = await agent.run({
  prompt: '继续核验上次尚未完成的结论',
  resumeFromRunId: previousRunId,
})

agent.abort(continued.runId)
const runs = agent.listRuns()
const snapshot = agent.loadRun(continued.runId)
const replay = await agent.replay(completedRunId)
```

续跑会校验问题、范围、数据指纹、提示版本和模型上下文兼容性。数据版本变化后，不会复用不匹配的证据。重放返回已完成快照中的回答和证据摘要，不重新调用模型。

## 记忆、对话与反馈

Agent 内部的 `remember`、`forget` 和 `read_memory` 工具通过事务和摘要重建逻辑操作 Runtime 的 `dataDir`。

运行完成后，Runtime 默认调用一次记忆增量整理。设置 `memorySynthesis: false` 可以关闭单次整理。也可以显式管理生命周期：

```ts
const title = await agent.generateTitle('用户的第一条消息')
const summary = agent.getMemorySummary()
const memories = agent.listMemories()
const memory = memories[0] ? agent.loadMemory(memories[0].id) : null

await agent.reviseMemory('只保留我明确表达的输出格式偏好')
await agent.refreshMemory()

agent.saveFeedback({
  messageId: 'answer-1',
  runId: result.runId,
  rating: 'up',
  reason: 'evidence',
})
await agent.synthesizeMemoryFromFeedback()
```

对话方法包括 `listConversations`、`loadConversation`、`createConversation`、`saveConversation`、`renameConversation`、`updateConversationMetadata` 和 `deleteConversation`。它们与运行快照共享 `dataDir`，并通过运行上下文隔离并行实例。

## 模型协议

`AgentModelConfig` 支持：

| `protocol` | 必填字段 |
| --- | --- |
| `openai-compatible` | `baseURL`、`apiKey`、`model` |
| `openai-responses` | `baseURL`、`apiKey`、`model` |
| `anthropic` | `baseURL`、`apiKey`、`model` |
| `google` | `baseURL`、`apiKey`、`model` |

还可以设置 `reasoningEffort`、`contextWindow` 和 `maxOutputTokens`。提示缓存状态和 Provider token 使用量会写入运行研究轨迹。
