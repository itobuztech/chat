import { Router } from "express";
import { ObjectId } from "mongodb";

import {
  getGroupsCollection,
  type GroupDocument,
  type GroupMember,
  type GroupMemberRole,
} from "../lib/mongoClient";
import { toApiGroup } from "../utils/formatters";

interface CreateGroupRequestBody {
  name?: unknown;
  creatorId?: unknown;
  memberIds?: unknown;
  description?: unknown;
}

interface ModifyMembersRequestBody {
  requesterId?: unknown;
  userIds?: unknown;
}

const router = Router();

router.post("/", async (req, res, next) => {
  try {
    const { name, creatorId, memberIds, description } =
      req.body as CreateGroupRequestBody;

    if (typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Group name is required." });
    }

    if (typeof creatorId !== "string" || creatorId.trim().length === 0) {
      return res.status(400).json({ error: "creatorId is required." });
    }

    const normalizedName = name.trim();
    const normalizedCreator = creatorId.trim();
    const normalizedDescription =
      typeof description === "string" && description.trim().length > 0
        ? description.trim()
        : undefined;

    const memberIdList = Array.isArray(memberIds) ? memberIds : [];
    const uniqueMemberIds = new Set<string>();
    for (const value of memberIdList) {
      if (typeof value === "string") {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          uniqueMemberIds.add(trimmed);
        }
      }
    }
    uniqueMemberIds.add(normalizedCreator);

    const createdAt = new Date();
    const initialMembers: GroupMember[] = Array.from(uniqueMemberIds).map(
      (userId) => ({
        userId,
        role: userId === normalizedCreator ? "owner" : "member",
        joinedAt: createdAt,
      }),
    );

    const groupDoc: GroupDocument = {
      name: normalizedName,
      description: normalizedDescription,
      createdBy: normalizedCreator,
      createdAt,
      updatedAt: createdAt,
      members: initialMembers,
    };

    const groups = await getGroupsCollection();
    const result = await groups.insertOne(groupDoc);

    const storedGroup: GroupDocument = {
      ...groupDoc,
      _id: result.insertedId,
    };

    return res.status(201).json({ group: toApiGroup(storedGroup) });
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const memberId =
      typeof req.query.memberId === "string" ? req.query.memberId.trim() : "";

    const groups = await getGroupsCollection();
    const filter =
      memberId.length > 0 ? { "members.userId": memberId } : undefined;

    const results = await groups
      .find(filter ?? {})
      .sort({ updatedAt: -1, createdAt: -1 })
      .toArray();

    return res.json({
      groups: results.map((doc) => toApiGroup(doc)),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:groupId", async (req, res, next) => {
  try {
    const { groupId } = req.params;
    if (!ObjectId.isValid(groupId)) {
      return res.status(400).json({ error: "Invalid group id." });
    }

    const groups = await getGroupsCollection();
    const group = await groups.findOne({ _id: new ObjectId(groupId) });

    if (!group) {
      return res.status(404).json({ error: "Group not found." });
    }

    return res.json({ group: toApiGroup(group) });
  } catch (error) {
    next(error);
  }
});

router.post("/:groupId/members", async (req, res, next) => {
  try {
    const { groupId } = req.params;
    if (!ObjectId.isValid(groupId)) {
      return res.status(400).json({ error: "Invalid group id." });
    }

    const { requesterId, userIds } = req.body as ModifyMembersRequestBody;
    const normalizedRequester =
      typeof requesterId === "string" ? requesterId.trim() : "";
    if (!normalizedRequester) {
      return res
        .status(400)
        .json({ error: "requesterId is required to add members." });
    }

    const normalizedUserIds = normalizeUserIdList(userIds);
    if (normalizedUserIds.length === 0) {
      return res.status(400).json({ error: "userIds must be a non-empty array." });
    }

    const groups = await getGroupsCollection();
    const existingGroup = await groups.findOne({ _id: new ObjectId(groupId) });

    if (!existingGroup) {
      return res.status(404).json({ error: "Group not found." });
    }

    const requesterMember = existingGroup.members.find(
      (member) => member.userId === normalizedRequester,
    );

    if (!requesterMember || !canManageMembers(requesterMember.role)) {
      return res.status(403).json({ error: "Requester is not allowed to add members." });
    }

    const existingUserIds = new Set(
      existingGroup.members.map((member) => member.userId),
    );

    const newMembersToAdd = normalizedUserIds.filter(
      (userId) => !existingUserIds.has(userId),
    );

    if (newMembersToAdd.length === 0) {
      return res.json({ group: toApiGroup(existingGroup) });
    }

    const timestamp = new Date();
    const newMemberEntries: GroupMember[] = newMembersToAdd.map(
      (userId): GroupMember => ({
        userId,
        role: "member",
        joinedAt: timestamp,
      }),
    );
    const updatedMembers: GroupMember[] = [
      ...existingGroup.members,
      ...newMemberEntries,
    ];

    await groups.updateOne(
      { _id: existingGroup._id },
      { $set: { members: updatedMembers, updatedAt: timestamp } },
    );

    const updatedGroup: GroupDocument = {
      ...existingGroup,
      members: updatedMembers,
      updatedAt: timestamp,
    };

    return res.json({ group: toApiGroup(updatedGroup) });
  } catch (error) {
    next(error);
  }
});

router.delete("/:groupId/members", async (req, res, next) => {
  try {
    const { groupId } = req.params;
    if (!ObjectId.isValid(groupId)) {
      return res.status(400).json({ error: "Invalid group id." });
    }

    const { requesterId, userIds } = req.body as ModifyMembersRequestBody;
    const normalizedRequester =
      typeof requesterId === "string" ? requesterId.trim() : "";
    if (!normalizedRequester) {
      return res
        .status(400)
        .json({ error: "requesterId is required to remove members." });
    }

    const normalizedUserIds = normalizeUserIdList(userIds);
    if (normalizedUserIds.length === 0) {
      return res
        .status(400)
        .json({ error: "userIds must be a non-empty array." });
    }

    const groups = await getGroupsCollection();
    const existingGroup = await groups.findOne({ _id: new ObjectId(groupId) });

    if (!existingGroup) {
      return res.status(404).json({ error: "Group not found." });
    }

    const requesterMember = existingGroup.members.find(
      (member) => member.userId === normalizedRequester,
    );

    if (!requesterMember || !canManageMembers(requesterMember.role)) {
      return res
        .status(403)
        .json({ error: "Requester is not allowed to remove members." });
    }

    const membersById = new Map(
      existingGroup.members.map((member) => [member.userId, member]),
    );

    for (const userId of normalizedUserIds) {
      const target = membersById.get(userId);
      if (!target) {
        continue;
      }
      if (!canModifyTarget(requesterMember.role, target.role)) {
        return res.status(403).json({
          error: `Requester cannot remove member with role "${target.role}".`,
        });
      }
      if (target.role === "owner") {
        return res
          .status(400)
          .json({ error: "Owner cannot be removed from the group." });
      }
    }

    const removalSet = new Set(normalizedUserIds);
    const filteredMembers = existingGroup.members.filter(
      (member) => !removalSet.has(member.userId),
    );

    if (filteredMembers.length === existingGroup.members.length) {
      return res.json({ group: toApiGroup(existingGroup) });
    }

    const timestamp = new Date();

    await groups.updateOne(
      { _id: existingGroup._id },
      { $set: { members: filteredMembers, updatedAt: timestamp } },
    );

    const updatedGroup: GroupDocument = {
      ...existingGroup,
      members: filteredMembers,
      updatedAt: timestamp,
    };

    return res.json({ group: toApiGroup(updatedGroup) });
  } catch (error) {
    next(error);
  }
});

function normalizeUserIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const uniqueIds = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") {
      continue;
    }
    const trimmed = candidate.trim();
    if (trimmed.length > 0) {
      uniqueIds.add(trimmed);
    }
  }
  return Array.from(uniqueIds);
}

function canManageMembers(role: GroupMemberRole): boolean {
  return role === "owner" || role === "admin";
}

function canModifyTarget(
  requesterRole: GroupMemberRole,
  targetRole: GroupMemberRole,
): boolean {
  if (requesterRole === "owner") {
    return true;
  }
  if (requesterRole === "admin") {
    return targetRole === "member";
  }
  return false;
}

export default router;
