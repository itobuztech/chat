import { Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import { ConversationSummary, fetchConversations, PresenceStatus } from '@/lib/messagesApi'
import useUser from '@/hooks/useUser'
import { formatConversationPreview } from '../uifunctions/formatConversationPreview'
import { Badge } from "@/components/ui/badge"
import { useWebRTCContext } from '@/components/context/WebRTCContext'
// import {
//   type ChatMessage,
//   type ConversationSummary,
//   // type PresenceStatus,
//   fetchConversation,
//   sendMessage,
// } from "./lib/messagesApi"

function Conversations() {
  const {selfId, peerId, setPeerId} = useUser();
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [isConversationsLoading, setIsConversationsLoading] = useState(false)
  const [conversationsError, setConversationsError] = useState<string | null>(null)
  const { subscribeToPresence } = useWebRTCContext()

  const loadConversations = useCallback(async () => {
    if (!selfId) {
      setConversations([])
      setConversationsError(null)
      setIsConversationsLoading(false)
      return
    }

    setConversationsError(null)
    setIsConversationsLoading(true)
    try {
      const list = await fetchConversations(selfId)
      console.log("Fetched conversations:", list);
      setConversations(list)
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Failed to load conversations."
      setConversationsError(message)
    } finally {
      setIsConversationsLoading(false)
    }
  }, [selfId]);

  useEffect(() => {
    void loadConversations()
  }, [loadConversations, selfId]);

  const handlePresenceUpdate = useCallback(
    (peer: string, status: PresenceStatus) => {
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.peerId === peer
            ? { ...conversation, peerStatus: status }
            : conversation,
        ),
      )
    },
    [],
  )

  useEffect(() => {
    if (!selfId) {
      return
    }
    const unsubscribe = subscribeToPresence(handlePresenceUpdate)
    return () => {
      unsubscribe()
    }
  }, [handlePresenceUpdate, selfId, subscribeToPresence])

  const formatConversationTime = useCallback((iso: string): string => {
      const date = new Date(iso)
      if (Number.isNaN(date.getTime())) {
        return ""
      }
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    }, [])

  return (
    <ScrollArea className="inset-0">
      <div className="flex flex-col gap-4">
        {statusMessage && (
          <div className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary-foreground/80">
            {statusMessage}
          </div>
        )}
        {error && (
          <div className="rounded-lg bg-destructive/15 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        {/* {rtcError && (
          <div className="rounded-lg bg-destructive/15 px-3 py-2 text-xs text-destructive">
            {rtcError}
          </div>
        )} */}

        <div className="flex items-center justify-between text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <span>Conversations</span>
          {isConversationsLoading && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading
            </span>
          )}
        </div>

        <div className="relative flex-1">
          <ScrollArea className="inset-0">
            <div className="space-y-1">
              {conversationsError && (
                <div className="rounded-lg bg-destructive/15 px-3 py-2 text-xs text-destructive">
                  {conversationsError}
                </div>
              )}
              {!isConversationsLoading &&
              conversationsError === null &&
              conversations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No conversations yet.
                </p>
              ) : (
                conversations.map((conversation) => {
                  const active = conversation.peerId === peerId
                  const replyPreview = conversation.lastMessage.replyTo
                    ? `↪ ${formatConversationPreview(conversation.lastMessage.replyTo.content)} `
                    : ""
                  const preview = `${replyPreview}${formatConversationPreview(
                    conversation.lastMessage.content,
                  )}`
                  const displayTime = formatConversationTime(
                    conversation.lastMessage.createdAt,
                  )
                  const unread = conversation.unreadCount
                  return (
                    <Button
                      type="button"
                      key={conversation.conversationId}
                      variant={active ? "secondary" : "ghost"}
                      className="w-full justify-start rounded-xl px-3 py-3 text-left"
                      onClick={() => setPeerId(conversation.peerId)}
                    >
                      <div className="flex w-full flex-col gap-1">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">
                            {conversation.peerStatus === "online" ? '🟢' : conversation.peerStatus === "away" ? '🟡' : '🔴'} {conversation.peerId}
                          </span>
                          <span>{displayTime}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="line-clamp-1">{preview}</span>
                          {unread > 0 && (
                            <Badge variant="muted">{unread}</Badge>
                          )}
                        </div>
                      </div>
                    </Button>
                  )
                })
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </ScrollArea>
  )
}

export default Conversations
