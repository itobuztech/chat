import { API_BASE_URL } from "./messagesApi"

export type GroupMemberRole = "owner" | "admin" | "member"

export interface GroupMember {
  userId: string
  role: GroupMemberRole
  joinedAt: string
}

export interface Group {
  id: string
  name: string
  description?: string
  createdBy: string
  createdAt: string
  updatedAt: string
  members: GroupMember[]
}

export interface CreateGroupPayload {
  name: string
  creatorId: string
  memberIds?: string[]
  description?: string
}

export interface ModifyMembersPayload {
  requesterId: string
  userIds: string[]
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const errorMessage =
      body && typeof body === "object" && typeof (body as { error?: string }).error === "string"
        ? (body as { error: string }).error
        : `Request failed with status ${response.status}`
    throw new Error(errorMessage)
  }

  return (await response.json()) as T
}

export async function fetchGroups(memberId?: string): Promise<Group[]> {
  const params = new URLSearchParams()
  if (memberId && memberId.trim().length > 0) {
    params.set("memberId", memberId.trim())
  }

  const response = await fetch(
    `${API_BASE_URL}/api/groups${params.toString() ? `?${params.toString()}` : ""}`,
  )
  const data = await handleResponse<{ groups: Group[] }>(response)
  return data.groups
}

export async function fetchGroup(groupId: string): Promise<Group> {
  const response = await fetch(`${API_BASE_URL}/api/groups/${groupId}`)
  const data = await handleResponse<{ group: Group }>(response)
  return data.group
}

export async function createGroup(payload: CreateGroupPayload): Promise<Group> {
  const response = await fetch(`${API_BASE_URL}/api/groups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  const data = await handleResponse<{ group: Group }>(response)
  return data.group
}

export async function addGroupMembers(
  groupId: string,
  payload: ModifyMembersPayload,
): Promise<Group> {
  const response = await fetch(`${API_BASE_URL}/api/groups/${groupId}/members`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  const data = await handleResponse<{ group: Group }>(response)
  return data.group
}

export async function removeGroupMembers(
  groupId: string,
  payload: ModifyMembersPayload,
): Promise<Group> {
  const response = await fetch(`${API_BASE_URL}/api/groups/${groupId}/members`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  const data = await handleResponse<{ group: Group }>(response)
  return data.group
}
