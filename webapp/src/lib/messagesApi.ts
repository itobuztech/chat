export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  createdAt: string;
  delivered: boolean;
  deliveredAt?: string;
  read: boolean;
  readAt?: string;
}

export interface SendMessagePayload {
  senderId: string;
  recipientId: string;
  content: string;
}

export interface ConversationSummary {
  conversationId: string;
  peerId: string;
  lastMessage: ChatMessage;
  unreadCount: number;
}

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await response
      .json()
      .catch(() => ({ error: response.statusText }));
    throw new Error(
      typeof message?.error === "string"
        ? message.error
        : `Request failed with status ${response.status}`,
    );
  }

  return response.json() as Promise<T>;
}

export async function sendMessage(
  payload: SendMessagePayload,
): Promise<ChatMessage> {
  const response = await fetch(`${API_BASE_URL}/api/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await handleResponse<{ message: ChatMessage }>(response);
  return data.message;
}

export async function fetchConversation(
  peerA: string,
  peerB: string,
  limit = 100,
): Promise<ChatMessage[]> {
  const params = new URLSearchParams({
    peerA,
    peerB,
    limit: String(limit),
  });
  const response = await fetch(
    `${API_BASE_URL}/api/messages/conversation?${params.toString()}`,
  );
  const data = await handleResponse<{ messages: ChatMessage[] }>(response);
  return data.messages;
}

export async function fetchConversations(
  userId: string,
): Promise<ConversationSummary[]> {
  const params = new URLSearchParams({ userId });
  const response = await fetch(
    `${API_BASE_URL}/api/messages/conversations?${params.toString()}`,
  );
  const data = await handleResponse<{ conversations: ConversationSummary[] }>(
    response,
  );
  return data.conversations;
}
