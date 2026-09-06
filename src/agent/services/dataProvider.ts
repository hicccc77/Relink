import { createHash } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'

export type Message = Record<string, any> & {
  content: string
  parsedContent: string
  rawContent: string
  quotedContent?: string
}
export type ConversationAnalysisScanMessage = Record<string, any> & {
  localId?: number | string
  localType?: number | string
  createTime?: number | string
  sortSeq?: number | string
  isSend?: number | boolean
  actorId?: string
  senderUsername?: string
  senderDisplayName?: string
  participants?: string[]
}

export type RelationshipSession = {
  username: string
  displayName?: string
  avatarUrl?: string
  sortTimestamp?: number
  lastTimestamp?: number
  messageCountHint?: number
  type?: number
  [key: string]: any
}

export type RelinkDataProvider = {
  /** Optional metadata access used by the SDK/API without coupling the Agent to a schema. */
  getDataset?: () => Promise<DatasetLike | undefined> | DatasetLike | undefined
  getDatasetSummary?: () => Promise<Record<string, unknown>> | Record<string, unknown>
  findSessionForEntities?: (entityIds: string[]) => string | undefined
  findSessionsForEntities?: (entityIds: string[]) => string[]
  connect?: () => Promise<{ success: boolean; error?: string }>
  getSessions: () => Promise<{ success: boolean; sessions?: RelationshipSession[]; error?: string }>
  getSessionDetail: (sessionId: string) => Promise<{ success: boolean; detail?: any; error?: string }>
  getSessionMessageCounts?: (sessionIds: string[], options?: any) => Promise<{ success: boolean; counts?: Record<string, number>; error?: string }>
  getExportSessionStats?: (sessionIds: string[], options?: any) => Promise<{ success: boolean; data?: Record<string, any>; error?: string }>
  getMessages: (sessionId: string, offset?: number, limit?: number, beginTimestamp?: number, endTimestamp?: number, ascending?: boolean) => Promise<{ success: boolean; messages?: Message[]; hasMore?: boolean; error?: string }>
  getMessagesAround: (sessionId: string, target: any, contextCount?: number) => Promise<{ success: boolean; before: Message[]; after: Message[]; hasMoreBefore?: boolean; hasMoreAfter?: boolean; error?: string }>
  getMessageWindowForJump: (sessionId: string, target: any, contextCount?: number) => Promise<{ success: boolean; messages?: Message[]; hasMore?: boolean; error?: string }>
  getMessageDateCounts: (sessionId: string) => Promise<{ success: boolean; counts?: Record<string, number>; error?: string }>
  scanConversationMessagesForAnalysis: (sessionId: string, options: any, onBatch: (messages: ConversationAnalysisScanMessage[]) => void | Promise<void>) => Promise<{ success: boolean; scannedMessages: number; sourceExhausted: boolean; error?: string }>
  searchMessages: (keyword: string, sessionId?: string, limit?: number, offset?: number, beginTimestamp?: number, endTimestamp?: number) => Promise<{ success: boolean; messages?: Message[]; error?: string }>
  getCachedVoiceTranscript?: (sessionId: string, messageId: string, createTime?: number, messageKey?: string) => string | undefined
  /** Implementations may accept the richer positional arguments used by the Agent (timestamps, sender, callbacks). */
  getVoiceTranscript?: (...args: any[]) => Promise<{ success: boolean; transcript?: string; error?: string }>
  getImageData?: (...args: any[]) => Promise<{ success: boolean; data?: string; error?: string }>
  getTimeline?: (...args: any[]) => Promise<any>
  downloadImage?: (...args: any[]) => Promise<any>
  getVoiceModelStatus?: () => Promise<any>
  searchWeb?: (input: any, signal?: AbortSignal) => Promise<any>
  [key: string]: any
}

let activeProvider: RelinkDataProvider = createEmptyProvider()
const providerContext = new AsyncLocalStorage<RelinkDataProvider>()

function currentProvider(): RelinkDataProvider {
  return providerContext.getStore() || activeProvider
}

