import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import {
  type Dataset,
  type DatasetInput,
  type Entity,
  type EntityType,
  type Interaction,
  isRecord,
  stringValue,
} from '../contracts/index.js'

const EPOCH = '1970-01-01T00:00:00.000Z'

function stableId(prefix: string, value: unknown): string {
  const digest = createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 16)
  return `${prefix}_${digest}`
}

function cleanName(value: unknown): string | undefined {
  const text = stringValue(value)
  return text ? text.replace(/\s+/g, ' ').trim() : undefined
}

function normalizeDate(value: unknown): string {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d{10,13}$/.test(value.trim()))) {
    const numeric = Number(value)
    const millis = String(value).trim().length === 10 ? numeric * 1000 : numeric
    const date = new Date(millis)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  const text = stringValue(value)
  if (text) {
    const date = new Date(text)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return EPOCH
}

function firstValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== '') return record[key]
  }
  return undefined
}

function participantList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return value === undefined || value === null ? [] : [value]
  const normalized = value.trim()
  if (!normalized) return []
  // Delimited participant fields are common in CSV exports; preserve IDs that
  // do not contain a delimiter as-is and do not infer a sender from position.
  return normalized.includes(',') || normalized.includes(';') || normalized.includes('|') || normalized.includes('\n')
    ? normalized.split(/[,;|\n]+/).map((item) => item.trim()).filter(Boolean)
    : [normalized]
}

function entityFromValue(value: unknown, fallbackType: EntityType = 'person'): Entity | null {
  if (typeof value === 'string' || typeof value === 'number') {
    const name = cleanName(value)
    if (!name) return null
    return { id: name, type: fallbackType, name }
  }
  if (!isRecord(value)) return null
  const name = cleanName(firstValue(value, ['name', 'displayName', 'label', 'title', 'username', 'id']))
  if (!name) return null
  const rawId = cleanName(firstValue(value, ['id', 'uid', 'userId', 'key']))
  const rawType = cleanName(value.type)
  const type: EntityType = rawType === 'organization' || rawType === 'group' || rawType === 'place' || rawType === 'custom'
    ? rawType
    : fallbackType
  return {
    id: rawId || stableId('entity', name.toLocaleLowerCase()),
    type,
    name,
    ...(Array.isArray(value.aliases) ? { aliases: value.aliases.map(cleanName).filter((item): item is string => Boolean(item)) } : {}),
    ...(isRecord(value.metadata) ? { metadata: value.metadata } : {}),
  }
}

function participantValues(record: Record<string, unknown>): unknown[] {
  const values: unknown[] = []
  const list = firstValue(record, ['participants', 'participantIds', 'members', 'people', 'actors'])
  values.push(...participantList(list))
  for (const key of ['actor', 'actorId', 'sender', 'senderId', 'from', 'author', 'authorId', 'user', 'owner']) {
    if (record[key] !== undefined) values.push(...participantList(record[key]))
  }
  for (const key of ['recipient', 'recipientId', 'to', 'receiver', 'target']) {
    if (record[key] !== undefined) values.push(...participantList(record[key]))
  }
  return values
}

function interactionContent(record: Record<string, unknown>): string | undefined {
  const value = firstValue(record, ['content', 'text', 'body', 'message', 'transcript', 'value', 'description', 'summary'])
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim() || undefined
  if (isRecord(value)) {
    const nested = firstValue(value, ['text', 'content', 'body', 'value'])
    return typeof nested === 'string' || typeof nested === 'number' ? String(nested).trim() || undefined : undefined
  }
  return undefined
}

function interactionKind(record: Record<string, unknown>): string {
  return cleanName(firstValue(record, ['kind', 'type', 'channel', 'eventType', 'messageType'])) || 'interaction'
}

function candidateRecords(input: unknown): unknown[] {
  if (Array.isArray(input)) return input
  if (!isRecord(input)) return []
  for (const key of ['interactions', 'messages', 'records', 'events', 'items', 'data']) {
    if (Array.isArray(input[key])) return input[key] as unknown[]
  }
  return [input]
}

function parseEntityList(input: unknown): Entity[] {
  if (!Array.isArray(input)) return []
  return input.map((value) => entityFromValue(value, 'person')).filter((item): item is Entity => Boolean(item))
}

export type NormalizeOptions = {
  id?: string
  name?: string
  sourceName?: string
}

