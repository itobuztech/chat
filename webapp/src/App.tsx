import {
  useEffect,
  useRef,
} from "react"

import {
  type PresenceStatus,
} from "./lib/messagesApi"
import {
  Card,
  CardContent,
  CardHeader,
} from "./components/ui/card"
import AppHeader from './components/left/AppHeader'
import useUser from './hooks/useUser'
import MyInfo from './components/left/MyInfo'
import Conversations from './components/left/Conversations'
import ChatHeader from './components/right/ChatHeader'
import Conversation from './components/right/Conversation'
import useWebRtcMessaging from './hooks/useWebRtcMessaging'


function App(): JSX.Element {
  const {selfId, peerId, conversationReady} = useUser();

  const {sendPresence, socketStatus} = useWebRtcMessaging({
    selfId,
    peerId,
    enabled: conversationReady,
  })

  const previousSocketStatusRef = useRef<string>("disconnected");

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
  }, [conversationReady, selfId, sendPresence])

  useEffect(() => {
    if (!conversationReady || socketStatus !== "connected") {
      previousSocketStatusRef.current = socketStatus
      return
    }

    if (previousSocketStatusRef.current === "connected") {
      return
    }

    previousSocketStatusRef.current = socketStatus
    // let cancelled = false

    // const refreshMessages = async () => {
    //   try {
    //     const conversation = await fetchConversation(
    //       selfId,
    //       peerId,
    //     )
    //     if (!cancelled) {
    //       setMessages(conversation)
    //     }
    //   } catch (err) {
    //     if (!cancelled) {
    //       // const message =
    //       //   err instanceof Error ? err.message : "Failed to refresh messages."
    //       // setError(message)
    //     }
    //   }
    // }

    // void refreshMessages()

    // return () => {
    //   cancelled = true
    // }
  }, [conversationReady, socketStatus])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex h-screen max-w-6xl flex-col gap-4 p-4 md:flex-row">
        <Card className="flex h-full flex-col md:w-80">
          <CardHeader className="space-y-4">
            <AppHeader />
            <MyInfo />
          </CardHeader>

          <CardContent className="flex flex-1 flex-col gap-4 overflow-hidden">
            <Conversations />
          </CardContent>
        </Card>

        <Card className="flex h-full flex-1 flex-col">
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <ChatHeader />
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
            <Conversation />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default App
