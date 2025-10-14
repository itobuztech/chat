export interface ApiMessage {
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

export interface ApiSignal {
  id: string;
  sessionId: string;
  senderId: string;
  recipientId: string;
  type: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
  consumed: boolean;
  consumedAt?: string;
}
