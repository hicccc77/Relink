# ReLink

[English](README.md) | [简体中文](README.zh-CN.md)

## 写在前面

有人曾说沟通不是两个人的事，而是六个人：

我，我以为的我，你以为的我；

你，你以为的你，我以为的你。

很多时候，对话并没有真正发生在你我之间，而是彼此脑中被想象、被投射的假想形象在反复较劲。身临其境的时候，情绪与防御机制往往会掩盖事实本身。

ReLink 想做的事情很简单：让AI来身临其境的回到那天的对话，跳出脑海里的拉扯，回到那些消息本身——看清在那场对话里，对方到底说了什么，而我们又究竟错过了什么？


## ReLink是什么？

这是一个面向 Node.js 的通用、证据导向型关系分析 Agent。

它通过还原真实的交互记录、构建时间线，帮助你从海量、碎片化的互动数据中厘清关系变化的脉络。

项目通过四种接入方式提供同一个运行时，你可以选择你喜欢的方式使用它：

- **SDK**：用于 Node.js 和 TypeScript 应用。
- **CLI**：用于本地文件、自动化和运维流程。
- **HTTP API**：提供 JSON 和 Server-Sent Events。
- **MCP 服务**：通过 JSON-RPC 2.0 stdio 通信。

项目还包含一个可选 Skill，作为 MCP 使用指南。

## 主要能力

- 模型主导的工具循环和能力懒加载。
- 原始记录分页、稳定游标、日期采样和事件上下文展开。
- 研究计划、笔记、来源发现、不确定性追踪和最终综合。
- 由 Provider 提供的可选图片、语音、时间线、下载和网页搜索能力。
- 面向长调查的上下文压缩和 token 预算管理。
- 提示缓存、模型用量统计、重试策略和流式 UI message chunks。
- 持久化运行快照、追加式调试日志、中止、重放和续跑。
- 对话存储、标题生成、回答反馈和事务化记忆整理。
- 通过每次运行独立的 Provider 与持久化上下文实现并发隔离。

## 环境要求

- Node.js 22 或更高版本。
- 执行 Agent 时需要受支持的模型端点。数据导入、摘要、搜索和存储 CRUD 不需要模型。

## 安装

```bash
git clone https://github.com/your-repo/relink.git
cd relink
npm install
npm run build
```

作为依赖安装：

```bash
npm install relink
```

## 模型配置

可以设置环境变量，也可以通过 SDK、API 或 MCP 请求传入 `modelConfig`。

```bash
export RELINK_MODEL_PROTOCOL="openai-compatible"
export RELINK_MODEL_PROVIDER="openai-compatible"
export RELINK_MODEL_BASE_URL="https://your-base-url/v1"
export RELINK_MODEL_API_KEY="your-key"
export RELINK_MODEL="your-model"
```

