export interface ApiMessage {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  createdAt: string;
  replyTo?: {
    id: string;
    senderId: string;
    content: string;
    createdAt: string;
  };
  reactions?: {
    [emoji: string]: {
      userIds: string[];
      count: number;
    };
  };
}

export interface ApiSignal {
  id: string;
  sessionId: string;
  senderId: string;
  recipientId: string;
  type: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}
