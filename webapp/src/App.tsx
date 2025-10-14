import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  API_BASE_URL,
  type ChatMessage,
  fetchConversation,
  sendMessage,
} from "./lib/messagesApi.js";
import useWebRtcMessaging, {
  type MessageStatusUpdate,
  type WebRtcMessage,
} from "./hooks/useWebRtcMessaging.js";

const storageKeys = {
  selfId: "p2p-chat:selfId",
  peerId: "p2p-chat:peerId",
};

function App(): JSX.Element {
  const [selfId, setSelfId] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return window.localStorage.getItem(storageKeys.selfId) ?? "";
  });
  const [peerId, setPeerId] = useState(() => {
    if (typeof window === "undefined") {
      return "";
    }

    return window.localStorage.getItem(storageKeys.peerId) ?? "";
  });
  const [messageInput, setMessageInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [peerTyping, setPeerTyping] = useState(false);
  const typingTimeoutRef = useRef<number | null>(null);
  const typingActiveRef = useRef(false);
  const peerTypingTimeoutRef = useRef<number | null>(null);
  const readAckedRef = useRef<Set<string>>(new Set());
  const previousSocketStatusRef = useRef<string>("disconnected");

  const normalizedSelfId = selfId.trim();
  const normalizedPeerId = peerId.trim();
  const conversationReady =
    normalizedSelfId.length > 0 && normalizedPeerId.length > 0;

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKeys.selfId, selfId);
    }
  }, [selfId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKeys.peerId, peerId);
    }
  }, [peerId]);

  const sortedMessages = useMemo(() => {
    return [...messages].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [messages]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!conversationReady) {
      setMessages([]);
      setStatusMessage(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const loadHistory = async () => {
      try {
        const conversation = await fetchConversation(
          normalizedSelfId,
          normalizedPeerId,
        );
        if (!cancelled) {
          setMessages(conversation);
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Failed to fetch messages.";
          setError(message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadHistory();

    return () => {
      cancelled = true;
    };
  }, [conversationReady, normalizedPeerId, normalizedSelfId]);

  const handlePeerTyping = useCallback(
    (typing: boolean) => {
      setPeerTyping(typing);
      if (peerTypingTimeoutRef.current !== null) {
        window.clearTimeout(peerTypingTimeoutRef.current);
        peerTypingTimeoutRef.current = null;
      }
      if (typing) {
        peerTypingTimeoutRef.current = window.setTimeout(() => {
          setPeerTyping(false);
          peerTypingTimeoutRef.current = null;
        }, 4000);
      }
    },
    [],
  );

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
      };
      setMessages((prev) => dedupeAndSort([...prev, chatMessage]));
      handlePeerTyping(false);
    },
    [handlePeerTyping],
  );

  const handleStatusUpdate = useCallback(
    (update: MessageStatusUpdate) => {
      if (update.status === "sent") {
        return;
      }
      setMessages((prev) =>
        prev.map((message) => {
          if (message.id !== update.messageId) {
            return message;
          }
          const next = { ...message };
          if (update.status === "delivered") {
            next.delivered = true;
            next.deliveredAt = new Date(update.timestamp).toISOString();
          }
          if (update.status === "read") {
            next.read = true;
            next.readAt = new Date(update.timestamp).toISOString();
            next.delivered = true;
            next.deliveredAt = next.deliveredAt ?? next.readAt;
            readAckedRef.current.add(update.messageId);
          }
          return next;
        }),
      );
    },
    [],
  );

  const {
    status: rtcStatus,
    socketStatus,
    error: rtcError,
    dataChannelReady,
    sendMessage: sendViaRtc,
    sendTyping,
    sendStatus,
  } = useWebRtcMessaging({
    selfId: normalizedSelfId,
    peerId: normalizedPeerId,
    enabled: conversationReady,
    onMessage: appendIncomingMessage,
    onTyping: handlePeerTyping,
    onStatus: handleStatusUpdate,
  });

  const isMessageEmpty = messageInput.trim().length === 0;
  const canSendMessage = conversationReady && !isSending && !isMessageEmpty;

  const rtcStatusLabels: Record<string, string> = {
    idle: "Idle",
    "fetching-ice": "Fetching ICE",
    waiting: "Waiting for peer",
    negotiating: "Negotiating",
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Error",
  };

  const rtcStatusLabel = rtcStatusLabels[rtcStatus] ?? rtcStatus;

  const socketStatusLabels: Record<string, string> = {
    connected: "Connected",
    connecting: "Connecting",
    disconnected: "Disconnected",
  };

  const socketStatusLabel =
    socketStatusLabels[socketStatus] ?? socketStatus ?? "Unknown";

  const dataChannelLabel = dataChannelReady ? "Open" : "Closed";
  const dataChannelStatusClass = dataChannelReady ? "status-open" : "status-closed";

  const getMessageStatusLabel = useCallback(
    (message: ChatMessage): { label: string; className: string } | null => {
      if (message.senderId !== normalizedSelfId) {
        return null;
      }

      if (message.read) {
        return { label: "Read", className: "read" };
      }

      if (message.delivered) {
        return { label: "Delivered", className: "delivered" };
      }

      return { label: "Sent", className: "sent" };
    },
    [normalizedSelfId],
  );

  const handleMessageChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      setMessageInput(value);
      setStatusMessage(null);

      if (!conversationReady) {
        return;
      }

      if (!typingActiveRef.current) {
        typingActiveRef.current = true;
        void sendTyping(true);
      }

      if (typingTimeoutRef.current !== null) {
        window.clearTimeout(typingTimeoutRef.current);
      }

      typingTimeoutRef.current = window.setTimeout(() => {
        typingActiveRef.current = false;
        void sendTyping(false);
        typingTimeoutRef.current = null;
      }, 2000);
    },
    [conversationReady, sendTyping],
  );

  const handleInputBlur = useCallback(() => {
    if (!conversationReady) {
      return;
    }

    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }

    if (typingActiveRef.current) {
      typingActiveRef.current = false;
      void sendTyping(false);
    }
  }, [conversationReady, sendTyping]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!conversationReady) {
      setError("Add both your ID and your peer's ID before sending messages.");
      return;
    }

    const content = messageInput.trim();
    if (!content) {
      return;
    }

    if (typingTimeoutRef.current !== null) {
      window.clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (typingActiveRef.current) {
      typingActiveRef.current = false;
      void sendTyping(false);
    }
    handlePeerTyping(false);

    setIsSending(true);
    setError(null);
    setStatusMessage(null);
    try {
      const persisted = await sendMessage({
        senderId: normalizedSelfId,
        recipientId: normalizedPeerId,
        content,
      });
      setMessageInput("");
      setMessages((prev) => dedupeAndSort([...prev, persisted]));
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
      };
      let deliveredViaRtc = false;
      try {
        await sendViaRtc(wirePayload);
        deliveredViaRtc = true;
      } catch (rtcSendError) {
        console.warn("WebRTC delivery failed, relying on backend queue.", rtcSendError);
      }
      setStatusMessage(
        deliveredViaRtc
          ? "Message sent via WebRTC."
          : "Message stored for delivery. Peer will receive it when online.",
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to send message.";
      setError(message);
    } finally {
      setIsSending(false);
    }
  };

  useEffect(() => {
    if (!conversationReady) {
      if (typingTimeoutRef.current !== null) {
        window.clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      typingActiveRef.current = false;
      void sendTyping(false);
      handlePeerTyping(false);
    }
  }, [conversationReady, handlePeerTyping, sendTyping]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current !== null) {
        window.clearTimeout(typingTimeoutRef.current);
      }
      if (peerTypingTimeoutRef.current !== null) {
        window.clearTimeout(peerTypingTimeoutRef.current);
      }
      typingActiveRef.current = false;
      void sendTyping(false);
      handlePeerTyping(false);
    };
  }, [handlePeerTyping, sendTyping]);


  useEffect(() => {
    if (!conversationReady || socketStatus !== "connected") {
      previousSocketStatusRef.current = socketStatus;
      return;
    }

    if (previousSocketStatusRef.current === "connected") {
      return;
    }

    previousSocketStatusRef.current = socketStatus;
    let cancelled = false;

    const refreshMessages = async () => {
      try {
        const conversation = await fetchConversation(
          normalizedSelfId,
          normalizedPeerId,
        );
        if (!cancelled) {
          setMessages(conversation);
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : "Failed to refresh messages.";
          setError(message);
        }
      }
    };

    void refreshMessages();

    return () => {
      cancelled = true;
    };
  }, [
    conversationReady,
    normalizedPeerId,
    normalizedSelfId,
    socketStatus,
  ]);

  useEffect(() => {
    if (!conversationReady) {
      readAckedRef.current.clear();
      return;
    }

    sortedMessages.forEach((message) => {
      if (
        message.recipientId === normalizedSelfId &&
        !message.read &&
        !readAckedRef.current.has(message.id)
      ) {
        readAckedRef.current.add(message.id);
        void sendStatus(message.id, "read");
      }
    });
  }, [
    conversationReady,
    normalizedSelfId,
    sendStatus,
    sortedMessages,
  ]);

  useEffect(() => {
    readAckedRef.current.clear();
  }, [normalizedPeerId, normalizedSelfId]);

  return (
    <div className="chat-shell">
      <aside className="chat-sidebar">
        <header>
          <h1>P2P Chat</h1>
          <p className="description">
            Configure participant identifiers to start exchanging messages
            through the signaling API.
          </p>
        </header>
        <div className="field-group">
          <label htmlFor="selfId">Your ID</label>
          <input
            id="selfId"
            name="selfId"
            type="text"
            placeholder="e.g. alice"
            value={selfId}
            onChange={(event) => setSelfId(event.target.value)}
          />
        </div>
        <div className="field-group">
          <label htmlFor="peerId">Peer ID</label>
          <input
            id="peerId"
            name="peerId"
            type="text"
            placeholder="e.g. bob"
            value={peerId}
            onChange={(event) => setPeerId(event.target.value)}
          />
        </div>
        <section className="status-panel">
          <p>
            Backend: <code>{API_BASE_URL}</code>
          </p>
          {!conversationReady && (
            <p className="hint">
              Enter both IDs to load the conversation and start chatting.
            </p>
          )}
          {statusMessage && <p className="status ok">{statusMessage}</p>}
          <p className="status info">
            WebRTC status:{" "}
            <span className={`status-pill status-${rtcStatus}`}>
              {rtcStatusLabel}
            </span>
          </p>
          <p className="status info">
            Data channel:{" "}
            <span className={`status-pill ${dataChannelStatusClass}`}>
              {dataChannelLabel}
            </span>
          </p>
          <p className="status info">
            WebSocket status:{" "}
            <span className={`status-pill status-${socketStatus}`}>
              {socketStatusLabel}
            </span>
          </p>
          {isLoading && <p className="status info">Loading conversation…</p>}
          {error && <p className="status error">{error}</p>}
          {rtcError && <p className="status error">WebRTC: {rtcError}</p>}
        </section>
      </aside>
      <main className="chat-main">
        <header className="chat-header">
          <h2>
            {conversationReady
              ? `Conversation: ${normalizedSelfId} ↔ ${normalizedPeerId}`
              : "Waiting for participants…"}
          </h2>
        </header>
        <section className="chat-messages" aria-live="polite">
          {!conversationReady && (
            <div className="empty-state">
              <p>Set your identifiers to begin.</p>
            </div>
          )}
          {conversationReady && sortedMessages.length === 0 && !isLoading && (
            <div className="empty-state">
              <p>No messages yet. Say hello!</p>
            </div>
          )}
          {sortedMessages.map((message) => {
            const isMine = message.senderId === normalizedSelfId;
            const statusInfo = getMessageStatusLabel(message);
            return (
              <article
                key={message.id}
                className={`message ${isMine ? "mine" : "theirs"}`}
              >
                <div className="message-meta">
                  <span className="author">
                    {isMine ? "You" : message.senderId}
                  </span>
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleTimeString()}
                  </time>
                </div>
                <p className="message-body">{message.content}</p>
                {statusInfo && (
                  <span className={`message-status ${statusInfo.className}`}>
                    {statusInfo.label}
                  </span>
                )}
              </article>
            );
          })}
          {peerTyping && (
            <div className="typing-indicator">
              {(normalizedPeerId || "Peer")} is typing…
            </div>
          )}
        </section>
        <form className="chat-composer" onSubmit={handleSubmit}>
          <textarea
            name="message"
            placeholder="Type a message…"
            rows={3}
            value={messageInput}
            onChange={handleMessageChange}
            onBlur={handleInputBlur}
            disabled={!conversationReady}
          />
          <button type="submit" disabled={!canSendMessage}>
            {isSending ? "Sending…" : "Send"}
          </button>
        </form>
      </main>
    </div>
  );
}

function dedupeAndSort(messages: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  for (const message of messages) {
    const key =
      message.id && message.id.length > 0
        ? message.id
        : `${message.senderId}-${message.recipientId}-${message.createdAt}`;
    if (map.has(key)) {
      const existing = map.get(key)!;
      map.set(key, {
        ...existing,
        ...message,
        delivered: existing.delivered || message.delivered,
        deliveredAt: message.deliveredAt ?? existing.deliveredAt,
        read: existing.read || message.read,
        readAt: message.readAt ?? existing.readAt,
      });
    } else {
      map.set(key, message);
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export default App;
