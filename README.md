# Relink

[English](README.md) | [Simplified Chinese](README.zh-CN.md)

`Relink` is a general-purpose, evidence-oriented relationship analysis Agent for Node.js. Applications provide authorized interaction data through a `RelinkDataProvider`; the Agent then plans an investigation, reads source records, follows evidence across time, and produces a traceable answer.

The package exposes one runtime through four integration surfaces:

- **SDK** for Node.js and TypeScript applications.
- **CLI** for local files, automation, and operational workflows.
- **HTTP API** with JSON and Server-Sent Events.
- **MCP server** over JSON-RPC 2.0 stdio.

An optional Skill is included as a thin MCP usage guide. It does not contain analysis logic or state.

## Capabilities

- Model-directed tool loop with lazy capability loading.
- Paginated source reading, stable cursors, date sampling, and event context expansion.
- Research plans, notes, source findings, uncertainty tracking, and final synthesis.
- Optional image, voice, timeline, download, and web-search capabilities supplied by the Provider.
- Context compaction and token-budget management for long investigations.
- Prompt caching, provider usage accounting, retry policy, and streaming UI message chunks.
- Durable run snapshots, append-only debug logs, abort, replay, and resume.
- Conversation storage, title generation, answer feedback, and transactional memory synthesis.
- Concurrent runtime isolation through per-run Provider and persistence contexts.

## Requirements

- Node.js 22 or newer.
- A supported model endpoint for Agent runs. Dataset import, summary, search, and storage CRUD work without a model.

## Install

```bash
git clone https://github.com/your-repo/relink.git
cd relink
npm install
npm run build
```

For package consumers:

```bash
npm install relink
```

## Model Configuration

Set environment variables or pass `modelConfig` through the SDK, API, or MCP request.

```bash
export RELINK_MODEL_PROTOCOL="openai-compatible"
export RELINK_MODEL_PROVIDER="openai-compatible"
export RELINK_MODEL_BASE_URL="https://api.openai.com/v1"
export RELINK_MODEL_API_KEY="your-key"
export RELINK_MODEL="your-model"
```

Supported protocols are `openai-compatible`, `openai-responses`, `anthropic`, and `google`. See [SDK configuration](docs/SDK.md#model-protocols) for all fields.

## Quick Start

Normalize source data into the canonical `sample.json` file:

Here `sample.ndjson` is the user-provided source file; all later examples use the normalized `sample.json`.

```bash
npm run cli -- import --file sample.ndjson --out sample.json
```

Inspect the normalized file without calling a model:

```bash
npm run cli -- summary --file sample.json
npm run cli -- search --file sample.json --text "timeline"
```

Run the Agent:

```bash
npm run cli -- run \
  --file sample.json \
  --entity-a alice --entity-b bob \
  --prompt "Verify how this relationship changed over time. Cite source records and state uncertainty." \
  --mode deep-research
```

Add `--json` to receive the run ID, UI message chunks, progress events, final answer, and complete run snapshot. Runtime data is stored in `.relink` by default; use `--data-dir` to select another directory.

Completed runs perform a separate memory-synthesis pass by default. Disable it with `--memory-synthesis false` when the extra model call is not needed.

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
  prompt: 'Which periods show verifiable changes in interaction?',
  scope: { kind: 'global' },
  mode: 'deep-research',
  onProgress: (event) => console.error(event.stage, event.title),
  onChunk: (chunk) => process.stdout.write(`${JSON.stringify(chunk)}\n`),
})

console.log(result.runId, result.answer)
```

Use `RelinkDataProvider` to connect a database, API, search index, object store, or event stream. The Agent reads only the operations exposed by that Provider. See [Custom Provider](docs/SDK.md#custom-provider).

## HTTP API

```bash
npm run cli -- serve --file sample.json --port 8787
```

```bash
curl -X POST "http://127.0.0.1:8787/v1/analyze" \
  -H "content-type: application/json" \
  -d '{"prompt":"Verify changes and cite evidence","mode":"deep-research"}'
```

Key endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/v1/health` | Runtime health |
| GET | `/v1/dataset/summary` | Dataset coverage |
| GET | `/v1/sessions` | Stable relationship-session catalog |
| POST | `/v1/analyze` or `/v1/runs` | Run the Agent |
| POST | `/v1/analyze/stream` | Stream progress, chunks, and result over SSE |
| GET | `/v1/runs` and `/v1/runs/:id` | List runs or read a snapshot |
| POST | `/v1/runs/:id/abort` | Abort an active run |
| POST | `/v1/runs/:id/replay` | Replay a completed run |
| GET/POST/PATCH/DELETE | `/v1/conversations` and `/v1/conversations/:id` | Conversation storage |
| GET/POST/PATCH/DELETE | `/v1/memories` and `/v1/memories/:id` | Memory storage |
| GET/POST/DELETE | `/v1/feedback` and `/v1/feedback/:messageId` | Answer feedback |
| POST | `/v1/title` | Generate a redacted title |

See [HTTP API](docs/API.md) for the complete contract.

## MCP

```bash
npm run cli -- mcp --file sample.json
```

The MCP server exposes tools for Agent runs, dataset summaries, sessions, search, stored runs, abort, conversations, memory, feedback, and titles. See [MCP](docs/MCP.md) for client configuration and tool arguments.

## Data

The built-in loader accepts JSON, NDJSON, CSV, and TSV. It recognizes common fields for participants, actors, timestamps, content, and interaction type. Multi-party interactions are supported. When actor information is absent, the runtime keeps it unresolved instead of inferring direction from participant order.

See [Data Format](docs/DATA-FORMAT.md) for the normalized schema and field mapping rules.

## Documentation

| Topic | English | Simplified Chinese |
| --- | --- | --- |
| Overview | [README](README.md) | [README](README.zh-CN.md) |
| SDK and Provider | [SDK](docs/SDK.md) | [SDK](docs/SDK.zh-CN.md) |
| CLI | [CLI](docs/CLI.md) | [CLI](docs/CLI.zh-CN.md) |
| HTTP API | [API](docs/API.md) | [API](docs/API.zh-CN.md) |
| MCP | [MCP](docs/MCP.md) | [MCP](docs/MCP.zh-CN.md) |
| Data format | [Data Format](docs/DATA-FORMAT.md) | [Data Format](docs/DATA-FORMAT.zh-CN.md) |
| Architecture | [Architecture](docs/ARCHITECTURE.md) | [Architecture](docs/ARCHITECTURE.zh-CN.md) |
| Security | [Security](docs/SECURITY.md) | [Security](docs/SECURITY.zh-CN.md) |

## Development

```bash
npm run typecheck
npm test
npm pack --dry-run
```

## License

Licensed under [CC BY-NC-SA 4.0](LICENSE). Attribution is required, commercial use is not permitted, and distributed adaptations must use the same license.
