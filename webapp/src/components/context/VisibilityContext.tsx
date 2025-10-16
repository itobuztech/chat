import { type ReactNode, useEffect, useRef } from "react"

import { type PresenceStatus } from "@/lib/messagesApi"
import { useWebRTCContext } from "./WebRTCContext"

export function VisibilityProvider({ children }: { children: ReactNode }) {
  const { sendPresence, socketStatus, selfId } = useWebRTCContext()
  const previousSocketStatusRef = useRef(socketStatus)

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
  }, [selfId, sendPresence])

  useEffect(() => {
    if (!selfId) {
      previousSocketStatusRef.current = socketStatus
      return
    }

    if (
      socketStatus === "connected" &&
      previousSocketStatusRef.current !== "connected" &&
      typeof document !== "undefined"
    ) {
      const nextStatus: PresenceStatus = document.hidden ? "away" : "online"
      sendPresence(nextStatus)
    }

    previousSocketStatusRef.current = socketStatus
  }, [selfId, sendPresence, socketStatus])

  return <>{children}</>
}

export default VisibilityProvider
