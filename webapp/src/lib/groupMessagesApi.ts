import { API_BASE_URL } from "./messagesApi"

export interface GroupChatMessage {
  id: string
  groupId: string
  senderId: string
  content: string
  createdAt: string
  replyTo?: {
    id: string
    senderId: string
    content: string
    createdAt: string
  }
  reactions?: {
    [emoji: string]: {
      userIds: string[]
      count: number
    }
  }
  readBy: Record<string, string>
}

export interface SendGroupMessagePayload {
  groupId: string
  senderId: string
  content: string
  replyToId?: string
}

export interface ReadReceiptPayload {
  userId: string
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const fallback = await response.json().catch(() => ({}))
    const message =
      typeof (fallback as { error?: string }).error === "string"
        ? (fallback as { error: string }).error
        : `Request failed with status ${response.status}`
    throw new Error(message)
  }

  return (await response.json()) as T
}

export async function sendGroupMessage(
  payload: SendGroupMessagePayload,
): Promise<GroupChatMessage> {
  const response = await fetch(`${API_BASE_URL}/api/group-messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  const data = await handleResponse<{ message: GroupChatMessage }>(response)
  return data.message
}

export async function fetchGroupMessages(
  groupId: string,
  limit = 100,
  before?: string,
): Promise<GroupChatMessage[]> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (before) {
    params.set("before", before)
  }
  const response = await fetch(
    `${API_BASE_URL}/api/group-messages/${groupId}?${params.toString()}`,
  )
  const data = await handleResponse<{ messages: GroupChatMessage[] }>(response)
  return data.messages
}

export async function markGroupMessageRead(
  messageId: string,
  userId: string,
): Promise<GroupChatMessage> {
  const response = await fetch(`${API_BASE_URL}/api/group-messages/${messageId}/read`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ userId }),
  })

  const data = await handleResponse<{ message: GroupChatMessage }>(response)
  return data.message
}

export async function addGroupReaction(
  messageId: string,
  emoji: string,
  userId: string,
): Promise<GroupChatMessage> {
  const response = await fetch(
    `${API_BASE_URL}/api/group-messages/${messageId}/reactions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ emoji, userId }),
    },
  )
  const data = await handleResponse<{ message: GroupChatMessage }>(response)
  return data.message
}

export async function removeGroupReaction(
  messageId: string,
  emoji: string,
  userId: string,
): Promise<GroupChatMessage> {
  const response = await fetch(
    `${API_BASE_URL}/api/group-messages/${messageId}/reactions`,
    {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ emoji, userId }),
    },
  )
  const data = await handleResponse<{ message: GroupChatMessage }>(response)
  return data.message
}
