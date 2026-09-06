# HTTP API

[English](API.md) | [简体中文](API.zh-CN.md)

## 启动

```bash
npm run cli -- serve --file sample.json --port 8787
```

所有响应均为 UTF-8 JSON；`/v1` 前缀可以省略。服务端调用与 SDK 相同的 `RelinkRuntime`。

## 健康状态与数据

`GET /v1/health` 返回运行时版本和架构标识。

`GET /v1/dataset` 返回 Provider 暴露的数据集。直接连接数据服务的 Provider 可以不实现该方法，此时返回 `null`。`GET /v1/dataset/summary` 返回数量和时间覆盖。`GET /v1/sessions` 返回稳定 session 目录。

`POST /v1/datasets` 接受 `{ "dataset": ... }`、`{ "data": ... }` 或直接 JSON 对象或数组，用于替换内置文件适配器的数据。自定义 Provider 应在应用代码中调用 `runtime.setDataProvider()`；不要把数据服务凭据放进请求体。

## 执行 Agent

`POST /v1/analyze` 或 `POST /v1/runs`：

```json
{
  "prompt": "Verify interaction changes in chronological order, cite records, and state uncertainty.",
  "scope": { "kind": "global" },
  "mode": "deep-research",
  "modelConfig": {
    "protocol": "openai-compatible",
    "baseURL": "https://api.openai.com/v1",
    "apiKey": "...",
    "model": "your-model"
  }
}
```

请求还支持 `messages`、`resumeFromRunId`、`conversationId`、`debugLogEnabled` 和 `memorySynthesis`。`scope` 可以是 session 范围，也可以使用实体对简写 `{ "entityA": "a", "entityB": "b" }`。

运行完成后默认执行一次独立的记忆整理；整理失败不会改变已经完成的回答。执行 Agent 必须提供有效模型配置，否则端点返回 `400` 错误。

普通响应：

```json
{
  "runId": "...",
  "answer": "...",
  "chunks": [],
  "progress": [],
  "state": {
    "status": "completed",
    "research": { "readPages": [], "feedback": [] },
    "toolCalls": []
  }
}
```

## SSE

`POST /v1/analyze/stream` 或 `/v1/runs/stream` 使用相同请求体，返回 `text/event-stream`：

- `ready`：连接建立并立即返回 `runId`，可用于中止或查询状态。
- `progress`：Agent 阶段、工具名和扫描统计。
- `chunk`：一个 AI SDK UI message chunk，包含文本增量和工具循环事件。
- `result`：完整运行结果。
- `done`：包含 `runId`。
- `error`：错误信息。

客户端断开会触发 `AbortController`，并将运行标记为 `aborted`。

## 路由

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/v1/runs?limit=100` | 最近运行的轻量列表 |
| GET | `/v1/runs/:runId` | 完整快照、研究轨迹和工具调用 |
| POST | `/v1/runs/:runId/abort` | 中止运行并持久化状态 |
| POST | `/v1/runs/:runId/replay` | 重放已完成回答，不调用模型 |
| GET | `/v1/conversations` | 对话索引 |
| POST | `/v1/conversations` | 创建对话 |
| GET/PATCH/DELETE | `/v1/conversations/:id` | 读取、更新或删除对话 |
| GET | `/v1/memories`、`/v1/memories/:id`、`/v1/memories/summary` | 查询记忆 |
| POST | `/v1/memories`、`/v1/memories/summary/revise`、`/v1/memories/summary/refresh`、`/v1/memories/from-feedback` | 创建或整理记忆 |
| PATCH/DELETE | `/v1/memories/:id` | 修改或删除记忆 |
| POST | `/v1/memories/enabled`、`/v1/memories/clear` | 开关或清空记忆 |
| GET/POST/DELETE | `/v1/feedback`、`/v1/feedback/:messageId` | 查看、保存或删除回答反馈 |
| GET | `/v1/feedback/summary` | 按对话汇总反馈 |
| POST | `/v1/title` | 生成脱敏会话标题 |
| POST | `/v1/search` | 调用 Provider 的记录搜索 |

## 部署

服务默认绑定 `127.0.0.1`，且不包含身份认证系统。远程或多租户部署必须在反向代理或应用层增加认证、TLS、授权、请求体限制、速率限制和数据访问审计。
