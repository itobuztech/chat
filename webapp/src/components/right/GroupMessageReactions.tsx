import { useCallback, useState } from "react"
import { LaughIcon } from "lucide-react"

import {
  addGroupReaction,
  removeGroupReaction,
  type GroupChatMessage,
} from "@/lib/groupMessagesApi"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { cn } from "@/lib/utils"

const COMMON_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "😡"]

interface GroupMessageReactionsProps {
  message: GroupChatMessage
  currentUserId: string
  onReactionUpdate: (updated: GroupChatMessage) => void
}

export function GroupMessageReactions({
  message,
  currentUserId,
  onReactionUpdate,
}: GroupMessageReactionsProps) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)

  const handleReactionClick = useCallback(
    async (emoji: string) => {
      if (isUpdating) {
        return
      }

      setIsUpdating(true)
      try {
        const alreadyReacted =
          message.reactions?.[emoji]?.userIds.includes(currentUserId) ?? false

        const updated = alreadyReacted
          ? await removeGroupReaction(message.id, emoji, currentUserId)
          : await addGroupReaction(message.id, emoji, currentUserId)

        onReactionUpdate(updated)
        setShowEmojiPicker(false)
      } catch (error) {
        console.error("Failed to update group message reaction", error)
      } finally {
        setIsUpdating(false)
      }
    },
    [currentUserId, isUpdating, message.id, message.reactions, onReactionUpdate],
  )

  const reactions = message.reactions ?? {}
  const hasReactions = Object.keys(reactions).length > 0

  return (
    <div className="flex flex-row items-end gap-2">
      {hasReactions && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(reactions).map(([emoji, data]) => {
            const userHasReacted = data.userIds.includes(currentUserId)
            return (
              <Button
                key={emoji}
                type="button"
                variant={userHasReacted ? "secondary" : "ghost"}
                size="xs"
                disabled={isUpdating}
                onClick={() => void handleReactionClick(emoji)}
                title={`${data.userIds.join(", ")} reacted with ${emoji}`}
              >
                <span className="mr-1 text-base">{emoji}</span>
                <Badge variant={userHasReacted ? "default" : "muted"}>{data.count}</Badge>
              </Button>
            )
          })}
        </div>
      )}

      <div className="relative">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={isUpdating}
          onClick={() => setShowEmojiPicker((prev) => !prev)}
        >
          <LaughIcon className="mr-1 h-3.5 w-3.5" />
          Add reaction
        </Button>

        {showEmojiPicker && (
          <div className="absolute right-0 z-10 mt-2 flex w-40 flex-wrap gap-2 rounded-lg border border-border/60 bg-popover p-3 shadow-lg">
            {COMMON_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                disabled={isUpdating}
                onClick={() => void handleReactionClick(emoji)}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-lg transition-colors hover:border-border/60 hover:bg-muted/50",
                  isUpdating && "opacity-60",
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default GroupMessageReactions
