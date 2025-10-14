import { useState } from "react";
import { addReaction, removeReaction, type ChatMessage } from "../lib/messagesApi";

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

  const reactions = message.reactions || {};
  const hasReactions = Object.keys(reactions).length > 0;

  return (
    <div className="message-reactions">
      {hasReactions && (
        <div className="reactions-display">
          {Object.entries(reactions).map(([emoji, data]) => {
            const userHasReacted = data.userIds.includes(currentUserId);
            return (
              <button
                key={emoji}
                className={`reaction-button ${userHasReacted ? "user-reacted" : ""}`}
                onClick={() => handleReactionClick(emoji)}
                disabled={isUpdating}
                title={`${data.userIds.join(", ")} reacted with ${emoji}`}
              >
                <span className="reaction-emoji">{emoji}</span>
                <span className="reaction-count">{data.count}</span>
              </button>
            );
          })}
        </div>
      )}
      
      <div className="reaction-controls">
        <button
          className="add-reaction-button"
          onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          title="Add reaction"
        >
          😊
        </button>
        
        {showEmojiPicker && (
          <div className="emoji-picker">
            {COMMON_EMOJIS.map((emoji) => (
              <button
                key={emoji}
                className="emoji-option"
                onClick={() => handleReactionClick(emoji)}
                disabled={isUpdating}
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