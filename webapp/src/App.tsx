import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
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
    },
    [],
  );

  const {
    status: rtcStatus,
    error: rtcError,
    sendMessage: sendViaRtc,
  } = useWebRtcMessaging({
    selfId: normalizedSelfId,
    peerId: normalizedPeerId,
    enabled: conversationReady,
    onMessage: appendIncomingMessage,
  });

  const canSendMessage =
    conversationReady && rtcStatus === "connected" && !isSending;

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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!conversationReady) {
      setError("Add both your ID and your peer's ID before sending messages.");
      return;
    }

    if (rtcStatus !== "connected") {
      setError("WebRTC connection is not ready yet. Please wait.");
      return;
    }

    const content = messageInput.trim();
    if (!content) {
      return;
    }

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
      await sendViaRtc(wirePayload);
      setStatusMessage("Message sent via WebRTC.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to send message.";
      setError(message);
    } finally {
      setIsSending(false);
    }
  };

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
        </section>
        <form className="chat-composer" onSubmit={handleSubmit}>
          <textarea
            name="message"
            placeholder="Type a message…"
            rows={3}
            value={messageInput}
            onChange={(event) => setMessageInput(event.target.value)}
            disabled={!canSendMessage}
          />
          <button type="submit" disabled={!canSendMessage}>
            {isSending
              ? "Sending…"
              : rtcStatus === "connected"
                ? "Send"
                : "Connecting…"}
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
