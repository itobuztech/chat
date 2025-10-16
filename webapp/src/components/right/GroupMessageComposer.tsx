import { useState, useCallback, useRef, useEffect, FormEvent, ChangeEvent } from "react"
import { Loader2, Send, X } from "lucide-react"

import { sendGroupMessage, type GroupChatMessage } from "@/lib/groupMessagesApi"
import { Button } from "../ui/button"
import { Textarea } from "../ui/textarea"
import { formatConversationPreview } from "../uifunctions/formatConversationPreview"

interface GroupMessageComposerProps {
  groupId: string
  selfId: string
  replyingTo: GroupChatMessage | null
  onMessageSent: (message: GroupChatMessage) => void
  onCancelReply: () => void
}

export function GroupMessageComposer({
  groupId,
  selfId,
  replyingTo,
  onMessageSent,
  onCancelReply,
}: GroupMessageComposerProps) {
  const [messageInput, setMessageInput] = useState("")
  const [isSending, setIsSending] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [replyingTo])

  const canSend =
    messageInput.trim().length > 0 && !isSending && groupId.length > 0 && selfId.length > 0

  const handleChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    setMessageInput(event.target.value)
  }, [])

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      if (!canSend) {
        return
      }

      setIsSending(true)
      try {
        const message = await sendGroupMessage({
          groupId,
          senderId: selfId,
          content: messageInput.trim(),
          replyToId: replyingTo?.id,
        })
        setMessageInput("")
        onMessageSent(message)
      } catch (error) {
        console.error("Failed to send group message", error)
      } finally {
        setIsSending(false)
      }
    },
    [canSend, groupId, messageInput, onMessageSent, replyingTo?.id, selfId],
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      {replyingTo && (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm">
          <div className="space-y-1">
            <span className="font-semibold text-muted-foreground">
              Replying to {replyingTo.senderId === selfId ? "You" : replyingTo.senderId}
            </span>
            <p className="line-clamp-2 text-muted-foreground/80">
              {formatConversationPreview(replyingTo.content)}
            </p>
          </div>
          <Button type="button" variant="ghost" size="xs" onClick={onCancelReply}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <div className="flex gap-4">
        <Textarea
          ref={textareaRef}
          rows={1}
          placeholder="Type a message…"
          value={messageInput}
          onChange={handleChange}
          disabled={isSending}
        />
        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={!canSend}>
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

export default GroupMessageComposer
