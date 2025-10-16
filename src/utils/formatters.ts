import type { ObjectId } from "mongodb";

import type {
  GroupDocument,
  GroupMessageDocument,
  MessageDocument,
  WebRTCSignalDocument,
} from "../lib/mongoClient";
import type {
  ApiGroup,
  ApiGroupMessage,
  ApiMessage,
  ApiSignal,
} from "../types/api";

type MessageWithId = MessageDocument & { _id?: ObjectId };
type SignalWithId = WebRTCSignalDocument & { _id?: ObjectId };
type GroupWithId = GroupDocument & { _id?: ObjectId };
type GroupMessageWithId = GroupMessageDocument & { _id?: ObjectId };

export function toApiMessage(doc: MessageWithId): ApiMessage {
  return {
    id: doc._id?.toString() ?? "",
    conversationId: doc.conversationId,
    senderId: doc.senderId,
    recipientId: doc.recipientId,
    content: doc.content,
    createdAt: doc.createdAt.toISOString(),
    replyTo: doc.replyTo
      ? {
          id: doc.replyTo.messageId.toString(),
          senderId: doc.replyTo.senderId,
          content: doc.replyTo.content,
          createdAt: doc.replyTo.createdAt.toISOString(),
        }
      : undefined,
    reactions: doc.reactions,
  };
}

export function toApiSignal(doc: SignalWithId): ApiSignal {
  return {
    id: doc._id?.toString() ?? "",
    sessionId: doc.sessionId,
    senderId: doc.senderId,
    recipientId: doc.recipientId,
    type: doc.type,
    payload: doc.payload,
    createdAt: doc.createdAt.toISOString(),
  };
}

export function toApiGroup(doc: GroupWithId): ApiGroup {
  return {
    id: doc._id?.toString() ?? "",
    name: doc.name,
    description: doc.description,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    members: doc.members.map((member) => ({
      userId: member.userId,
      role: member.role,
      joinedAt: member.joinedAt.toISOString(),
    })),
  };
}

export function toApiGroupMessage(doc: GroupMessageWithId): ApiGroupMessage {
  return {
    id: doc._id?.toString() ?? "",
    groupId: doc.groupId,
    senderId: doc.senderId,
    content: doc.content,
    createdAt: doc.createdAt.toISOString(),
    replyTo: doc.replyTo
      ? {
          id: doc.replyTo.messageId.toString(),
          senderId: doc.replyTo.senderId,
          content: doc.replyTo.content,
          createdAt: doc.replyTo.createdAt.toISOString(),
        }
      : undefined,
    reactions: doc.reactions,
    readBy: Object.fromEntries(
      Object.entries(doc.readBy ?? {}).map(([userId, date]) => [
        userId,
        date.toISOString(),
      ]),
    ),
  };
}