export function normalizeDataset(input: unknown, options: NormalizeOptions = {}): Dataset {
  const root = isRecord(input) ? input : null
  const explicitEntities = parseEntityList(root?.entities)
  const entityById = new Map<string, Entity>()
  const entityByName = new Map<string, Entity>()
  const addEntity = (entity: Entity): Entity => {
    const existing = entityById.get(entity.id) || entityByName.get(entity.name.toLocaleLowerCase())
    if (existing) {
      if (entity.aliases?.length) existing.aliases = Array.from(new Set([...(existing.aliases || []), ...entity.aliases]))
      return existing
    }
    entityById.set(entity.id, entity)
    entityByName.set(entity.name.toLocaleLowerCase(), entity)
    return entity
  }
  for (const entity of explicitEntities) addEntity(entity)

  const sourceRecords = candidateRecords(input)
  const interactions: Interaction[] = []
  const seen = new Set<string>()
  sourceRecords.forEach((raw, index) => {
    if (!isRecord(raw)) return
    const participants = participantValues(raw)
      .map((value) => entityFromValue(value))
      .filter((item): item is Entity => Boolean(item))
      .map(addEntity)
    const uniqueParticipants = Array.from(new Set(participants.map((item) => item.id)))
    if (uniqueParticipants.length === 0) return
    const occurredAt = normalizeDate(firstValue(raw, ['occurredAt', 'timestamp', 'time', 'date', 'createdAt', 'sentAt', 'datetime']))
    const kind = interactionKind(raw)
    const content = interactionContent(raw)
    const senderCandidate = firstValue(raw, ['actorId', 'actor', 'senderId', 'sender', 'from', 'authorId', 'author', 'owner'])
    const senderCandidateEntity = senderCandidate === undefined ? undefined : entityFromValue(senderCandidate)
    const senderEntity = senderCandidateEntity ? addEntity(senderCandidateEntity) : undefined
    const explicitId = cleanName(firstValue(raw, ['id', 'messageId', 'eventId', 'recordId']))
    const fingerprint = explicitId || `${uniqueParticipants.join(',')}|${occurredAt}|${kind}|${content || ''}|${index}`
    const id = explicitId || stableId('interaction', fingerprint)
    if (seen.has(id)) return
    seen.add(id)
    const metadata = isRecord(raw.metadata)
      ? raw.metadata
      : Object.fromEntries(Object.entries(raw).filter(([key]) => ![
      'id', 'messageId', 'eventId', 'recordId', 'participants', 'participantIds', 'members', 'people', 'actors',
        'actor', 'actorId', 'sender', 'senderId', 'from', 'author', 'authorId', 'user', 'owner', 'recipient', 'recipientId', 'to', 'receiver', 'target',
        'occurredAt', 'timestamp', 'time', 'date', 'createdAt', 'sentAt', 'datetime', 'kind', 'type', 'channel', 'eventType', 'messageType',
        'content', 'text', 'body', 'message', 'transcript', 'value', 'description', 'summary', 'metadata', 'sourceRef',
      ].includes(key)))
    const originalSourceRef = isRecord(raw.sourceRef) ? raw.sourceRef : undefined
    interactions.push({
      id,
      participants: uniqueParticipants,
      ...(senderEntity ? { actorId: senderEntity.id } : {}),
      occurredAt,
      kind,
      ...(content ? { content } : {}),
      ...(Object.keys(metadata).length || senderEntity ? {
        metadata: {
          ...metadata,
          ...(senderEntity ? { senderId: senderEntity.id } : {}),
        },
      } : {}),
      sourceRef: {
        datasetId: options.id || (cleanName(root?.id) || stableId('dataset', options.sourceName || 'dataset')),
        locator: cleanName(originalSourceRef?.locator) || `records[${index}]`,
        ...((cleanName(originalSourceRef?.label) || options.sourceName) ? { label: cleanName(originalSourceRef?.label) || options.sourceName } : {}),
      },
    })
  })

  interactions.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id))
  const datasetId = options.id || cleanName(root?.id) || stableId('dataset', options.sourceName || `${interactions.length}:${interactions[0]?.id || ''}`)
  const datasetName = options.name || cleanName(root?.name) || options.sourceName || 'Imported relationship dataset'
  // Source references must point at the final dataset identity, not the temporary import id.
  for (const interaction of interactions) interaction.sourceRef.datasetId = datasetId
  return {
    id: datasetId,
    name: datasetName,
    version: 1,
    entities: Array.from(entityById.values()).sort((a, b) => a.name.localeCompare(b.name)),
    interactions,
    ...(isRecord(root?.metadata) ? { metadata: root.metadata } : {}),
  }
}

/** Parse a small, dependency-free CSV dialect with quoted fields and escaped quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true
    } else if (character === ',') {
      row.push(cell.trim())
      cell = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell.trim())
      if (row.some((value) => value.length > 0)) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.trim())
    if (row.some((value) => value.length > 0)) rows.push(row)
  }
  const headers = rows.shift() || []
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header || `column_${index + 1}`, values[index] || ''])))
}

export function loadDatasetFromFile(filePath: string, options: NormalizeOptions = {}): Dataset {
  const sourceName = options.sourceName || filePath
  const text = readFileSync(filePath, 'utf8')
  const extension = extname(filePath).toLocaleLowerCase()
  if (extension === '.csv' || extension === '.tsv') {
    const parsed = extension === '.tsv' ? parseCsv(text.replace(/\t/g, ',')) : parseCsv(text)
    return normalizeDataset(parsed, { ...options, sourceName })
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    try {
      parsed = lines.map((line) => JSON.parse(line))
    } catch {
      throw new Error(`无法解析数据文件 ${filePath}：请提供 JSON、NDJSON、CSV 或 TSV`, { cause: error as Error })
    }
  }
  return normalizeDataset(parsed as DatasetInput, { ...options, sourceName })
}
