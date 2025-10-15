import { useWebRTCContext } from '@/components/context/WebRTCContext'
import { ChatMessage, sendMessage } from '@/lib/messagesApi'
import { X, Loader2, Send } from 'lucide-react'
import React, { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'
import { formatConversationPreview } from '../uifunctions/formatConversationPreview'
import useUser from '@/hooks/useUser'
import type { WebRtcMessage } from '@/hooks/useWebRtcMessaging'

function ChatMessageReply({
  replyingTo,
  handleCancelReply,
  handlePeerTyping,
  onMessageSent
}: {
  replyingTo: ChatMessage | null;
  handleCancelReply: () => void;
  handlePeerTyping: (typing: boolean) => void;
  onMessageSent: (message: ChatMessage) => void;
}) {
  const { selfId, peerId, conversationReady } = useUser();
  const [messageInput, setMessageInput] = useState("")

  const [isSending, setIsSending] = useState(false)

  const typingTimeoutRef = useRef<number | null>(null)
  const typingActiveRef = useRef(false)

  const isMessageEmpty = messageInput.trim().length === 0
  const canSendMessage = conversationReady && !isSending && !isMessageEmpty

  const { sendMessage: sendViaRtc, sendTyping } = useWebRTCContext()

  const handleMessageChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value
      setMessageInput(value)
      // setStatusMessage(null)

      if (!conversationReady) {
        return
      }

      if (!typingActiveRef.current) {
        typingActiveRef.current = true
        void sendTyping(true)
      }

      if (typingTimeoutRef.current !== null) {
        window.clearTimeout(typingTimeoutRef.current)
      }

      typingTimeoutRef.current = window.setTimeout(() => {
        typingActiveRef.current = false
        void sendTyping(false)
        typingTimeoutRef.current = null
      }, 2000)
    },
    [conversationReady, sendTyping],
  )

  const handleInputBlur = useCallback(() => {
    if (!conversationReady) {
      return
    }

    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = null
    }

    if (typingActiveRef.current) {
      typingActiveRef.current = false
      void sendTyping(false)
    }
  }, [conversationReady, sendTyping])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!conversationReady) {
      // setError("Add both your ID and your peer's ID before sending messages.")
      return
    }

    const content = messageInput.trim()
    if (!content) {
      return
    }

    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = null
    }
    if (typingActiveRef.current) {
      typingActiveRef.current = false
      void sendTyping(false)
    }
    handlePeerTyping(false)

    setIsSending(true)
    // setError(null)
    // setStatusMessage(null)
    try {
      const persisted = await sendMessage({
        senderId: selfId,
        recipientId: peerId,
        content,
        replyToId: replyingTo?.id,
      })
      setMessageInput("")

      onMessageSent(persisted);

      const wirePayload: WebRtcMessage = {
        id: persisted.id,
        conversationId: persisted.conversationId,
        senderId: persisted.senderId,
        recipientId: persisted.recipientId,
        content: persisted.content,
        createdAt: persisted.createdAt,
        delivered: persisted.delivered,
        deliveredAt: persisted.deliveredAt,
        read: persisted.read,
        readAt: persisted.readAt,
        replyTo: persisted.replyTo,
      }
      try {
        await sendViaRtc(wirePayload)
      } catch (rtcSendError) {
        console.warn(
          "WebRTC delivery failed, relying on backend queue.",
          rtcSendError,
        )
      }
      // void loadConversations()
    } catch (err) {
      // const message =
      //   err instanceof Error ? err.message : "Failed to send message."
      // setError(message) // TODO: Replace with toast if available
    } finally {
      setIsSending(false)
    }
  }

  useEffect(() => {
    if (!conversationReady) {
      if (typingTimeoutRef.current !== null) {
        window.clearTimeout(typingTimeoutRef.current)
        typingTimeoutRef.current = null
      }
      typingActiveRef.current = false
      void sendTyping(false)
      handlePeerTyping(false)
    }
  }, [conversationReady, handlePeerTyping, sendTyping])

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {replyingTo && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm">
          <div className="space-y-1">
            <span className="font-semibold text-muted-foreground">
              Replying to{" "}
              {replyingTo.senderId === selfId
                ? "You"
                : replyingTo.senderId}
            </span>
            <p className="line-clamp-2 text-muted-foreground/80">
              {formatConversationPreview(replyingTo.content)}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={handleCancelReply}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="flex gap-4">
        <Textarea
          name="message"
          placeholder="Type a message…"
          rows={1}
          value={messageInput}
          onChange={handleMessageChange}
          onBlur={handleInputBlur}
          disabled={!conversationReady}
        />
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={!canSendMessage}>
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send
              </>
            )}
          </Button>
        </div>
      </div>
    </form>
  )
}

export default ChatMessageReply
