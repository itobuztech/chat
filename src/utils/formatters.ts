import type { ObjectId } from "mongodb";

import type {
  MessageDocument,
  WebRTCSignalDocument,
} from "../lib/mongoClient.js";
import type { ApiMessage, ApiSignal } from "../types/api.js";

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
    delivered: doc.delivered,
    deliveredAt: doc.deliveredAt?.toISOString(),
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
