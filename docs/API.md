# HTTP API

[English](API.md) | [Simplified Chinese](API.zh-CN.md)

## Start the Server

```bash
npm run cli -- serve --file sample.json --port 8787
```

All responses use UTF-8 JSON. The `/v1` prefix is optional. The server calls the same `RelinkRuntime` exposed by the SDK.

## Health and Data

`GET /v1/health` returns the runtime version and architecture identifier.

`GET /v1/dataset` returns the dataset exposed by the Provider. A Provider that queries a data service directly may omit this method, in which case the endpoint returns `null`. `GET /v1/dataset/summary` returns counts and time coverage. `GET /v1/sessions` returns the stable session catalog.

`POST /v1/datasets` accepts `{ "dataset": ... }`, `{ "data": ... }`, or a direct JSON object or array and replaces the data in the built-in file adapter. Custom Providers should be installed in application code with `runtime.setDataProvider()`. Never put data-service credentials in an API request body.

## Run the Agent

Use `POST /v1/analyze` or `POST /v1/runs`:

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

The request also accepts `messages`, `resumeFromRunId`, `conversationId`, `debugLogEnabled`, and `memorySynthesis`. `scope` can select one session or use pair shorthand such as `{ "entityA": "a", "entityB": "b" }`.

A completed run performs a separate memory-synthesis pass by default. A failure in that phase does not alter the completed answer. Agent execution requires a valid model configuration; otherwise the endpoint returns a `400` error.

Standard response:

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

## Server-Sent Events

`POST /v1/analyze/stream` and `/v1/runs/stream` accept the same body and return `text/event-stream`:

- `ready`: the connection is established and a `runId` is available for status checks or abort.
- `progress`: an Agent phase, tool name, or scan statistic.
- `chunk`: one AI SDK UI message chunk, including text deltas and tool-loop events.
- `result`: the complete run result.
- `done`: the final `runId`.
- `error`: an error message.

A client disconnect triggers the run's `AbortController` and records the run as `aborted`.

## Routes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/runs?limit=100` | List recent runs |
| GET | `/v1/runs/:runId` | Read a full snapshot, research trace, and tool calls |
| POST | `/v1/runs/:runId/abort` | Abort a run and persist its state |
| POST | `/v1/runs/:runId/replay` | Replay a completed answer without a model call |
| GET | `/v1/conversations` | List conversations |
| POST | `/v1/conversations` | Create a conversation |
| GET/PATCH/DELETE | `/v1/conversations/:id` | Read, update, or delete a conversation |
| GET | `/v1/memories`, `/v1/memories/:id`, `/v1/memories/summary` | Read memory state |
| POST | `/v1/memories`, `/v1/memories/summary/revise`, `/v1/memories/summary/refresh`, `/v1/memories/from-feedback` | Create or synthesize memory |
| PATCH/DELETE | `/v1/memories/:id` | Update or delete memory |
| POST | `/v1/memories/enabled`, `/v1/memories/clear` | Enable, disable, or clear memory |
| GET/POST/DELETE | `/v1/feedback`, `/v1/feedback/:messageId` | Read, save, or delete answer feedback |
| GET | `/v1/feedback/summary` | Summarize feedback by conversation |
| POST | `/v1/title` | Generate a redacted conversation title |
| POST | `/v1/search` | Search Provider records directly |

## Deployment

The server binds to `127.0.0.1` by default and does not provide an identity system. Remote and multi-tenant deployments must add authentication, TLS, authorization, request-size limits, rate limits, and data-access auditing at the reverse-proxy or application layer.
