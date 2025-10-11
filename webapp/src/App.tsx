import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import {
  API_BASE_URL,
  type ChatMessage,
  fetchConversation,
  sendMessage,
} from "./lib/messagesApi.js";
import useWebRtcMessaging, {
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
        delivered: true,
        deliveredAt: incoming.createdAt,
      };
      setMessages((prev) => dedupeAndSort([...prev, chatMessage]));
      handlePeerTyping(false);
    },
    [handlePeerTyping],
  );

  const {
    status: rtcStatus,
    socketStatus,
    error: rtcError,
    dataChannelReady,
    sendMessage: sendViaRtc,
    sendTyping,
  } = useWebRtcMessaging({
    selfId: normalizedSelfId,
    peerId: normalizedPeerId,
    enabled: conversationReady,
    onMessage: appendIncomingMessage,
    onTyping: handlePeerTyping,
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
    map.set(key, message);
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export default App;
