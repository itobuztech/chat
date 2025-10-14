import type { ObjectId } from "mongodb";

import type {
  MessageDocument,
  WebRTCSignalDocument,
} from "../lib/mongoClient";
import type { ApiMessage, ApiSignal } from "../types/api";

type MessageWithId = MessageDocument & { _id?: ObjectId };
type SignalWithId = WebRTCSignalDocument & { _id?: ObjectId };

export function toApiMessage(doc: MessageWithId): ApiMessage {
  return {
    id: doc._id?.toString() ?? "",
    conversationId: doc.conversationId,
    senderId: doc.senderId,
    recipientId: doc.recipientId,
    content: doc.content,
    createdAt: doc.createdAt.toISOString(),
    delivered: Boolean(doc.delivered),
    deliveredAt: doc.deliveredAt?.toISOString(),
    read: Boolean(doc.read),
    readAt: doc.readAt?.toISOString(),
    replyTo: doc.replyTo
      ? {
          id: doc.replyTo.messageId.toString(),
          senderId: doc.replyTo.senderId,
          content: doc.replyTo.content,
          createdAt: doc.replyTo.createdAt.toISOString(),
        }
      : undefined,
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
    consumed: doc.consumed,
    consumedAt: doc.consumedAt?.toISOString(),
  };
}
