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

export type ApiGroupMemberRole = "owner" | "admin" | "member";

export interface ApiGroupMember {
  userId: string;
  role: ApiGroupMemberRole;
  joinedAt: string;
}

export interface ApiGroup {
  id: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  members: ApiGroupMember[];
}

export interface ApiGroupMessage {
  id: string;
  groupId: string;
  senderId: string;
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
  readBy: Record<string, string>;
}
