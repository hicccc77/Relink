---
name: relink
description: Use the configured Relink MCP server for evidence-oriented analysis of authorized interaction records, timelines, patterns, and events. Do not use it for speculation when no Provider is configured.
---

# Relink Skill

This is an optional integration wrapper. The Agent Runtime, SDK, CLI, HTTP API, and MCP server remain fully usable without this Skill.

## Workflow

1. Call `relink_dataset_summary` to understand data coverage.
2. Call `relink_sessions` to confirm available relationship sessions.
3. For an investigation, call `relink_run` with a clear `prompt`, `scope`, and `mode`.
4. For long runs, retain the returned `runId` so the caller can resume or replay it.

Use `deep-research` for questions that require cross-period reading, multiple source records, or an explicit evidence trail. Use `standard` for focused questions.

## Evidence Presentation

Treat the answer, source pages, tool calls, and research trace as one evidence chain. Do not present model inferences as observed facts. Preserve missing data, Provider scope limits, and uncertainty in the final response.

## Data and Privacy

Read only data returned by the authorized Provider. Do not send source content to an external model without user authorization. Model configuration, redaction, and tenant isolation belong to the integrating application. The Skill never reads files, databases, or platform-specific data directly.

## Available Tools

- `relink_dataset_summary`
- `relink_sessions`
- `relink_search`
- `relink_run`
- `relink_runs`
- `relink_abort`
- `relink_conversations`
- `relink_memory`
- `relink_feedback`
- `relink_title`

The equivalent tool contracts are documented in [MCP.md](../../docs/MCP.md).
