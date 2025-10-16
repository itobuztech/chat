import { Router } from "express";
import { ObjectId } from "mongodb";

import {
  getGroupMessagesCollection,
  getGroupsCollection,
  type GroupMember,
  type GroupMessageDocument,
} from "../lib/mongoClient";
import {
  broadcastGroupMessage,
  broadcastGroupMessageUpdate,
} from "../realtime/websocketHub";
import { toApiGroupMessage } from "../utils/formatters";

interface SendGroupMessageBody {
  groupId?: unknown;
  senderId?: unknown;
  content?: unknown;
  replyToId?: unknown;
}

interface ReadReceiptBody {
  userId?: unknown;
}

interface ReactionBody {
  emoji?: unknown;
  userId?: unknown;
}

const router = Router();

router.post("/", async (req, res, next) => {
  try {
    const { groupId, senderId, content, replyToId } =
      req.body as SendGroupMessageBody;

    if (typeof groupId !== "string" || groupId.trim().length === 0) {
      return res.status(400).json({ error: "groupId is required." });
    }
    if (typeof senderId !== "string" || senderId.trim().length === 0) {
      return res.status(400).json({ error: "senderId is required." });
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "content is required." });
    }

    if (!ObjectId.isValid(groupId)) {
      return res.status(400).json({ error: "Invalid groupId provided." });
    }

    const groups = await getGroupsCollection();
    const group = await groups.findOne({ _id: new ObjectId(groupId) });

    if (!group) {
      return res.status(404).json({ error: "Group not found." });
    }

    const normalizedSender = senderId.trim();
    const normalizedContent = content.trim();

    if (!isMember(group.members, normalizedSender)) {
      return res
        .status(403)
        .json({ error: "Sender must be a member of the group." });
    }

    const messages = await getGroupMessagesCollection();
    const createdAt = new Date();

    const messageDoc: GroupMessageDocument = {
      groupId: group._id!.toString(),
      senderId: normalizedSender,
      content: normalizedContent,
      createdAt,
      readBy: {
        [normalizedSender]: createdAt,
      },
    };

    if (typeof replyToId === "string" && replyToId.trim().length > 0) {
      if (!ObjectId.isValid(replyToId)) {
        return res.status(400).json({ error: "Invalid replyToId value." });
      }
      const parentMessage = await messages.findOne({
        _id: new ObjectId(replyToId),
        groupId: group._id!.toString(),
      });
      if (!parentMessage) {
        return res.status(404).json({ error: "Reply target not found." });
      }

      messageDoc.replyTo = {
        messageId: parentMessage._id!,
        senderId: parentMessage.senderId,
        content: parentMessage.content,
        createdAt: parentMessage.createdAt,
      };
    }

    const result = await messages.insertOne(messageDoc);
    const stored: GroupMessageDocument = {
      ...messageDoc,
      _id: result.insertedId,
    };

    const api = toApiGroupMessage(stored);

    broadcastGroupMessage(api, group.members.map((member) => member.userId));

    return res.status(201).json({ message: api });
  } catch (error) {
    next(error);
  }
});

