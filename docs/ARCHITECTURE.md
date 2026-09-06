# Architecture

[English](ARCHITECTURE.md) | [Simplified Chinese](ARCHITECTURE.zh-CN.md)

## System Boundary

```text
User data / database / API / files / event streams
                       |
            RelinkDataProvider
                       |
            RelinkRuntime
              - AgentService model-directed loop
              - Source reading and cursors
              - Time sampling and event context
              - Research plans, notes, and feedback
              - Media review and memory transactions
              - Prompt cache, retries, and compaction
              - Run snapshots, logs, recovery, and resume
              - Titles, feedback learning, and memory synthesis
                       |
              SDK / CLI / HTTP / MCP
                       |
                  optional Skill
```

`src/agent/services/agentModelLedService.ts` is the orchestration core. It manages model tool selection, the evidence workspace, research state, and recovery policy, and reads data through `RelinkDataProvider`.

`src/agent/runtime.ts` is the public runtime boundary. It:

- converts prompts or UI messages into AI SDK messages;
- resolves pair scopes to stable Provider sessions;
- creates a data fingerprint and `AbortController` for every run;
- collects UI message chunks, structured progress, and the final snapshot;
- exposes resume, replay, abort, run listing, memory, and Provider search.

The SDK, CLI, HTTP API, and MCP server all call this Runtime and do not maintain separate analysis flows.

## Provider Contract

The source reader needs a session catalog, session details, paginated records, surrounding records, date counts, batch scans, and text search. Media, timeline, and web-search operations are optional. An unavailable optional capability returns an explicit unsupported result.

`DatasetProvider` converts participant sets in a generic `Dataset` into stable relationship sessions. It preserves `sourceRef`, interaction type, time, actor, and media metadata in record locators. A custom Provider can connect a database, search index, object store, email system, or internal API.

The integrating application owns authorization, tenant isolation, page limits, and field redaction. The Agent does not bypass the Provider.

## Run Lifecycle

1. The Runtime creates the run ID, data and recovery fingerprints, and initial snapshot.
2. The Agent reads the catalog and scope overview, then loads capabilities as the model requests them.
3. The model selects source pages, timelines, event context, media review, memory, or web-search tools.
4. Tool calls, research pages, and phase state are written to the run snapshot. Large arguments are written to an append-only log for interruption recovery.
5. When context approaches the model window, compaction preserves the research plan, confirmed facts, source findings, and open questions.
6. The Agent validates and synthesizes the answer, stores `finalAnswer` and the research trace, and emits `[DONE]`.
7. Network failures, user aborts, and process exits retain auditable state. `resumeFromRunId` continues an eligible run; `replay` returns a completed answer without a model call.
8. The optional memory phase uses the same model configuration to extract stable preferences. It is isolated from the primary answer, so a memory failure cannot overwrite a completed run.

## Isolation and Cache Identity

The Provider facade stores the active Provider in `AsyncLocalStorage`, preventing concurrent runtimes in one process from reading each other's data. Each Runtime selects its persistence location through `dataDir`.

`ownerFingerprint`, `sourceFingerprint`, and the generated `datasetFingerprint` participate in recovery and cache identity. Multi-tenant integrations should isolate `dataDir` by tenant and set the first two fingerprints. Raw pages are written to disk only when the caller supplies `cacheEncryptionSecret`; cached pages use AES-256-GCM.

## Skill Responsibility

The Skill supplies tool-selection and result-presentation guidance only. The Runtime owns long-running state, context compaction, evidence paging, model protocols, retries, and recovery. SDK, CLI, and HTTP users do not need to install the Skill.
