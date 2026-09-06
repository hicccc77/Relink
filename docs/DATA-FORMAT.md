# Data Format

[English](DATA-FORMAT.md) | [Simplified Chinese](DATA-FORMAT.zh-CN.md)

## Minimal Input

Each record in an input array needs at least two identifiable participants and a time field:

```json
{ "sender": "a", "recipient": "b", "time": "2025-01-01T10:00:00Z", "content": "hello" }
```

Recognized field aliases include:

- Participants: `participants`, `members`, `sender`, `from`, `author`, `recipient`, `to`
- Time: `occurredAt`, `timestamp`, `time`, `date`, `createdAt`, `sentAt`
- Text: `content`, `text`, `body`, `message`, `transcript`
- Type: `kind`, `type`, `channel`, `eventType`

## Normalized Dataset

```ts
type Dataset = {
  id: string
  name: string
  version: 1
  entities: Entity[]
  interactions: Interaction[]
}
```

`Entity.id` must remain stable within a dataset. `Interaction.participants` contains entity IDs, and a multi-party interaction may contain more than two participants. `sourceRef.locator` is an application-defined source position such as a file line, email ID, or database key.

`Interaction.actorId` is an optional explicit actor or author ID. Omit it when the source does not contain direction information. The adapter marks the actor as unresolved and never infers authorship from participant order.

## CSV and TSV

The first row is treated as the header and each following row becomes one record:

```csv
sender,recipient,timestamp,kind,text
alice,bob,2025-01-01T10:00:00Z,message,"Hello, Bob"
```

Multi-value participant fields may use commas, semicolons, pipes, or newlines, for example `participants="alice;bob;carol"`. Only explicit `actorId`, `actor`, `sender`, `from`, or `author` fields identify the actor. Participant order is not used to infer direction.

## Time and Deduplication

The loader accepts ISO 8601 values, Unix seconds, and Unix milliseconds. Records without a parseable timestamp are placed at the Unix epoch; production ingestion should reject those records before they reach the Agent.

An explicit `id` is used for deduplication. When no ID is available, the loader generates a stable ID from participants, time, type, content, and source position.

## Provider Input

A custom `RelinkDataProvider` does not need to construct a complete Dataset. Its paginated records should provide a stable `messageKey`, `localId`, `sortSeq`, Unix-second `createTime`, and `content`, `parsedContent`, and `rawContent`. See [SDK](SDK.md#custom-provider) for the full Provider contract.