function createEmptyProvider(): RelinkDataProvider {
  const unavailable = async () => ({ success: false, error: '没有配置关系数据 Provider' })
  const emptyMessages = async () => ({ success: true, messages: [], hasMore: false })
  const emptyCounts = async () => ({ success: true, counts: {} })
  return {
    connect: async () => ({ success: true }),
    getSessions: async () => ({ success: true, sessions: [] }),
    getSessionDetail: unavailable,
    getSessionMessageCounts: emptyCounts,
    getExportSessionStats: async () => ({ success: true, data: {} }),
    getMessages: emptyMessages,
    getMessagesAround: async () => ({ success: true, before: [], after: [], hasMoreBefore: false, hasMoreAfter: false }),
    getMessageWindowForJump: emptyMessages,
    getMessageDateCounts: emptyCounts,
    scanConversationMessagesForAnalysis: async (_sessionId, _options, _onBatch) => ({ success: true, scannedMessages: 0, sourceExhausted: true }),
    searchMessages: emptyMessages,
    getCachedVoiceTranscript: () => undefined,
    getVoiceTranscript: unavailable,
    getImageData: unavailable,
    getTimeline: async () => ({ success: true, timeline: [] }),
    downloadImage: unavailable,
    getVoiceModelStatus: async () => ({ available: false }),
    searchWeb: async () => ({ success: false, error: '没有配置 webSearch Provider' }),
  }
}

export function setRelinkDataProvider(provider: RelinkDataProvider | null | undefined): RelinkDataProvider {
  activeProvider = provider || createEmptyProvider()
  return activeProvider
}

export function getRelinkDataProvider(): RelinkDataProvider {
  return currentProvider()
}

/** Keep provider selection isolated when several runtimes run concurrently. */
export function runWithRelinkDataProvider<T>(provider: RelinkDataProvider, operation: () => T | Promise<T>): T | Promise<T> {
  return providerContext.run(provider, operation)
}

function invokeProvider(method: string, args: any[], fallback: () => any): any {
  const provider = currentProvider()
  const candidate = (provider as any)[method]
  return typeof candidate === 'function' ? Reflect.apply(candidate, provider, args) : fallback()
}

class ProviderFacade {
  connect(...args: any[]) { return invokeProvider('connect', args, () => Promise.resolve({ success: true })) }
  getSessions(...args: any[]) { return (currentProvider() as any).getSessions(...args) }
  getSessionDetail(...args: any[]) { return (currentProvider() as any).getSessionDetail(...args) }
  getSessionMessageCounts(...args: any[]) { return invokeProvider('getSessionMessageCounts', args, () => Promise.resolve({ success: true, counts: {} })) }
  getExportSessionStats(...args: any[]) { return invokeProvider('getExportSessionStats', args, () => Promise.resolve({ success: true, data: {} })) }
  getMessages(...args: any[]) { return (currentProvider() as any).getMessages(...args) }
  getMessagesAround(...args: any[]) { return (currentProvider() as any).getMessagesAround(...args) }
  getMessageWindowForJump(...args: any[]) { return (currentProvider() as any).getMessageWindowForJump(...args) }
  getMessageDateCounts(...args: any[]) { return (currentProvider() as any).getMessageDateCounts(...args) }
  scanConversationMessagesForAnalysis(...args: any[]) { return (currentProvider() as any).scanConversationMessagesForAnalysis(...args) }
  searchMessages(...args: any[]) { return (currentProvider() as any).searchMessages(...args) }
  getCachedVoiceTranscript(...args: any[]) { return (currentProvider() as any).getCachedVoiceTranscript?.(...args) }
  getVoiceTranscript(...args: any[]) { return invokeProvider('getVoiceTranscript', args, () => Promise.resolve({ success: false, error: '没有配置语音 Provider' })) }
  getImageData(...args: any[]) { return invokeProvider('getImageData', args, () => Promise.resolve({ success: false, error: '没有配置图像 Provider' })) }
}

/** Conversation and interaction facade consumed by the Agent. */
export const recordService = new ProviderFacade()

export const voiceTranscribeService = {
  getModelStatus: (...args: any[]) => invokeProvider('getVoiceModelStatus', args, () => Promise.resolve({ available: false })),
}