router.get("/:groupId", async (req, res, next) => {
  try {
    const { groupId } = req.params;
    if (!ObjectId.isValid(groupId)) {
      return res.status(400).json({ error: "Invalid groupId parameter." });
    }

    const limitParam =
      typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : 50;
    const limit = Number.isNaN(limitParam)
      ? 50
      : Math.max(1, Math.min(limitParam, 200));

    const before =
      typeof req.query.before === "string" && req.query.before.length > 0
        ? req.query.before
        : null;

    const messages = await getGroupMessagesCollection();

    const cursorFilter =
      before && ObjectId.isValid(before)
        ? { _id: { $lt: new ObjectId(before) } }
        : {};

    const results = await messages
      .find({ groupId, ...cursorFilter }, { sort: { _id: -1 }, limit })
      .toArray();

    return res.json({
      messages: results
        .map((doc) => toApiGroupMessage(doc))
        .sort(
          (left, right) =>
            new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
        ),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:messageId/read", async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const { userId } = req.body as ReadReceiptBody;

    if (!ObjectId.isValid(messageId)) {
      return res.status(400).json({ error: "Invalid messageId parameter." });
    }
    if (typeof userId !== "string" || userId.trim().length === 0) {
      return res.status(400).json({ error: "userId is required." });
    }

    const messages = await getGroupMessagesCollection();

    const result = await messages.findOneAndUpdate(
      { _id: new ObjectId(messageId) },
      {
        $set: {
          [`readBy.${userId.trim()}`]: new Date(),
        },
      },
      { returnDocument: "after" },
    );

    if (!result) {
      return res.status(404).json({ error: "Message not found." });
    }

    const groups = await getGroupsCollection();
    const group = await groups.findOne({ _id: new ObjectId(result.groupId) });

    const apiMessage = toApiGroupMessage(result);
    if (group) {
      broadcastGroupMessageUpdate(apiMessage, group.members.map((member) => member.userId));
    }

    return res.json({ message: apiMessage });
  } catch (error) {
    next(error);
  }
});

router.post("/:messageId/reactions", async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const { emoji, userId } = req.body as ReactionBody;

    if (!ObjectId.isValid(messageId)) {
      return res.status(400).json({ error: "Invalid messageId." });
    }
    if (typeof emoji !== "string" || emoji.trim().length === 0) {
      return res.status(400).json({ error: "emoji is required." });
    }
    if (typeof userId !== "string" || userId.trim().length === 0) {
      return res.status(400).json({ error: "userId is required." });
    }

    const messages = await getGroupMessagesCollection();
    const existing = await messages.findOne({ _id: new ObjectId(messageId) });
    if (!existing) {
      return res.status(404).json({ error: "Message not found." });
    }

    const reactions = existing.reactions ?? {};
    const normalizedEmoji = emoji.trim();
    const normalizedUserId = userId.trim();

    if (!reactions[normalizedEmoji]) {
      reactions[normalizedEmoji] = { userIds: [], count: 0 };
    }

    if (reactions[normalizedEmoji].userIds.includes(normalizedUserId)) {
      return res
        .status(400)
        .json({ error: "User has already reacted with this emoji." });
    }

    reactions[normalizedEmoji].userIds.push(normalizedUserId);
    reactions[normalizedEmoji].count = reactions[normalizedEmoji].userIds.length;

    const updated = await messages.findOneAndUpdate(
      { _id: existing._id },
      { $set: { reactions } },
      { returnDocument: "after" },
    );

    if (!updated) {
      return res.status(500).json({ error: "Failed to update reactions." });
    }

    const groups = await getGroupsCollection();
    const group = await groups.findOne({ _id: new ObjectId(updated.groupId) });

    const apiMessage = toApiGroupMessage(updated);
    if (group) {
      broadcastGroupMessageUpdate(apiMessage, group.members.map((member) => member.userId));
    }

    return res.json({ message: apiMessage });
  } catch (error) {
    next(error);
  }
});

router.delete("/:messageId/reactions", async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const { emoji, userId } = req.body as ReactionBody;

    if (!ObjectId.isValid(messageId)) {
      return res.status(400).json({ error: "Invalid messageId." });
    }
    if (typeof emoji !== "string" || emoji.trim().length === 0) {
      return res.status(400).json({ error: "emoji is required." });
    }
    if (typeof userId !== "string" || userId.trim().length === 0) {
      return res.status(400).json({ error: "userId is required." });
    }

    const messages = await getGroupMessagesCollection();
    const existing = await messages.findOne({ _id: new ObjectId(messageId) });
    if (!existing) {
      return res.status(404).json({ error: "Message not found." });
    }

    const reactions = existing.reactions ?? {};
    const normalizedEmoji = emoji.trim();
    const normalizedUserId = userId.trim();

    if (
      !reactions[normalizedEmoji] ||
      !reactions[normalizedEmoji].userIds.includes(normalizedUserId)
    ) {
      return res
        .status(400)
        .json({ error: "User has not reacted with this emoji." });
    }

    reactions[normalizedEmoji].userIds = reactions[normalizedEmoji].userIds.filter(
      (id) => id !== normalizedUserId,
    );
    reactions[normalizedEmoji].count = reactions[normalizedEmoji].userIds.length;

    if (reactions[normalizedEmoji].count === 0) {
      delete reactions[normalizedEmoji];
    }

    const updated = await messages.findOneAndUpdate(
      { _id: existing._id },
      { $set: { reactions } },
      { returnDocument: "after" },
    );

    if (!updated) {
      return res.status(500).json({ error: "Failed to update reactions." });
    }

    const groups = await getGroupsCollection();
    const group = await groups.findOne({ _id: new ObjectId(updated.groupId) });

    const apiMessage = toApiGroupMessage(updated);
    if (group) {
      broadcastGroupMessageUpdate(apiMessage, group.members.map((member) => member.userId));
    }

    return res.json({ message: apiMessage });
  } catch (error) {
    next(error);
  }
});

function isMember(members: GroupMember[], userId: string): boolean {
  return members.some((member) => member.userId === userId);
}

export default router;
