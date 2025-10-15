import { ChatMessage } from './messagesApi'

export function dedupeAndSort(messages: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>()
  for (const message of messages) {
    const key =
      message.id && message.id.length > 0
        ? message.id
        : `${message.senderId}-${message.recipientId}-${message.createdAt}`
    if (map.has(key)) {
      const existing = map.get(key)!
      map.set(key, {
        ...existing,
        ...message,
        delivered: existing.delivered || message.delivered,
        deliveredAt: message.deliveredAt ?? existing.deliveredAt,
        read: existing.read || message.read,
        readAt: message.readAt ?? existing.readAt,
        replyTo: message.replyTo ?? existing.replyTo,
      })
    } else {
      map.set(key, message)
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
}