/** Optional secondary record source (timeline, feed, or any external stream). */
export const externalRecordService = {
  getTimeline: (...args: any[]) => invokeProvider('getTimeline', args, () => Promise.resolve({ success: true, timeline: [] })),
  downloadImage: (...args: any[]) => invokeProvider('downloadImage', args, () => Promise.resolve({ success: false, error: '没有配置图像下载 Provider' })),
}

export function normalizeWebSearchQuerySignature(value: unknown): string {
  return String(value || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase().slice(0, 1_000)
}

export function searchWeb(input: any, signal?: AbortSignal): Promise<any> {
  return invokeProvider('searchWeb', [input, signal], () => Promise.resolve({ success: false, error: '没有配置 webSearch Provider' }))
}

export type DatasetLike = {
  id?: string
  name?: string
  entities?: Array<{ id: string; name?: string; aliases?: string[]; type?: string }>
  interactions?: Array<{
    id?: string
    participants: string[]
    actorId?: string
    occurredAt: string
    kind?: string
    content?: string
    metadata?: Record<string, unknown>
    sourceRef?: Record<string, unknown>
  }>
}

type SessionBucket = { session: RelationshipSession; messages: Message[] }

/**
 * Adapt a generic dataset to the conversation operations expected by the Agent.
 * The Agent sees stable session/message locators, never the original product's schema.
 */
export class DatasetProvider implements RelinkDataProvider {
  private readonly sessions = new Map<string, SessionBucket>()
  private readonly messageById = new Map<string, Message>()
  private readonly entityNames = new Map<string, string>()

  constructor(private readonly dataset: DatasetLike) {
    for (const entity of dataset.entities || []) this.entityNames.set(entity.id, entity.name || entity.id)
    const grouped = new Map<string, { participants: string[]; interactions: any[] }>()
    for (const interaction of dataset.interactions || []) {
      const participants = Array.from(new Set((interaction.participants || []).map(String).filter(Boolean))).sort()
      if (participants.length === 0) continue
      // Preserve explicit conversation/thread boundaries when a source has
      // them; otherwise all events for the same participant set form one
      // stable relation session.
      const metadata = interaction.metadata || {}
      const sessionHint = String(metadata.sessionId || metadata.conversationId || metadata.threadId || '').trim()
      const key = `rel_${createHash('sha256').update(`${participants.join('\u0001')}\u0000${sessionHint}`).digest('hex').slice(0, 16)}`
      const group = grouped.get(key) || { participants, interactions: [] }
      group.interactions.push(interaction)
      grouped.set(key, group)
    }
    for (const [sessionId, group] of grouped) {
      const messages = group.interactions.map((interaction, index) => this.toMessage(interaction, group.participants, index + 1, sessionId))
        .sort((a, b) => a.createTime - b.createTime || a.sortSeq - b.sortSeq)
      const first = messages[0]?.createTime || 0
      const last = messages.at(-1)?.createTime || 0
      const displayName = group.participants.map((id) => this.entityNames.get(id) || id).join(' + ')
      const isGroup = group.participants.length > 2
        || group.participants.some((id) => String(dataset.entities?.find((entity) => entity.id === id)?.type || '') === 'group')
        || group.interactions.some((interaction) => interaction.metadata?.isGroup === true || Number(interaction.metadata?.isGroup) === 1)
      const session: RelationshipSession = {
        username: sessionId,
        participantIds: group.participants.join('\u0001'),
        participants: group.participants,
        displayName,
        type: isGroup ? 2 : 1,
        isGroup,
        sortTimestamp: last,
        lastTimestamp: last,
        messageCountHint: messages.length,
        firstTimestamp: first,
        latestTimestamp: last,
      }
      this.sessions.set(sessionId, { session, messages })
      for (const message of messages) this.messageById.set(`${sessionId}:${message.localId}`, message)
    }
  }

  getDataset(): DatasetLike {
    return this.dataset
  }

  getDatasetSummary(): Record<string, unknown> {
    const interactions = this.dataset.interactions || []
    const dates = interactions.map((item) => Date.parse(item.occurredAt)).filter(Number.isFinite).sort((a, b) => a - b)
    return {
      id: this.dataset.id,
      name: this.dataset.name,
      entityCount: (this.dataset.entities || []).length,
      interactionCount: interactions.length,
      sessionCount: this.sessions.size,
      firstInteractionAt: dates.length ? new Date(dates[0]).toISOString() : undefined,
      lastInteractionAt: dates.length ? new Date(dates.at(-1) as number).toISOString() : undefined,
    }
  }

  findSessionForEntities(entityIds: string[]): string | undefined {
    const wanted = new Set(entityIds.map(String).filter(Boolean))
    if (!wanted.size) return undefined
    return Array.from(this.sessions.entries())
      .find(([, bucket]) => {
        const participants = String(bucket.session.participantIds || bucket.session.username || '')
          .split('\u0001')
          .filter(Boolean)
        return participants.length === wanted.size && participants.every((id) => wanted.has(id))
      })?.[0]
      || Array.from(this.sessions.entries()).find(([, bucket]) => {
        const participants = String(bucket.session.participantIds || '').split('\u0001').filter(Boolean)
        return entityIds.every((id) => participants.includes(String(id)))
      })?.[0]
  }

  findSessionsForEntities(entityIds: string[]): string[] {
    const wanted = new Set(entityIds.map(String).filter(Boolean))
    if (!wanted.size) return []
    return Array.from(this.sessions.entries()).filter(([, bucket]) => {
      const participants = String(bucket.session.participantIds || '').split('\u0001').filter(Boolean)
      return entityIds.every((id) => participants.includes(String(id)))
    }).map(([sessionId]) => sessionId)
  }

  async connect() { return { success: true } }
  async getSessions() { return { success: true, sessions: Array.from(this.sessions.values()).map(({ session }) => session) } }

  async getSessionDetail(sessionId: string) {
    const bucket = this.sessions.get(String(sessionId))
    if (!bucket) return { success: false, error: '未找到会话' }
    const dates = this.dateCounts(bucket.messages)
    return {
      success: true,
      detail: {
        id: bucket.session.username,
        sessionId: bucket.session.username,
        displayName: bucket.session.displayName,
        messageCount: bucket.messages.length,
        firstMessageTime: bucket.messages[0]?.createTime,
        latestMessageTime: bucket.messages.at(-1)?.createTime,
        messageTables: [{ count: bucket.messages.length }],
        messageDateCounts: dates,
      },
    }
  }

  async getSessionMessageCounts(sessionIds: string[]) {
    return { success: true, counts: Object.fromEntries(sessionIds.map((id) => [id, this.sessions.get(id)?.messages.length || 0])) }
  }

  async getExportSessionStats(sessionIds: string[]) {
    const data: Record<string, any> = {}
    for (const id of sessionIds) {
      const messages = this.sessions.get(id)?.messages || []
      const counts = this.dateCounts(messages)
      data[id] = {
        totalMessages: messages.length,
        messageDateCounts: counts,
        firstTimestamp: messages[0]?.createTime,
        lastTimestamp: messages.at(-1)?.createTime,
        voiceMessages: messages.filter((item) => item.localType === 34).length,
        imageMessages: messages.filter((item) => item.localType === 3).length,
        videoMessages: messages.filter((item) => item.localType === 43).length,
      }
    }
    return { success: true, data }
  }

  async getMessages(sessionId: string, offset = 0, limit = 50, beginTimestamp = 0, endTimestamp = 0, ascending = false) {
    const bucket = this.sessions.get(String(sessionId))
    if (!bucket) return { success: false, messages: [], hasMore: false, error: '未找到会话' }
    let messages = bucket.messages.filter((message) => (!beginTimestamp || message.createTime >= beginTimestamp) && (!endTimestamp || message.createTime <= endTimestamp))
    messages = [...messages].sort((a, b) => ascending ? a.createTime - b.createTime : b.createTime - a.createTime)
    const page = messages.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit))
    return { success: true, messages: page, hasMore: Math.max(0, offset) + page.length < messages.length }
  }

  async getMessagesAround(sessionId: string, target: any, contextCount = 120) {
    const bucket = this.sessions.get(String(sessionId))
    if (!bucket) return { success: false, before: [], after: [], error: '未找到会话' }
    const index = this.findIndex(bucket.messages, target)
    if (index < 0) return { success: false, before: [], after: [], error: '未找到锚点消息' }
    const count = Math.max(1, Math.floor(contextCount))
    return { success: true, before: bucket.messages.slice(Math.max(0, index - count), index), after: bucket.messages.slice(index + 1, index + 1 + count), hasMoreBefore: index > count, hasMoreAfter: index + count + 1 < bucket.messages.length }
  }

  async getMessageWindowForJump(sessionId: string, target: any, contextCount = 120) {
    const around = await this.getMessagesAround(sessionId, target, Math.ceil(contextCount / 2))
    if (!around.success) return { success: false, messages: [], error: around.error }
    return { success: true, messages: [...around.before, ...(this.getTarget(sessionId, target) ? [this.getTarget(sessionId, target)!] : []), ...around.after], hasMore: around.hasMoreBefore || around.hasMoreAfter }
  }

  async getMessageDateCounts(sessionId: string) {
    const bucket = this.sessions.get(String(sessionId))
    return bucket ? { success: true, counts: this.dateCounts(bucket.messages) } : { success: false, counts: {}, error: '未找到会话' }
  }

  async scanConversationMessagesForAnalysis(sessionId: string, options: any, onBatch: (messages: ConversationAnalysisScanMessage[]) => void | Promise<void>) {
    const result = await this.getMessages(sessionId, 0, Math.max(1_000, options?.maxMessages || 300_000), options?.beginTimestamp, options?.endTimestamp, true)
    if (!result.success) return { success: false, scannedMessages: 0, sourceExhausted: false, error: result.error }
    const records = (result.messages || []).map((message) => ({
      localId: message.localId,
      localType: message.localType,
      createTime: message.createTime,
      sortSeq: message.sortSeq,
      isSend: message.isSend,
      actorId: message.actorId || message.senderUsername,
      senderUsername: message.senderUsername,
      senderDisplayName: message.senderDisplayName,
      participants: message.participants,
      parsedContent: message.parsedContent,
      rawContent: message.rawContent,
      content: message.content,
      metadata: message.metadata,
    }))
    const batchSize = Math.max(400, Math.min(4_000, options?.batchSize || 2_000))
    for (let index = 0; index < records.length; index += batchSize) await onBatch(records.slice(index, index + batchSize))
    return { success: true, scannedMessages: records.length, sourceExhausted: true }
  }

  async searchMessages(keyword: string, sessionId?: string, limit = 50, offset = 0, beginTimestamp = 0, endTimestamp = 0) {
    const buckets = sessionId ? [this.sessions.get(sessionId)].filter(Boolean) as SessionBucket[] : Array.from(this.sessions.values())
    const query = String(keyword || '').toLocaleLowerCase()
    const matches = buckets.flatMap((bucket) => bucket.messages.filter((message) => String(message.content || '').toLocaleLowerCase().includes(query) && (!beginTimestamp || message.createTime >= beginTimestamp) && (!endTimestamp || message.createTime <= endTimestamp)))
    return { success: true, messages: matches.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit)) }
  }

  getCachedVoiceTranscript() { return undefined }
  async getVoiceTranscript(sessionId: string, messageId: string) {
    const message = this.sessions.get(String(sessionId))?.messages.find((item) => String(item.localId) === String(messageId))
    const transcript = message?.metadata?.transcript || message?.metadata?.textTranscript
    return transcript ? { success: true, transcript: String(transcript) } : { success: false, error: '该数据集未提供语音转写' }
  }
  async getImageData(sessionId: string, messageId: string) {
    const message = this.sessions.get(String(sessionId))?.messages.find((item) => String(item.localId) === String(messageId))
    const data = message?.metadata?.imageData || message?.metadata?.data
    return data ? { success: true, data: String(data) } : { success: false, error: '该数据集未提供图像数据' }
  }
  async getTimeline(limit = 20, offset = 0, usernames?: string[], query?: string, startTime?: number, endTime?: number) {
    const normalizedQuery = String(query || '').toLocaleLowerCase()
    const allowedAuthors = new Set((usernames || []).map(String).filter(Boolean))
    const timeline = (this.dataset.interactions || [])
      .map((interaction, index) => ({ interaction, index }))
      .filter(({ interaction }) => {
        const time = Date.parse(interaction.occurredAt) / 1_000
        const author = String(interaction.actorId || interaction.metadata?.senderId || '')
        const content = String(interaction.content || '').toLocaleLowerCase()
        return (!allowedAuthors.size || allowedAuthors.has(author))
          && (!normalizedQuery || content.includes(normalizedQuery))
          && (!startTime || time >= startTime)
          && (!endTime || time <= endTime)
      })
      .sort((a, b) => Date.parse(b.interaction.occurredAt) - Date.parse(a.interaction.occurredAt) || a.index - b.index)
      .slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit))
      .map(({ interaction }) => ({
        id: String(interaction.id || ''),
        username: String(interaction.actorId || interaction.metadata?.senderId || ''),
        nickname: this.entityNames.get(String(interaction.actorId || interaction.metadata?.senderId || '')),
        createTime: Math.floor(Date.parse(interaction.occurredAt) / 1_000),
        contentDesc: String(interaction.content || ''),
        comments: Array.isArray(interaction.metadata?.comments) ? interaction.metadata.comments : [],
        likes: Array.isArray(interaction.metadata?.likes) ? interaction.metadata.likes : [],
        media: Array.isArray(interaction.metadata?.media) ? interaction.metadata.media : [],
      }))
    return { success: true, timeline }
  }
  async downloadImage(source: string) {
    const value = String(source || '')
    if (/^data:image\//i.test(value)) {
      const comma = value.indexOf(',')
      if (comma < 0) return { success: false, error: '图像 data URL 无效' }
      const payload = value.slice(comma + 1)
      return { success: true, data: /;base64,/i.test(value.slice(0, comma + 1)) ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8') }
    }
    return { success: false, error: '该数据集未提供图像下载' }
  }
  async getVoiceModelStatus() { return { available: false } }

  private dateCounts(messages: Message[]): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const message of messages) {
      const date = new Date(message.createTime * 1_000).toISOString().slice(0, 10)
      counts[date] = (counts[date] || 0) + 1
    }
    return counts
  }

  private findIndex(messages: Message[], target: any): number {
    return messages.findIndex((message) => (target?.messageKey && message.messageKey === target.messageKey) || (Number(target?.localId) > 0 && message.localId === Number(target.localId) && (!target.createTime || message.createTime === Number(target.createTime))))
  }

  private getTarget(sessionId: string, target: any): Message | undefined {
    const bucket = this.sessions.get(sessionId)
    const index = bucket ? this.findIndex(bucket.messages, target) : -1
    return index >= 0 ? bucket?.messages[index] : undefined
  }

  private toMessage(interaction: any, participants: string[], localId: number, sessionId: string): Message {
    const date = new Date(interaction.occurredAt)
    const createTime = Number.isNaN(date.getTime()) ? 0 : Math.floor(date.getTime() / 1_000)
    const senderUsername = String(interaction.actorId || interaction.metadata?.senderId || '')
    const kind = String(interaction.kind || 'interaction')
    const localType = kind === 'image' ? 3 : kind === 'voice' || kind === 'audio' ? 34 : kind === 'video' ? 43 : kind === 'file' ? 49 : 1
    const content = String(interaction.content || '')
    const message: Message = {
      messageKey: String(interaction.id || `${sessionId}:${localId}`),
      localId,
      serverId: localId,
      localType,
      createTime,
      sortSeq: localId,
      ...(interaction.metadata?.isSend === undefined ? {} : { isSend: interaction.metadata.isSend ? 1 : 0 }),
      senderUsername,
      senderDisplayName: senderUsername ? (this.entityNames.get(senderUsername) || senderUsername) : undefined,
      parsedContent: content,
      rawContent: content,
      content,
      quotedContent: interaction.metadata?.quotedContent,
      quotedSender: interaction.metadata?.quotedSender,
      voiceDurationSeconds: Number(interaction.metadata?.durationSeconds || 0) || undefined,
      imageDatName: interaction.metadata?.imageRef,
      fileName: interaction.metadata?.fileName,
      linkUrl: interaction.metadata?.url,
      sessionId,
      participants,
      interactionKind: kind,
      metadata: interaction.metadata || {},
      sourceRef: interaction.sourceRef,
      interactionId: interaction.id,
    }
    this.messageById.set(`${sessionId}:${localId}`, message)
    return message
  }
}
