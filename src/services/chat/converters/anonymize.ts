import { createId } from '../../../utils/id.js'
import type { Message, Session, UserMessage } from '../types.js'

export type AnonymizedSession = {
  session: Session
  /** 新文件 ID → 原文件 ID，导出附件时需要按原件读取 */
  fileIds: Map<string, string>
}

const remapMessages = (messages: Message[]) => {
  const ids = new Map(messages.map((message) => [message.id, createId()]))
  const parentId = (id?: string | null) => (id == null ? id : (ids.get(id) ?? id))
  const childId = (id?: string) => (id == null ? id : (ids.get(id) ?? id))
  return { ids, parentId, childId }
}

/** 重映射会话/消息/附件 ID，保持 parent/分支关系不变。 */
export const anonymizeSession = (original: Session): AnonymizedSession => {
  const { ids: messageIds, parentId, childId } = remapMessages(original.messages)
  const fileIds = new Map<string, string>()
  const oldFileIds = new Map<string, string>()
  const messages: Message[] = original.messages.map((message) => {
    const base = {
      ...message,
      id: messageIds.get(message.id) ?? message.id,
      parentId: parentId(message.parentId),
      selectedChildId: childId(message.selectedChildId),
    }
    if (message.role !== 'user') {
      return base
    }
    const files = message.files.map((file) => {
      if (!oldFileIds.has(file.id)) {
        const newId = createId()
        oldFileIds.set(file.id, newId)
        fileIds.set(newId, file.id)
      }
      return { ...file, id: oldFileIds.get(file.id) ?? file.id }
    })
    return { ...base, files } as UserMessage
  })
  return {
    session: {
      ...original,
      id: createId(),
      rootMessageId: original.rootMessageId
        ? (messageIds.get(original.rootMessageId) ?? original.rootMessageId)
        : null,
      messages,
    },
    fileIds,
  }
}

/** Claude 导出用：会话与消息 UUID 全部重映射。 */
export const anonymizeForClaude = (session: Session): Session => {
  const { ids: messageIds, parentId, childId } = remapMessages(session.messages)
  const messages: Message[] = session.messages.map((message) => ({
    ...message,
    id: messageIds.get(message.id) ?? message.id,
    parentId: parentId(message.parentId),
    selectedChildId: childId(message.selectedChildId),
  }))
  return {
    ...session,
    id: createId(),
    rootMessageId: session.rootMessageId
      ? (messageIds.get(session.rootMessageId) ?? session.rootMessageId)
      : null,
    messages,
  }
}
