import { Router } from "express";
import { ObjectId } from "mongodb";

import {
  getMessagesCollection,
  type MessageDocument,
} from "../lib/mongoClient";
import {
  broadcastMessageStatus,
  broadcastNewMessage,
} from "../realtime/websocketHub";
import { updateMessageStatus } from "../services/messageService";
import { toApiMessage } from "../utils/formatters";

interface SendMessageRequestBody {
  senderId?: string;
  recipientId?: string;
  content?: string;
  replyToId?: string;
}

const router = Router();

router.post("/", async (req, res, next) => {
  try {
    const { senderId, recipientId, content } =
      req.body as SendMessageRequestBody;

    if (!senderId || !recipientId || !content) {
      return res.status(400).json({
        error: "senderId, recipientId and content are required.",
      });
    }

    const trimmedSender = senderId.trim();
    const trimmedRecipient = recipientId.trim();
    const normalizedContent = content.trim();

    if (!trimmedSender || !trimmedRecipient || !normalizedContent) {
      return res.status(400).json({
        error: "senderId, recipientId and content cannot be empty.",
      });
    }

    const conversationId = createConversationId(
      trimmedSender,
      trimmedRecipient,
    );

    const messages = await getMessagesCollection();
    const timestamp = new Date();

    const message: MessageDocument = {
      conversationId,
      senderId: trimmedSender,
      recipientId: trimmedRecipient,
      content: normalizedContent,
      createdAt: timestamp,
      delivered: false,
      read: false,
    };

    const replyToId =
      typeof req.body.replyToId === "string" ? req.body.replyToId.trim() : "";
    if (replyToId) {
      if (!ObjectId.isValid(replyToId)) {
        return res.status(400).json({ error: "Invalid replyToId value." });
      }

      const replyMessage = await messages.findOne({
        _id: new ObjectId(replyToId as string),
      });

      if (!replyMessage) {
        return res.status(404).json({ error: "Reply target not found." });
      }

      if (replyMessage.conversationId !== conversationId) {
        return res
          .status(400)
          .json({ error: "Reply must reference a message in the same conversation." });
      }

      message.replyTo = {
        messageId: replyMessage._id!,
        senderId: replyMessage.senderId,
        content: replyMessage.content,
        createdAt: replyMessage.createdAt,
      };
    }

    const result = await messages.insertOne(message);
    const storedMessage: MessageDocument & { _id?: ObjectId } = {
      ...message,
      _id: result.insertedId,
    };

    const apiMessage = toApiMessage(storedMessage);
    broadcastNewMessage(storedMessage);

    return res.status(201).json({
      message: apiMessage,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/conversation", async (req, res, next) => {
  try {
    const peerA = typeof req.query.peerA === "string" ? req.query.peerA : "";
    const peerB = typeof req.query.peerB === "string" ? req.query.peerB : "";
    const limit =
      typeof req.query.limit === "string" ? Number(req.query.limit) : 50;
    const beforeId =
      typeof req.query.before === "string" ? req.query.before : undefined;

    if (!peerA || !peerB) {
      return res
        .status(400)
        .json({ error: "peerA and peerB query params are required." });
    }

    const maxLimit = Number.isFinite(limit) ? Math.min(Math.abs(limit), 200) : 50;

    const messages = await getMessagesCollection();

    if (beforeId && !ObjectId.isValid(beforeId)) {
      return res.status(400).json({ error: "Invalid before cursor value." });
    }

    const cursorFilter =
      beforeId !== undefined
        ? { _id: { $lt: new ObjectId(beforeId) } }
        : {};

    const results = await messages
      .find(
        {
          conversationId: createConversationId(peerA, peerB),
          ...cursorFilter,
        },
        { sort: { _id: -1 }, limit: maxLimit },
      )
      .toArray();

    return res.json({
      messages: results
        .map((doc) => toApiMessage(doc))
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/pending/:recipientId", async (req, res, next) => {
  try {
    const { recipientId } = req.params;
    if (!recipientId) {
      return res.status(400).json({ error: "recipientId is required." });
    }

    const after =
      typeof req.query.after === "string" ? req.query.after : undefined;

    const messages = await getMessagesCollection();

    if (after && !ObjectId.isValid(after)) {
      return res.status(400).json({ error: "Invalid after cursor value." });
    }

    const cursorFilter =
      after !== undefined ? { _id: { $gt: new ObjectId(after) } } : {};

    const pendingMessages = await messages
      .find(
        {
          recipientId: recipientId.trim(),
          delivered: false,
          ...cursorFilter,
        },
        { sort: { createdAt: 1 } },
      )
      .toArray();

    if (pendingMessages.length === 0) {
      return res.json({ messages: [] });
    }

    const ids = pendingMessages.map((doc) => doc._id).filter(Boolean) as ObjectId[];

    const deliveredAt = new Date();

    await messages.updateMany(
      { _id: { $in: ids } },
      { $set: { delivered: true, deliveredAt } },
    );

    for (const doc of pendingMessages) {
      if (!doc._id) {
        continue;
      }
      const messageId = doc._id.toString();
      broadcastMessageStatus({
        messageId,
        conversationId: doc.conversationId,
        senderId: doc.senderId,
        recipientId: doc.recipientId,
        status: "delivered",
        timestamp: deliveredAt.getTime(),
      });
    }

    return res.json({
      messages: pendingMessages.map((doc) => {
        const formatted = toApiMessage(doc);
        return {
          ...formatted,
          delivered: true,
          deliveredAt: formatted.deliveredAt ?? deliveredAt.toISOString(),
        };
      }),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/conversations", async (req, res, next) => {
  try {
    const userId =
      typeof req.query.userId === "string" ? req.query.userId.trim() : "";

    if (!userId) {
      return res
        .status(400)
        .json({ error: "userId query parameter is required." });
    }

    const messages = await getMessagesCollection();

    const results = await messages
      .aggregate<{
        _id: string;
        lastMessage: MessageDocument & { _id: ObjectId };
        unreadCount: number;
      }>([
        {
          $match: {
            $or: [{ senderId: userId }, { recipientId: userId }],
          },
        },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: "$conversationId",
            lastMessage: { $first: "$$ROOT" },
            unreadCount: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ["$recipientId", userId] },
                      { $eq: ["$read", false] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $sort: { "lastMessage.createdAt": -1 } },
      ])
      .toArray();

    const conversations = results.map((entry) => {
      const [peerA, peerB] = entry._id.split("#");
      const peerId = peerA === userId ? peerB : peerA;
      const lastMessage = toApiMessage(entry.lastMessage);
      return {
        conversationId: entry._id,
        peerId,
        lastMessage,
        unreadCount: entry.unreadCount,
      };
    });

    return res.json({ conversations });
  } catch (error) {
    next(error);
  }
});

router.patch("/:messageId/status", async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const status = req.body?.status;

    if (status !== "delivered" && status !== "read") {
      return res.status(400).json({
        error: "status must be either 'delivered' or 'read'.",
      });
    }

    const result = await updateMessageStatus(messageId, status);

    if (!result) {
      return res.status(404).json({ error: "Message not found." });
    }

    const timestamp = result.timestamp.getTime();
    const apiMessage = toApiMessage(result.after);

    broadcastMessageStatus({
      messageId: apiMessage.id,
      conversationId: apiMessage.conversationId,
      senderId: apiMessage.senderId,
      recipientId: apiMessage.recipientId,
      status,
      timestamp,
    });

    return res.json({
      message: apiMessage,
      status,
      timestamp: new Date(timestamp).toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

function createConversationId(peerA: string, peerB: string): string {
  return [peerA.trim(), peerB.trim()].sort((a, b) => a.localeCompare(b)).join("#");
}

export default router;
