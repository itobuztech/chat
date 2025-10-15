import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from "react"

import useUser from "@/hooks/useUser"
import useWebRtcMessaging, { type WebRtcMessage } from "@/hooks/useWebRtcMessaging"
import { type PresenceStatus } from "@/lib/messagesApi"

type MessageListener = (message: WebRtcMessage) => void
type TypingListener = (typing: boolean) => void
type PresenceListener = (peerId: string, status: PresenceStatus) => void

type WebRtcHookResult = ReturnType<typeof useWebRtcMessaging>

interface WebRtcContextValue extends WebRtcHookResult {
  selfId: string
  peerId: string
  conversationReady: boolean
  subscribeToMessages: (listener: MessageListener) => () => void
  subscribeToTyping: (listener: TypingListener) => () => void
  subscribeToPresence: (listener: PresenceListener) => () => void
}

const WebRTCContext = createContext<WebRtcContextValue | undefined>(undefined)

export function WebRTCProvider({ children }: { children: ReactNode }) {
  const { selfId, peerId, conversationReady } = useUser()

  const messageListenersRef = useRef(new Set<MessageListener>())
  const typingListenersRef = useRef(new Set<TypingListener>())
  const presenceListenersRef = useRef(new Set<PresenceListener>())
  const presenceStateRef = useRef(new Map<string, PresenceStatus>())

  const notifyMessage = useCallback((message: WebRtcMessage) => {
    for (const listener of messageListenersRef.current) {
      listener(message)
    }
  }, [])

  const notifyTyping = useCallback((typing: boolean) => {
    for (const listener of typingListenersRef.current) {
      listener(typing)
    }
  }, [])

  const notifyPresence = useCallback(
    (peer: string, status: PresenceStatus) => {
      presenceStateRef.current.set(peer, status)
      for (const listener of presenceListenersRef.current) {
        listener(peer, status)
      }
    },
    [],
  )

  const rtc = useWebRtcMessaging({
    selfId,
    peerId,
    enabled: conversationReady,
    onMessage: notifyMessage,
    onTyping: notifyTyping,
    onPresence: notifyPresence,
  })

  const subscribeToMessages = useCallback((listener: MessageListener) => {
    messageListenersRef.current.add(listener)
    return () => {
      messageListenersRef.current.delete(listener)
    }
  }, [])

  const subscribeToTyping = useCallback((listener: TypingListener) => {
    typingListenersRef.current.add(listener)
    return () => {
      typingListenersRef.current.delete(listener)
    }
  }, [])

  const subscribeToPresence = useCallback((listener: PresenceListener) => {
    presenceListenersRef.current.add(listener)
    for (const [peer, status] of presenceStateRef.current.entries()) {
      listener(peer, status)
    }
    return () => {
      presenceListenersRef.current.delete(listener)
    }
  }, [])

  const {
    status,
    socketStatus,
    error,
    dataChannelReady,
    sendMessage,
    sendTyping,
    sendPresence,
    disconnect,
  } = rtc

  const value = useMemo(
    () => ({
      status,
      socketStatus,
      error,
      dataChannelReady,
      sendMessage,
      sendTyping,
      sendPresence,
      disconnect,
      selfId,
      peerId,
      conversationReady,
      subscribeToMessages,
      subscribeToTyping,
      subscribeToPresence,
    }),
    [
      status,
      socketStatus,
      error,
      dataChannelReady,
      sendMessage,
      sendTyping,
      sendPresence,
      disconnect,
      selfId,
      peerId,
      conversationReady,
      subscribeToMessages,
      subscribeToTyping,
      subscribeToPresence,
    ],
  )

  return <WebRTCContext.Provider value={value}>{children}</WebRTCContext.Provider>
}

export const useWebRTCContext = () => {
  const context = useContext(WebRTCContext)
  if (!context) {
    throw new Error("useWebRTCContext must be used within a WebRTCProvider")
  }
  return context
}
