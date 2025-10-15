import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Loader2, MessageSquareReply, Send, X } from "lucide-react"

import {
  type ChatMessage,
  type ConversationSummary,
  type PresenceStatus,
  fetchConversation,
  fetchConversations,
  sendMessage,
} from "./lib/messagesApi"
import useWebRtcMessaging, {
  type WebRtcMessage,
} from "./hooks/useWebRtcMessaging"
import { Button } from "./components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card"
import { Badge } from "./components/ui/badge"
import { Input } from "./components/ui/input"
import { ScrollArea } from "./components/ui/scroll-area"
import { Textarea } from "./components/ui/textarea"
import { cn } from "./lib/utils"

const storageKeys = {
  selfId: "p2p-chat:selfId",
  peerId: "p2p-chat:peerId",
}

function App(): JSX.Element {
  const [selfId, setSelfId] = useState(() => {
    if (typeof window === "undefined") {
      return ""
    }
    return window.localStorage.getItem(storageKeys.selfId) ?? ""
  })
  const [peerId, setPeerId] = useState(() => {
    if (typeof window === "undefined") {
      return ""
    }
    return window.localStorage.getItem(storageKeys.peerId) ?? ""
  })
  const [messageInput, setMessageInput] = useState("")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [isConversationsLoading, setIsConversationsLoading] = useState(false)
  const [conversationsError, setConversationsError] = useState<string | null>(null)
  const [peerTyping, setPeerTyping] = useState(false)
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null)
  const [presence, setPresence] = useState<Record<string, PresenceStatus>>({})

  const typingTimeoutRef = useRef<number | null>(null)
  const typingActiveRef = useRef(false)
  const peerTypingTimeoutRef = useRef<number | null>(null)
  const previousSocketStatusRef = useRef<string>("disconnected")

  const normalizedSelfId = selfId.trim()
  const normalizedPeerId = peerId.trim()
  const conversationReady =
    normalizedSelfId.length > 0 && normalizedPeerId.length > 0

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKeys.selfId, selfId)
    }
  }, [selfId])

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKeys.peerId, peerId)
    }
  }, [peerId])

  const sortedMessages = useMemo(
    () =>
      [...messages].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [messages],
  )

  const loadConversations = useCallback(async () => {
    if (!normalizedSelfId) {
      setConversations([])
      setConversationsError(null)
      setIsConversationsLoading(false)
      return
    }

    setConversationsError(null)
    setIsConversationsLoading(true)
    try {
      const list = await fetchConversations(normalizedSelfId)
      setConversations(list)
      setPresence((prev) => {
        const next = { ...prev }
        list.forEach((item) => {
          next[item.peerId] = item.peerStatus
        })
        if (normalizedSelfId) {
          const defaultStatus =
            typeof document !== "undefined" && document.hidden ? "away" : "online"
          next[normalizedSelfId] = prev[normalizedSelfId] ?? defaultStatus
        }
        return next
      })
    } catch (loadError) {
      const message =
        loadError instanceof Error
          ? loadError.message
          : "Failed to load conversations."
      setConversationsError(message)
    } finally {
      setIsConversationsLoading(false)
    }
  }, [normalizedSelfId])

  const handlePresenceUpdate = useCallback(
    (peer: string, status: PresenceStatus) => {
      setPresence((prev) => ({ ...prev, [peer]: status }))
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.peerId === peer
            ? { ...conversation, peerStatus: status }
            : conversation,
        ),
      )
    },
    [],
  )

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }

    if (!conversationReady) {
      setMessages([])
      setStatusMessage(null)
      setIsLoading(false)
      setReplyingTo(null)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    const loadHistory = async () => {
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
          const message =
            err instanceof Error ? err.message : "Failed to fetch messages."
          setError(message)
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
  }, [conversationReady, normalizedPeerId, normalizedSelfId])

  useEffect(() => {
    void loadConversations()
  }, [loadConversations, normalizedSelfId])

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
      void loadConversations()
    },
    [handlePeerTyping, loadConversations],
  )

  const {
    socketStatus,
    error: rtcError,
    sendMessage: sendViaRtc,
    sendTyping,
    sendPresence,
  } = useWebRtcMessaging({
    selfId: normalizedSelfId,
    peerId: normalizedPeerId,
    enabled: conversationReady,
    onMessage: appendIncomingMessage,
    onTyping: handlePeerTyping,
    onPresence: handlePresenceUpdate,
  })

  useEffect(() => {
    if (
      !conversationReady ||
      !normalizedSelfId ||
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

  const isMessageEmpty = messageInput.trim().length === 0
  const canSendMessage = conversationReady && !isSending && !isMessageEmpty

  const selfPresenceStatus: PresenceStatus | null =
    normalizedSelfId.length > 0 ? presence[normalizedSelfId] ?? "offline" : null

  const peerPresenceStatus: PresenceStatus | null =
    normalizedPeerId.length > 0
      ? presence[normalizedPeerId] ??
        conversations.find(
          (conversation) => conversation.peerId === normalizedPeerId,
        )?.peerStatus ??
        "offline"
      : null

  const formatConversationPreview = useCallback((content: string): string => {
    const normalized = content.trim().replace(/\s+/g, " ")
    if (!normalized) {
      return "(no content)"
    }
    return normalized.length > 48 ? `${normalized.slice(0, 48)}…` : normalized
  }, [])

  const formatConversationTime = useCallback((iso: string): string => {
    const date = new Date(iso)
    if (Number.isNaN(date.getTime())) {
      return ""
    }
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }, [])

  const handleStartReply = useCallback((message: ChatMessage) => {
    setReplyingTo(message)
  }, [])

  const handleCancelReply = useCallback(() => {
    setReplyingTo(null)
  }, [])

  const handleSelectConversation = useCallback(
    (summary: ConversationSummary) => {
      setPeerId(summary.peerId)
      setStatusMessage(null)
      setError(null)
      setReplyingTo(null)
      setMessageInput("")
    },
    [],
  )

  const handleMessageChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value
      setMessageInput(value)
      setStatusMessage(null)

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
      setError("Add both your ID and your peer's ID before sending messages.")
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
    setError(null)
    setStatusMessage(null)
    try {
      const persisted = await sendMessage({
        senderId: normalizedSelfId,
        recipientId: normalizedPeerId,
        content,
        replyToId: replyingTo?.id,
      })
      setMessageInput("")
      setReplyingTo(null)
      setMessages((prev) => dedupeAndSort([...prev, persisted]))

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
      let deliveredViaRtc = false
      try {
        await sendViaRtc(wirePayload)
        deliveredViaRtc = true
      } catch (rtcSendError) {
        console.warn(
          "WebRTC delivery failed, relying on backend queue.",
          rtcSendError,
        )
      }
      setStatusMessage(
        deliveredViaRtc
          ? "Message sent via WebRTC."
          : "Message stored for delivery. Peer will receive it when online.",
      )
      void loadConversations()
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to send message."
      setError(message)
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
          const message =
            err instanceof Error ? err.message : "Failed to refresh messages."
          setError(message)
        }
      }
    }

    void refreshMessages()

    return () => {
      cancelled = true
    }
  }, [conversationReady, normalizedPeerId, normalizedSelfId, socketStatus])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex h-screen max-w-6xl flex-col gap-4 p-4 md:flex-row">
        <Card className="flex h-full flex-col md:w-80">
          <CardHeader className="space-y-4">
            <div>
              <CardTitle className="text-xl">P2P Chat</CardTitle>
              <CardDescription>
                Configure your identifiers and pick a conversation to start chatting.
              </CardDescription>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Your ID
                </span>
                <Input
                  value={selfId}
                  placeholder="alice"
                  onChange={(event) => setSelfId(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Peer ID
                </span>
                <Input
                  value={peerId}
                  placeholder="bob"
                  onChange={(event) => setPeerId(event.target.value)}
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-4 overflow-hidden">
            <ScrollArea className="inset-0">
              <div className="flex flex-col gap-4">
                {(selfPresenceStatus || peerPresenceStatus) && (
                  <div className="space-y-2 rounded-xl border border-border/60 bg-muted/30 p-3 text-xs">
                    {selfPresenceStatus && (
                      <PresenceRow
                        label={normalizedSelfId || "You"}
                        status={selfPresenceStatus}
                      />
                    )}
                    {normalizedPeerId &&
                      peerPresenceStatus &&
                      (normalizedPeerId !== normalizedSelfId || !selfPresenceStatus) && (
                        <PresenceRow
                          label={normalizedPeerId}
                          status={peerPresenceStatus}
                        />
                      )}
                  </div>
                )}

                {statusMessage && (
                  <div className="rounded-lg bg-primary/10 px-3 py-2 text-xs text-primary-foreground/80">
                    {statusMessage}
                  </div>
                )}
                {error && (
                  <div className="rounded-lg bg-destructive/15 px-3 py-2 text-xs text-destructive">
                    {error}
                  </div>
                )}
                {rtcError && (
                  <div className="rounded-lg bg-destructive/15 px-3 py-2 text-xs text-destructive">
                    {rtcError}
                  </div>
                )}

                <div className="flex items-center justify-between text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  <span>Conversations</span>
                  {isConversationsLoading && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Loading
                    </span>
                  )}
                </div>

                <div className="relative flex-1">
                  <ScrollArea className="inset-0">
                    <div className="space-y-1">
                      {conversationsError && (
                        <div className="rounded-lg bg-destructive/15 px-3 py-2 text-xs text-destructive">
                          {conversationsError}
                        </div>
                      )}
                      {!isConversationsLoading &&
                      conversationsError === null &&
                      conversations.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No conversations yet.
                        </p>
                      ) : (
                        conversations.map((conversation) => {
                          const active = conversation.peerId === normalizedPeerId
                          const replyPreview = conversation.lastMessage.replyTo
                            ? `↪ ${formatConversationPreview(conversation.lastMessage.replyTo.content)} `
                            : ""
                          const preview = `${replyPreview}${formatConversationPreview(
                            conversation.lastMessage.content,
                          )}`
                          const displayTime = formatConversationTime(
                            conversation.lastMessage.createdAt,
                          )
                          const unread = conversation.unreadCount
                          return (
                            <Button
                              type="button"
                              key={conversation.conversationId}
                              variant={active ? "secondary" : "ghost"}
                              className="w-full justify-start rounded-xl px-3 py-3 text-left"
                              onClick={() => handleSelectConversation(conversation)}
                            >
                              <div className="flex w-full flex-col gap-1">
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                  <span className="font-semibold text-foreground">
                                    {conversation.peerId}
                                  </span>
                                  <span>{displayTime}</span>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span className="line-clamp-1">{preview}</span>
                                  {unread > 0 && (
                                    <Badge variant="muted">{unread}</Badge>
                                  )}
                                </div>
                              </div>
                            </Button>
                          )
                        })
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="flex h-full flex-1 flex-col">
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-lg">
                {conversationReady
                  ? `Conversation: ${normalizedSelfId} ↔ ${normalizedPeerId}`
                  : "Select a conversation"}
              </CardTitle>
              <CardDescription>
                Messages are persisted via REST and relayed live over WebRTC (with
                WebSocket fallback).
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {selfPresenceStatus && (
                <PresenceChip
                  label={normalizedSelfId ? `You (${normalizedSelfId})` : "You"}
                  status={selfPresenceStatus}
                />
              )}
              {normalizedPeerId &&
                peerPresenceStatus &&
                (normalizedPeerId !== normalizedSelfId || !selfPresenceStatus) && (
                  <PresenceChip label={normalizedPeerId} status={peerPresenceStatus} />
                )}
            </div>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="relative flex-1 overflow-hidden rounded-2xl border border-border/60 bg-muted/20">
              <ScrollArea className="absolute inset-0 p-4">
                <div className="flex flex-col gap-4">
                  {!conversationReady ? (
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
                      const isMine = message.senderId === normalizedSelfId
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
                                  {message.replyTo.senderId === normalizedSelfId
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
                          </div>
                        </div>
                      )
                    })
                  )}
                  {peerTyping && (
                    <div className="text-sm italic text-muted-foreground">
                      {normalizedPeerId || "Peer"} is typing…
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              {replyingTo && (
                <div className="flex items-start justify-between gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm">
                  <div className="space-y-1">
                    <span className="font-semibold text-muted-foreground">
                      Replying to{" "}
                      {replyingTo.senderId === normalizedSelfId
                        ? "yourself"
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

              <Textarea
                name="message"
                placeholder="Type a message…"
                rows={3}
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
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

const presenceBadgeStyles: Record<PresenceStatus, string> = {
  online: "border-emerald-500/40 bg-emerald-500/15 text-emerald-500",
  away: "border-amber-500/40 bg-amber-500/15 text-amber-500",
  offline: "border-border/60 bg-muted text-muted-foreground",
}

interface PresenceRowProps {
  label: string
  status: PresenceStatus
}

function PresenceRow({ label, status }: PresenceRowProps) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-background/60 px-3 py-2">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      <Badge
        variant="outline"
        className={cn("text-xs font-semibold capitalize", presenceBadgeStyles[status])}
      >
        {status}
      </Badge>
    </div>
  )
}

interface PresenceChipProps {
  label: string
  status: PresenceStatus
}

function PresenceChip({ label, status }: PresenceChipProps) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "flex items-center gap-1 text-xs font-semibold capitalize",
        presenceBadgeStyles[status],
      )}
    >
      <span className="text-muted-foreground/80">{label}</span>
      <span>{status}</span>
    </Badge>
  )
}

function dedupeAndSort(messages: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>()
  for (const message of messages) {
    const key =
      message.id && message.id.length > 0
        ? message.id
        : `${message.senderId}-${message.recipientId}-${message.createdAt}`
    if (map.has(key)) {
      const existing = map.get(key)!
      map.set(key, {
        ...existing,
        ...message,
        delivered: existing.delivered || message.delivered,
        deliveredAt: message.deliveredAt ?? existing.deliveredAt,
        read: existing.read || message.read,
        readAt: message.readAt ?? existing.readAt,
        replyTo: message.replyTo ?? existing.replyTo,
      })
    } else {
      map.set(key, message)
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
}

export default App
