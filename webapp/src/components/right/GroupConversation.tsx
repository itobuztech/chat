import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, MessageSquareReply } from "lucide-react"

import { useWebRTCContext } from "@/components/context/WebRTCContext"
import useUser from "@/hooks/useUser"
import {
  fetchGroupMessages,
  markGroupMessageRead,
  type GroupChatMessage,
} from "@/lib/groupMessagesApi"
import { fetchGroup, type Group } from "@/lib/groupsApi"
import { dedupeAndSortGroupMessages } from "@/lib/dedupeGroupMessages"
import { Button } from "../ui/button"
import { ScrollArea } from "../ui/scroll-area"
import GroupMessageComposer from "./GroupMessageComposer"
import GroupMessageReactions from "./GroupMessageReactions"

interface GroupConversationProps {
  groupId: string
}

export function GroupConversation({ groupId }: GroupConversationProps): JSX.Element {
  const { selfId } = useUser()
  const { subscribeToGroupMessages } = useWebRTCContext()

  const [group, setGroup] = useState<Group | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<GroupChatMessage[]>([])
  const [replyingTo, setReplyingTo] = useState<GroupChatMessage | null>(null)

  const pendingReadRef = useRef(new Set<string>())

  const groupMemberIds = useMemo(
    () => (group ? group.members.map((member) => member.userId) : []),
    [group],
  )

  useEffect(() => {
    let cancelled = false

    const loadInitialData = async () => {
      try {
        setIsLoading(true)
        setError(null)
        const [groupDoc, groupMessages] = await Promise.all([
          fetchGroup(groupId),
          fetchGroupMessages(groupId, 100),
        ])
        if (cancelled) {
          return
        }
        setGroup(groupDoc)
        setMessages(groupMessages)
      } catch (loadError) {
        if (!cancelled) {
          const message =
            loadError instanceof Error ? loadError.message : "Failed to load group messages."
          setError(message)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadInitialData()

    return () => {
      cancelled = true
      pendingReadRef.current.clear()
    }
  }, [groupId])

  const upsertMessage = useCallback((incoming: GroupChatMessage) => {
    setMessages((prev) => {
      const existingIndex = prev.findIndex((entry) => entry.id === incoming.id)
      if (existingIndex === -1) {
        return dedupeAndSortGroupMessages([...prev, incoming])
      }

      const existing = prev[existingIndex]
      const merged: GroupChatMessage = {
        ...existing,
        ...incoming,
        reactions: incoming.reactions ?? existing.reactions,
        readBy: {
          ...(existing.readBy ?? {}),
          ...(incoming.readBy ?? {}),
        },
      }

      const next = [...prev]
      next[existingIndex] = merged
      return dedupeAndSortGroupMessages(next)
    })
  }, [])

  useEffect(() => {
    const unsubscribe = subscribeToGroupMessages((incoming) => {
      if (incoming.groupId !== groupId) {
        return
      }
      upsertMessage(incoming)
    })

    return () => {
      unsubscribe()
    }
  }, [groupId, subscribeToGroupMessages, upsertMessage])

  useEffect(() => {
    if (!selfId) {
      return
    }
    const unread = messages.filter(
      (message) => message.senderId !== selfId && !message.readBy?.[selfId],
    )
    if (unread.length === 0) {
      return
    }

    for (const message of unread) {
      if (pendingReadRef.current.has(message.id)) {
        continue
      }
      pendingReadRef.current.add(message.id)
      void markGroupMessageRead(message.id, selfId)
        .then(upsertMessage)
        .finally(() => {
          pendingReadRef.current.delete(message.id)
        })
    }
  }, [messages, selfId, upsertMessage])

  const sortedMessages = useMemo(
    () =>
      [...messages].sort(
        (left, right) =>
          new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
      ),
    [messages],
  )

  const handleReactionUpdate = useCallback(
    (updated: GroupChatMessage) => {
      upsertMessage(updated)
    },
    [upsertMessage],
  )

  const buildReadReceipt = useCallback(
    (message: GroupChatMessage) => {
      if (!groupMemberIds.length) {
        return ""
      }
      const readEntries = Object.entries(message.readBy ?? {}).filter(
        ([userId]) => userId !== message.senderId,
      )
      if (readEntries.length === 0) {
        return "Read by: —"
      }

      const readable = readEntries
        .map(([userId]) => (userId === selfId ? "You" : userId))
        .filter((userId) => userId === "You" || groupMemberIds.includes(userId))
        .sort()
      if (readable.length === 0) {
        return "Read by: —"
      }
      return `Read by: ${readable.join(", ")}`
    },
    [groupMemberIds, selfId],
  )

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading group messages…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-6 text-sm text-destructive">
        {error}
      </div>
    )
  }

  if (!group) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
        Group unavailable.
      </div>
    )
  }

  return (
    <>
      <div className="relative flex-1 overflow-hidden">
        <ScrollArea className="absolute inset-0">
          <div className="flex flex-col gap-4">
            {sortedMessages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
                No messages yet. Start the conversation!
              </div>
            ) : (
              sortedMessages.map((message) => {
                const isMine = message.senderId === selfId
                return (
                  <div
                    key={message.id}
                    className={`flex flex-col gap-2 ${isMine ? "items-end text-right" : "items-start text-left"}`}
                  >
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {isMine ? "You" : message.senderId}
                      </span>
                      <time dateTime={message.createdAt}>
                        {new Date(message.createdAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>

                    <div
                      className={`w-full max-w-xl rounded-2xl border px-4 py-3 text-sm shadow-sm md:max-w-[70%] ${
                        isMine
                          ? "border-transparent bg-primary text-primary-foreground"
                          : "border-border/60 bg-card text-foreground"
                      }`}
                    >
                      {message.replyTo && (
                        <div className="mb-3 border-l-2 border-border/60 pl-3 text-xs text-muted-foreground">
                          <span className="block font-semibold">
                            {message.replyTo.senderId === selfId
                              ? "You"
                              : message.replyTo.senderId}
                          </span>
                          <span className="line-clamp-2">{message.replyTo.content}</span>
                        </div>
                      )}

                      <p className="leading-relaxed">{message.content}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <span>{buildReadReceipt(message)}</span>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => setReplyingTo(message)}
                        >
                          <MessageSquareReply className="mr-1 h-3.5 w-3.5" />
                          Reply
                        </Button>

                        <GroupMessageReactions
                          message={message}
                          currentUserId={selfId}
                          onReactionUpdate={handleReactionUpdate}
                        />
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </ScrollArea>
      </div>

      <GroupMessageComposer
        groupId={groupId}
        selfId={selfId}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        onMessageSent={(message) => {
          upsertMessage(message)
          setReplyingTo(null)
        }}
      />
    </>
  )
}

export default GroupConversation