支持 `openai-compatible`、`openai-responses`、`anthropic` 和 `google` 协议。全部字段见 [SDK 配置](docs/SDK.zh-CN.md#模型协议)。

## 快速开始

先将原始数据规范化为统一的 `sample.json`：

这里的 `sample.ndjson` 是用户提供的原始文件，后续所有示例都统一使用规范化后的 `sample.json`。

```bash
npm run cli -- import --file sample.ndjson --out sample.json
```

不调用模型，检查规范化后的文件：

```bash
npm run cli -- summary --file sample.json
npm run cli -- search --file sample.json --text "timeline"
```

运行 Agent：

```bash
npm run cli -- run \
  --file sample.json \
  --entity-a alice --entity-b bob \
  --prompt "核验这段关系随时间发生的变化，引用原始记录并说明不确定性。" \
  --mode deep-research
```

添加 `--json` 可以获得运行 ID、UI message chunks、进度事件、最终回答和完整运行快照。运行数据默认保存在 `.relink`；可通过 `--data-dir` 指定其他目录。

已完成的运行默认执行一次独立的记忆整理。不需要额外模型调用时，可以传入 `--memory-synthesis false`。

## SDK

```ts
import { createRelink } from 'relink'

const agent = createRelink({
  datasetFile: './sample.json',
  dataDir: './.relink',
  modelConfig: {
    protocol: 'openai-compatible',
    provider: 'openai-compatible',
    baseURL: process.env.RELINK_MODEL_BASE_URL,
    apiKey: process.env.RELINK_MODEL_API_KEY,
    model: process.env.RELINK_MODEL,
  },
})

const result = await agent.run({
  prompt: '哪些时期出现了可验证的互动变化？',
  scope: { kind: 'global' },
  mode: 'deep-research',
  onProgress: (event) => console.error(event.stage, event.title),
  onChunk: (chunk) => process.stdout.write(`${JSON.stringify(chunk)}\n`),
})

console.log(result.runId, result.answer)
```

可以通过 `RelinkDataProvider` 接入数据库、API、搜索索引、对象存储或事件流。Agent 只读取 Provider 暴露的操作。详见[自定义 Provider](docs/SDK.zh-CN.md#自定义-provider)。

## HTTP API

```bash
npm run cli -- serve --file sample.json --port 8787
```

```bash
curl -X POST "http://127.0.0.1:8787/v1/analyze" \
  -H "content-type: application/json" \
  -d '{"prompt":"核验变化并引用证据","mode":"deep-research"}'
```

主要端点：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/v1/health` | 运行时健康状态 |
| GET | `/v1/dataset/summary` | 数据集覆盖范围 |
| GET | `/v1/sessions` | 稳定关系 session 目录 |
| POST | `/v1/analyze` 或 `/v1/runs` | 执行 Agent |
| POST | `/v1/analyze/stream` | 通过 SSE 推送进度、chunks 和结果 |
| GET | `/v1/runs` 和 `/v1/runs/:id` | 列出运行或读取快照 |
| POST | `/v1/runs/:id/abort` | 中止活动运行 |
| POST | `/v1/runs/:id/replay` | 重放已完成运行 |
| GET/POST/PATCH/DELETE | `/v1/conversations` 和 `/v1/conversations/:id` | 对话存储 |
| GET/POST/PATCH/DELETE | `/v1/memories` 和 `/v1/memories/:id` | 记忆存储 |
| GET/POST/DELETE | `/v1/feedback` 和 `/v1/feedback/:messageId` | 回答反馈 |
| POST | `/v1/title` | 生成脱敏标题 |

完整约定见 [HTTP API](docs/API.zh-CN.md)。

## MCP

```bash
npm run cli -- mcp --file sample.json
```

MCP 服务提供 Agent 运行、数据集摘要、session、搜索、运行记录、中止、对话、记忆、反馈和标题工具。客户端配置和工具参数见 [MCP](docs/MCP.zh-CN.md)。

## 数据

内置加载器接受 JSON、NDJSON、CSV 和 TSV，并识别参与者、发起者、时间、内容和互动类型等常用字段。支持多人互动。原始数据没有发起者信息时，运行时会保持未解析状态，不会根据参与者顺序猜测方向。

标准结构和字段映射规则见[数据格式](docs/DATA-FORMAT.zh-CN.md)。

## 文档

| 主题 | English | 简体中文 |
| --- | --- | --- |
| 概览 | [README](README.md) | [README](README.zh-CN.md) |
| SDK 与 Provider | [SDK](docs/SDK.md) | [SDK](docs/SDK.zh-CN.md) |
| CLI | [CLI](docs/CLI.md) | [CLI](docs/CLI.zh-CN.md) |
| HTTP API | [API](docs/API.md) | [API](docs/API.zh-CN.md) |
| MCP | [MCP](docs/MCP.md) | [MCP](docs/MCP.zh-CN.md) |
| 数据格式 | [Data Format](docs/DATA-FORMAT.md) | [Data Format](docs/DATA-FORMAT.zh-CN.md) |
| 架构 | [Architecture](docs/ARCHITECTURE.md) | [Architecture](docs/ARCHITECTURE.zh-CN.md) |
| 安全 | [Security](docs/SECURITY.md) | [Security](docs/SECURITY.zh-CN.md) |

## 开发验证

```bash
npm run typecheck
npm test
npm pack --dry-run
```

## 许可证

项目采用 [CC BY-NC-SA 4.0](LICENSE) 许可证。使用时需要署名，不允许商业使用，分发修改版本时必须使用相同许可证。

## 写在最后

很多冲突可能是因为我们回应的，从一开始就不是对方本人，而是对方看起来像什么，或我们以为他在暗示什么。

真正困难的似乎不再是把话说清楚，而是想清楚我现在回应的，是你，还是我脑中的你？

许多人总是暗戳戳地表达自己的想法和感情，用太过含蓄隐忍的方式去暗示对方，但那时身临其境的我们并不一定能发现这些暗示，于是，没被发现的暗示，在给出的一方眼里慢慢沉淀成漫不经心；而在浑然不觉的接收者眼里，随之而来的冷淡或爆发，又成了一种不可理喻的苛责。含蓄原本可能是为了体面、矜持，或是害怕直接暴露自己的脆弱，但回到现实里，它往往演变成一场单方面的测试：用对方能不能猜中自己的心思，来称量对方到底有多在意自己。

人明知道暗示容易落空，却还是习惯把话藏在褶皱里，往往是因为直接坦白需要巨大的成本。把真正的需求摊开在桌面上，意味着要独自承担被明确拒绝或轻视的风险。暗示是一种出于本能的防御，我们在模糊的余地里给自己留退路，试图把表达的安全感转嫁给对方的推测。然而代价往往是残酷的，为了保护自己不受伤，我们把猜测的重担甩给了另一个人，最后亲手把对话推向了结束。

在这样的拉扯里，我们不再是在和眼前活生生的人相处，而是在和自己构建出来的那个虚拟的对方较劲。当对方没有给出符合预期的反应，我们感到失望甚至愤怒，往往不是因为对方做错了什么，而是脑海里那个理应懂我、理应无微不至的假想形象破灭了。我们苛求对方拥有穿透迷雾的洞察力，却忽略了Ta也是个精力有限、会被生活琐碎消耗的普通人。

沟通的症结或许从来不在于表达技巧有多拙劣，而在于我们把试探和沉默当成了感情深厚的度量衡。可现实里没有读心术，于是把期待寄托于心照不宣，最终等来的也几乎全是一厢情愿的落空。

我们希望借助AI的力量，重新回望那时的对话，帮当时的自己看清，哪些细节是对方真切表达过、却被我们粗心忽视的；又有哪些揣测，其实纯粹只是我们在慌乱中脑补出来的执念。
