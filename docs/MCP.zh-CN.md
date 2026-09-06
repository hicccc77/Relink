# MCP

[English](MCP.md) | [简体中文](MCP.zh-CN.md)

MCP 适配器使用 JSON-RPC 2.0 over stdio，并调用 `RelinkRuntime` 执行所有操作。

## 启动

```bash
npm run cli -- mcp --file sample.json
```

客户端配置：

```json
{
  "mcpServers": {
    "relink": {
      "command": "relink",
      "args": [
        "mcp",
        "--file",
        "sample.json"
      ]
    }
  }
}
```

模型配置可以由启动进程通过 `RELINK_MODEL_*` 环境变量提供，也可以在 `relink_run` 的 `modelConfig` 参数中提供。

## 工具

### `relink_run`

执行模型主导的 Agent。参数包括 `prompt`、可选 `messages`、`scope`、`mode`、`modelConfig`、`runId`、`resumeFromRunId` 和 `conversationId`。返回 `answer`、`chunks`、`progress`、`state` 和研究轨迹。

传入 `runId` 后，可使用标准 `notifications/cancelled` 的 `requestId` 取消正在执行的请求，也可以调用 `relink_abort`。

### `relink_dataset_summary`

返回 Provider 数据集的实体数、互动数、关系 session 数和时间覆盖。

### `relink_sessions`

返回稳定关系 session。指定关系范围时，可以使用返回项的 `username` 作为 `scope.sessionId`。

### `relink_search`

调用 Provider 文本搜索。支持 `text`、`sessionId`、`from`、`to`、`limit` 和 `offset`。

### `relink_runs`

通过 `action` 执行 `list`、`get` 或 `replay`，用于审计、恢复和不调用模型的重放。

### `relink_abort`

传入 `runId`，中止活动运行并保留可续跑快照。

### `relink_conversations`

通过 `action` 执行 `list`、`get`、`create`、`save`、`rename`、`metadata` 或 `delete`，管理 `dataDir` 中的对话。

### `relink_memory`

通过 `action` 执行 `list`、`get`、`summary`、`create`、`update`、`delete`、`revise`、`refresh`、`enable` 或 `clear`。自动记忆只保留稳定偏好和工作方式，不会把关系事实保存为用户偏好。

### `relink_feedback`

通过 `action` 执行 `list`、`save`、`delete`、`summary` 或 `synthesize`。反馈聚合达到有效样本门槛后，可以用于调整长期回答偏好。

### `relink_title`

为对话生成短标题。模型未配置或生成失败时返回确定性的本地标题，不影响主要运行。

## 结果处理

MCP 客户端应保留 `state.research.readPages`、工具调用和最终回答，形成完整证据链。展示回答时，应同时呈现不确定性和 Provider 返回的范围限制。

数据授权、模型密钥保护和租户隔离由集成应用负责。
