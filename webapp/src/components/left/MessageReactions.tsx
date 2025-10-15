import { useState } from "react"

import { addReaction, removeReaction, type ChatMessage } from "../../lib/messagesApi"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { LaughIcon } from 'lucide-react'

interface MessageReactionsProps {
  message: ChatMessage;
  currentUserId: string;
  onReactionUpdate: (updatedMessage: ChatMessage) => void;
}

const COMMON_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "😡"];

export function MessageReactions({ message, currentUserId, onReactionUpdate }: MessageReactionsProps) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const handleReactionClick = async (emoji: string) => {
    if (isUpdating) return;

    setIsUpdating(true);
    try {
      const userHasReacted = message.reactions?.[emoji]?.userIds.includes(currentUserId) ?? false;
      
      let updatedMessage: ChatMessage;
      if (userHasReacted) {
        updatedMessage = await removeReaction(message.id, emoji, currentUserId);
      } else {
        updatedMessage = await addReaction(message.id, emoji, currentUserId);
      }
      
      onReactionUpdate(updatedMessage);
      setShowEmojiPicker(false);
    } catch (error) {
      console.error("Failed to update reaction:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  const reactions = message.reactions || {}
  const hasReactions = Object.keys(reactions).length > 0

  return (
    <div className="flex flex-row items-end gap-2">
      {hasReactions && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(reactions).map(([emoji, data]) => {
            const userHasReacted = data.userIds.includes(currentUserId);
            return (
              <Button
                key={emoji}
                variant={userHasReacted ? "secondary" : "ghost"}
                size="xs"
                onClick={() => handleReactionClick(emoji)}
                disabled={isUpdating}
                title={`${data.userIds.join(", ")} reacted with ${emoji}`}
              >
                <span className="mr-1 text-base">{emoji}</span>
                <Badge variant={userHasReacted ? "default" : "muted"}>{data.count}</Badge>
              </Button>
            );
          })}
        </div>
      )}
      
      <div className="relative">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          disabled={isUpdating}
        >
          <LaughIcon className="mr-1 h-3.5 w-3.5" />
          Add reaction
        </Button>

        {showEmojiPicker && (
          <div className="absolute right-0 z-10 mt-2 flex w-40 flex-wrap gap-2 rounded-lg border border-border/60 bg-popover p-3 shadow-lg">
            {COMMON_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleReactionClick(emoji)}
                disabled={isUpdating}
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
  );
}
