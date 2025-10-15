import { cn } from '@/lib/utils'
import { Loader2, MessageSquareReply } from 'lucide-react'
import { Button } from '../ui/button'
import { ScrollArea } from '../ui/scroll-area'
import useUser from '@/hooks/useUser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChatMessage, fetchConversation } from '@/lib/messagesApi';
import { dedupeAndSort } from '@/lib/dedupeAndSort';
import { useWebRTCContext } from '@/components/context/WebRTCContext';
import type { WebRtcMessage } from '@/hooks/useWebRtcMessaging';
import ChatMessageReply from './ChatMessageReply';
import { MessageReactions } from '../left/MessageReactions';

function Conversation() {
  const [isLoading, setIsLoading] = useState(false)
  const { selfId, peerId, conversationReady } = useUser();
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null)
  const [peerTyping, setPeerTyping] = useState(false)
  const peerTypingTimeoutRef = useRef<number | null>(null)

  const { subscribeToMessages, subscribeToTyping } = useWebRTCContext();

  const sortedMessages = useMemo(
    () =>
      [...messages].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [messages],
  )

  const handleStartReply = useCallback((message: ChatMessage) => {
    setReplyingTo(message)
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    if (!conversationReady) {
      setMessages([])
      // setStatusMessage(null)
      setIsLoading(false)
      setReplyingTo(null)
      return
    }

    let cancelled = false
    setIsLoading(true)

    const loadHistory = async () => {
      try {
        const conversation = await fetchConversation(
          selfId,
          peerId,
        )
        if (!cancelled) {
          setMessages(conversation)
        }
      } catch (err) {
        if (!cancelled) {
          // const message =
          //   err instanceof Error ? err.message : "Failed to fetch messages."
          // setError(message) // Replace with toast if available
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadHistory()

    return () => {
      cancelled = true
    }
  }, [conversationReady, selfId, peerId])

  const handlePeerTyping = useCallback((typing: boolean) => {
    setPeerTyping(typing)
    if (peerTypingTimeoutRef.current !== null) {
      window.clearTimeout(peerTypingTimeoutRef.current)
      peerTypingTimeoutRef.current = null
    }
    if (typing) {
      peerTypingTimeoutRef.current = window.setTimeout(() => {
        setPeerTyping(false)
        peerTypingTimeoutRef.current = null
      }, 4000)
    }
  }, [])

  const appendIncomingMessage = useCallback(
    (incoming: WebRtcMessage) => {
      if (incoming.senderId !== selfId && incoming.senderId !== peerId) {
        return
      }

      const chatMessage: ChatMessage = {
        id: incoming.id,
        conversationId: incoming.conversationId,
        senderId: incoming.senderId,
        recipientId: incoming.recipientId,
        content: incoming.content,
        createdAt: incoming.createdAt,
        delivered: incoming.delivered ?? false,
        deliveredAt: incoming.deliveredAt,
        read: incoming.read ?? false,
        readAt: incoming.readAt,
        replyTo: incoming.replyTo,
      }
      setMessages((prev) => dedupeAndSort([...prev, chatMessage]))
      handlePeerTyping(false)
      // void loadConversations() // ToDO: Do we need this?
    },
    [handlePeerTyping, peerId, selfId],
  )

  useEffect(() => {
    if (!conversationReady) {
      return
    }

    const unsubscribeMessage = subscribeToMessages(appendIncomingMessage)
    const unsubscribeTyping = subscribeToTyping(handlePeerTyping)

    return () => {
      unsubscribeMessage()
      unsubscribeTyping()
    }
  }, [appendIncomingMessage, conversationReady, handlePeerTyping, subscribeToMessages, subscribeToTyping])

  return (
    <>
      <div className="relative flex-1 overflow-hidden">
        <ScrollArea className="absolute inset-0">
          <div className="flex flex-col gap-4">
            {!selfId || !peerId ? (
              <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
                Add your ID and a peer to begin.
              </div>
            ) : isLoading ? (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading messages…
              </div>
            ) : sortedMessages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
                No messages yet. Say hello!
              </div>
            ) : (
              sortedMessages.map((message) => {
                const isMine = message.senderId === selfId
                return (
                  <div
                    key={message.id}
                    className={cn(
                      "flex flex-col gap-2",
                      isMine ? "items-end text-right" : "items-start text-left",
                    )}
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
                      className={cn(
                        "w-full max-w-xl rounded-2xl border px-4 py-3 text-sm shadow-sm md:max-w-[70%]",
                        isMine
                          ? "bg-primary text-primary-foreground border-transparent"
                          : "bg-card text-foreground border-border/60",
                      )}
                    >
                      {message.replyTo && (
                        <div className="mb-3 border-l-2 border-border/60 pl-3 text-xs text-muted-foreground">
                          <span className="block font-semibold">
                            {message.replyTo.senderId === selfId
                              ? "You"
                              : message.replyTo.senderId}
                          </span>
                          <span className="line-clamp-2">
                            {message.replyTo.content}
                          </span>
                        </div>
                      )}
                      <p className="leading-relaxed">{message.content}</p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        onClick={() => handleStartReply(message)}
                      >
                        <MessageSquareReply className="mr-1 h-3.5 w-3.5" />
                        Reply
                      </Button>

                      <MessageReactions message={message} currentUserId={selfId} onReactionUpdate={function (updatedMessage: ChatMessage): void {
                        throw new Error('Function not implemented.');
                      } }/>
                    </div>
                  </div>
                )
              })
            )}
            {peerTyping && (
              <div className="text-sm italic text-muted-foreground">
                {peerId || "Peer"} is typing…
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
      <ChatMessageReply
        replyingTo={replyingTo}
        handleCancelReply={() => setReplyingTo(null)}
        handlePeerTyping={handlePeerTyping}
        onMessageSent={(newMessage) => {
          setMessages((prev) => dedupeAndSort([...prev, newMessage]))
          setReplyingTo(null)
        }}
      />
    </>
  )
}

export default Conversation
