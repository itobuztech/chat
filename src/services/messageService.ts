import { ObjectId } from "mongodb";

import {
  getMessagesCollection,
  type MessageDocument,
} from "../lib/mongoClient";

type MessageStatus = "sent" | "delivered" | "read";

export interface MessageStatusResult {
  before: MessageDocument | null;
  after: MessageDocument;
  status: MessageStatus;
  timestamp: Date;
}

export async function updateMessageStatus(
  messageId: string,
  status: Exclude<MessageStatus, "sent">,
): Promise<MessageStatusResult | null> {
  if (!ObjectId.isValid(messageId)) {
    return null;
  }

  const messages = await getMessagesCollection();
  const _id = new ObjectId(messageId);
  const existing = await messages.findOne({ _id });

  if (!existing) {
    return null;
  }

  const now = new Date();
  const updates: Partial<MessageDocument> = {};
  let changed = false;

  if (status === "delivered" && !existing.delivered) {
    updates.delivered = true;
    updates.deliveredAt = now;
    changed = true;
  }

  if (status === "read") {
    if (!existing.read) {
      updates.read = true;
      updates.readAt = now;
      changed = true;
    }

    if (!existing.delivered) {
      updates.delivered = true;
      updates.deliveredAt = now;
      changed = true;
    }
  }

  if (!changed) {
    return {
      before: existing,
      after: existing,
      status,
      timestamp: existing.readAt ?? existing.deliveredAt ?? now,
    };
  }

  const result = await messages.findOneAndUpdate(
    { _id },
    { $set: updates },
    { returnDocument: "after" },
  );

  if (!result) {
    return null;
  }

  return {
    before: existing,
    after: result,
    status,
    timestamp:
      status === "read"
        ? result.readAt ?? now
        : result.deliveredAt ?? now,
  };
}
