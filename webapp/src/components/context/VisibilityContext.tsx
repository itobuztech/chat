import useUser from '@/hooks/useUser';
import { PresenceStatus, fetchConversation } from '@/lib/messagesApi';
import { createContext, useEffect, useRef } from 'react';

function Visibility({ children }: { children: React.ReactNode }) {
  const {selfId, conversationReady} = useUser();

  const previousSocketStatusRef = useRef<string>("disconnected")

  useEffect(() => {
    if (
      !selfId ||
      typeof document === "undefined" ||
      typeof window === "undefined"
    ) {
      return
    }

    const syncPresenceToVisibility = () => {
      const nextStatus: PresenceStatus = document.hidden ? "away" : "online"
      sendPresence(nextStatus)
    }

    const markActive = () => {
      if (!document.hidden) {
        sendPresence("online")
      }
    }

    syncPresenceToVisibility()

    document.addEventListener("visibilitychange", syncPresenceToVisibility)
    window.addEventListener("focus", markActive)
    window.addEventListener("blur", syncPresenceToVisibility)
    window.addEventListener("pointerdown", markActive)
    window.addEventListener("keydown", markActive)

    return () => {
      document.removeEventListener("visibilitychange", syncPresenceToVisibility)
      window.removeEventListener("focus", markActive)
      window.removeEventListener("blur", syncPresenceToVisibility)
      window.removeEventListener("pointerdown", markActive)
      window.removeEventListener("keydown", markActive)
    }
  }, [conversationReady, normalizedSelfId, sendPresence])

  useEffect(() => {
    if (!conversationReady || socketStatus !== "connected") {
      previousSocketStatusRef.current = socketStatus
      return
    }

    if (previousSocketStatusRef.current === "connected") {
      return
    }

    previousSocketStatusRef.current = socketStatus
    let cancelled = false

    const refreshMessages = async () => {
      try {
        const conversation = await fetchConversation(
          normalizedSelfId,
          normalizedPeerId,
        )
        if (!cancelled) {
          setMessages(conversation)
        }
      } catch (err) {
        if (!cancelled) {
          // const message =
          //   err instanceof Error ? err.message : "Failed to refresh messages."
          // setError(message)
        }
      }
    }

    void refreshMessages()

    return () => {
      cancelled = true
    }
  }, [conversationReady, normalizedPeerId, normalizedSelfId, socketStatus])

  return children
}

export const VisibilityContext = createContext(Visibility);
