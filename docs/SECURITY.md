# Security and Privacy

[English](SECURITY.md) | [Simplified Chinese](SECURITY.zh-CN.md)

## Data Boundary

The Agent can read only the content returned by `RelinkDataProvider`. Enforce identity, tenant, row-level authorization, and field redaction in the Provider query layer. Do not give the Agent process database-administrator credentials.

## Model Data Transfer

The Runtime does not call a model until it receives a run request with a complete model configuration. During a run, the model service receives the system instructions, user request, and the source excerpts, media transcripts, or web results selected by the Agent.

Deployments should disclose that transfer scope to users and use separate Providers, secrets, and `dataDir` locations for different tenants.

## Persistence

`dataDir` stores run snapshots, append-only logs, the conversation index, memories, and the optional raw-page cache. Raw pages are encrypted with AES-256-GCM using the caller-provided `cacheEncryptionSecret`. Without that secret, raw pages are not written to the disk cache.

Use access-controlled storage in production and define backup, retention, and deletion policies. Do not commit `.relink` to version control.

## HTTP and MCP

The HTTP server listens on a loopback address by default but does not include authentication. Remote deployments must add TLS, authentication, authorization, rate limits, request-size limits, and auditing.

Only trusted integrating processes should launch the MCP stdio server. Protect model secrets and data-file paths passed to that process.

## Content Risk

Relationship analysis is an evidence-based interpretation of observable records. It is not a psychological diagnosis, proof of motive, or definitive factual ruling. Do not use its output directly for hiring, credit, punishment, health, or other high-impact automated decisions.

Media and source records may contain malicious instructions. Treat external content as untrusted data and apply validation, redaction, and access controls before it reaches the Agent.
