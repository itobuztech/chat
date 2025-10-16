import type { GroupChatMessage } from "./groupMessagesApi"

export function dedupeAndSortGroupMessages(
  messages: GroupChatMessage[],
): GroupChatMessage[] {
  const map = new Map<string, GroupChatMessage>()

  for (const message of messages) {
    const key = message.id?.length
      ? message.id
      : `${message.groupId}-${message.senderId}-${message.createdAt}`
    if (map.has(key)) {
      const existing = map.get(key)!
      map.set(key, {
        ...existing,
        ...message,
        reactions: message.reactions ?? existing.reactions,
        readBy: { ...existing.readBy, ...message.readBy },
      })
    } else {
      map.set(key, message)
    }
  }

  return Array.from(map.values()).sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
  )
}
