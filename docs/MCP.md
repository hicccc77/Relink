# MCP

[English](MCP.md) | [Simplified Chinese](MCP.zh-CN.md)

The MCP adapter uses JSON-RPC 2.0 over stdio and calls `RelinkRuntime` for every operation.

## Start the Server

```bash
npm run cli -- mcp --file sample.json
```

Client configuration:

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

The launching process can provide model configuration through `RELINK_MODEL_*` environment variables, or a caller can pass `modelConfig` to `relink_run`.

## Tools

### `relink_run`

Runs the model-directed Agent. Arguments include `prompt`, optional `messages`, `scope`, `mode`, `modelConfig`, `runId`, `resumeFromRunId`, and `conversationId`. The result includes `answer`, `chunks`, `progress`, `state`, and the research trace.

When a caller supplies `runId`, it can cancel an active request through standard `notifications/cancelled` using the JSON-RPC `requestId`, or call `relink_abort`.

### `relink_dataset_summary`

Returns entity, interaction, relationship-session, and time-coverage statistics exposed by the Provider.

### `relink_sessions`

Returns stable relationship sessions. Use a returned `username` as `scope.sessionId` when selecting a session.

### `relink_search`

Calls Provider text search. Arguments include `text`, `sessionId`, `from`, `to`, `limit`, and `offset`.

### `relink_runs`

Uses `action` with `list`, `get`, or `replay` for auditing, recovery, and replay without another model call.

### `relink_abort`

Aborts an active `runId` and retains a resumable snapshot.

### `relink_conversations`

Uses `action` with `list`, `get`, `create`, `save`, `rename`, `metadata`, or `delete` to manage conversations in `dataDir`.

### `relink_memory`

Uses `action` with `list`, `get`, `summary`, `create`, `update`, `delete`, `revise`, `refresh`, `enable`, or `clear`. Automatic memory stores stable preferences and working styles, not relationship facts as user preferences.

### `relink_feedback`

Uses `action` with `list`, `save`, `delete`, `summary`, or `synthesize`. Once enough useful samples exist, aggregated feedback can adjust long-term answer preferences.

### `relink_title`

Generates a short conversation title. If model configuration is unavailable or generation fails, it returns a deterministic local title without affecting the primary run.

## Result Handling

MCP clients should retain `state.research.readPages`, tool calls, and the final answer as one evidence chain. Present uncertainty and Provider-supplied scope limitations with the answer.

The integrating application is responsible for data authorization, model-secret protection, and tenant isolation.
