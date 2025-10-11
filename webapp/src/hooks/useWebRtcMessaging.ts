import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { API_BASE_URL } from "../lib/messagesApi.js";
import {
  fetchIceConfig,
  fetchPendingSignals,
  persistSignal,
  type SignalType,
  type WebRtcSignal,
} from "../lib/webrtcSignalsApi.js";

type ConnectionStatus =
  | "idle"
  | "fetching-ice"
  | "waiting"
  | "negotiating"
  | "connected"
  | "disconnected"
  | "error";

type SocketStatus = "connecting" | "connected" | "disconnected";

export interface WebRtcMessage {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  createdAt: string;
}

interface UseWebRtcMessagingOptions {
  selfId: string;
  peerId: string;
  enabled: boolean;
  onMessage: (message: WebRtcMessage) => void;
}

interface UseWebRtcMessagingResult {
  status: ConnectionStatus;
  socketStatus: SocketStatus;
  error: string | null;
  sendMessage: (message: WebRtcMessage) => Promise<void>;
  disconnect: () => Promise<void>;
}

interface IceBundle {
  iceServers: RTCIceServer[];
  expiresAt: number;
}

function createConversationId(a: string, b: string): string {
  return [a.trim(), b.trim()].sort((left, right) => left.localeCompare(right)).join("#");
}

function deriveWebSocketUrl(baseHttpUrl: string): string {
  const explicit =
    typeof import.meta.env.VITE_WS_URL === "string"
      ? import.meta.env.VITE_WS_URL.trim()
      : "";
  if (explicit) {
    return explicit;
  }

  try {
    const url = new URL(baseHttpUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = `${url.pathname.replace(/\/$/, "")}/ws`;
    return url.toString();
  } catch {
    return `${baseHttpUrl.replace(/^http/i, "ws").replace(/\/$/, "")}/ws`;
  }
}

export function useWebRtcMessaging({
  selfId,
  peerId,
  enabled,
  onMessage,
}: UseWebRtcMessagingOptions): UseWebRtcMessagingResult {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [socketStatus, setSocketStatus] = useState<SocketStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);

  const normalizedSelfId = selfId.trim();
  const normalizedPeerId = peerId.trim();

  const conversationId = useMemo(
    () => createConversationId(normalizedSelfId, normalizedPeerId),
    [normalizedPeerId, normalizedSelfId],
  );

  const isInitiator = useMemo(
    () => normalizedSelfId < normalizedPeerId,
    [normalizedPeerId, normalizedSelfId],
  );

  const wsUrl = useMemo(() => deriveWebSocketUrl(API_BASE_URL), []);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const iceBundleRef = useRef<IceBundle | null>(null);
  const pendingIcePromiseRef = useRef<Promise<IceBundle> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const backlogDrainedRef = useRef(false);
  const startInFlightRef = useRef(false);

  const resetConnectionRefs = useCallback(() => {
    if (dataChannelRef.current) {
      try {
        dataChannelRef.current.close();
      } catch (channelError) {
        console.warn("Failed to close data channel", channelError);
      }
      dataChannelRef.current.onopen = null;
      dataChannelRef.current.onclose = null;
      dataChannelRef.current.onmessage = null;
      dataChannelRef.current.onerror = null;
    }
    dataChannelRef.current = null;

    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.ondatachannel = null;
      try {
        pcRef.current.close();
      } catch (pcError) {
        console.warn("Failed to close RTCPeerConnection", pcError);
      }
    }
    pcRef.current = null;
    sessionIdRef.current = null;
    startInFlightRef.current = false;
  }, []);

  const ensureIceConfig = useCallback(async (): Promise<IceBundle> => {
    const now = Date.now();
    const cached = iceBundleRef.current;
    if (cached && cached.expiresAt > now + 60_000) {
      return cached;
    }

    if (!pendingIcePromiseRef.current) {
      setStatus((prev) =>
        prev === "connected" || prev === "negotiating" ? prev : "fetching-ice",
      );
      pendingIcePromiseRef.current = fetchIceConfig()
        .then((response) => {
          const ttlMilliseconds = Number.isFinite(response.ttlSeconds)
            ? response.ttlSeconds * 1000
            : 3_600_000;
          const bundle: IceBundle = {
            iceServers: response.iceServers,
            expiresAt: Date.now() + ttlMilliseconds,
          };
          iceBundleRef.current = bundle;
          setStatus((prev) =>
            prev === "fetching-ice" || prev === "idle" ? "waiting" : prev,
          );
          return bundle;
        })
        .catch((iceError) => {
          console.error("Failed to fetch ICE config", iceError);
          setError(
            iceError instanceof Error
              ? iceError.message
              : "Failed to load ICE configuration.",
          );
          setStatus("error");
          throw iceError;
        })
        .finally(() => {
          pendingIcePromiseRef.current = null;
        });
    }

    return pendingIcePromiseRef.current;
  }, []);

  const setupDataChannel = useCallback(
    (channel: RTCDataChannel) => {
      dataChannelRef.current = channel;

      channel.onopen = () => {
        setStatus("connected");
        setError(null);
      };

      channel.onclose = () => {
        setStatus("disconnected");
        resetConnectionRefs();
      };

      channel.onerror = (event) => {
        console.error("Data channel error", event);
        setError("Data channel encountered an error.");
        setStatus("error");
      };

      channel.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as WebRtcMessage;
          if (
            payload &&
            typeof payload.id === "string" &&
            typeof payload.content === "string" &&
            typeof payload.senderId === "string" &&
            typeof payload.recipientId === "string"
          ) {
            onMessage(payload);
          }
        } catch (parseError) {
          console.warn("Failed to parse incoming WebRTC message", parseError);
        }
      };
    },
    [onMessage, resetConnectionRefs],
  );

  const sendSignalEnvelope = useCallback(
    async (
      sessionId: string,
      type: SignalType,
      payload: Record<string, unknown> | null,
    ) => {
      const socket = wsRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({
            type: "signal",
            sessionId,
            senderId: normalizedSelfId,
            recipientId: normalizedPeerId,
            signalType: type,
            payload,
          }),
        );
      } else {
        await persistSignal({
          sessionId,
          senderId: normalizedSelfId,
          recipientId: normalizedPeerId,
          type,
          payload,
        });
      }
    },
    [normalizedPeerId, normalizedSelfId],
  );

  const ensurePeerConnection = useCallback(
    async (sessionId: string): Promise<RTCPeerConnection> => {
      if (pcRef.current) {
        if (!sessionIdRef.current) {
          sessionIdRef.current = sessionId;
        }
        return pcRef.current;
      }

      const bundle = await ensureIceConfig();
      const peerConnection = new RTCPeerConnection({
        iceServers: bundle.iceServers,
      });
      sessionIdRef.current = sessionId;
      pcRef.current = peerConnection;

      peerConnection.onicecandidate = async (event) => {
        if (!event.candidate || !sessionIdRef.current) {
          return;
        }
        try {
          await sendSignalEnvelope(
            sessionIdRef.current,
            "candidate",
            event.candidate.toJSON(),
          );
        } catch (candidateError) {
          console.error("Failed to send ICE candidate", candidateError);
        }
      };

      peerConnection.onconnectionstatechange = () => {
        switch (peerConnection.connectionState) {
          case "connected":
            setStatus("connected");
            break;
          case "connecting":
            setStatus("negotiating");
            break;
          case "disconnected":
          case "failed":
            setStatus("disconnected");
            resetConnectionRefs();
            break;
          case "closed":
            setStatus("idle");
            resetConnectionRefs();
            break;
          default:
            break;
        }
      };

      peerConnection.ondatachannel = (event) => {
        setupDataChannel(event.channel);
      };

      return peerConnection;
    },
    [ensureIceConfig, resetConnectionRefs, sendSignalEnvelope, setupDataChannel],
  );

  const sendByeSignal = useCallback(async () => {
    if (!sessionIdRef.current) {
      return;
    }
    try {
      await sendSignalEnvelope(sessionIdRef.current, "bye", null);
    } catch (errorSignal) {
      console.warn("Failed to send bye signal", errorSignal);
    }
  }, [sendSignalEnvelope]);

  const cleanupConnection = useCallback(async () => {
    await sendByeSignal();
    resetConnectionRefs();
    setStatus("disconnected");
  }, [resetConnectionRefs, sendByeSignal]);

  const processOffer = useCallback(
    async (signal: WebRtcSignal) => {
      if (!signal.sessionId) {
        return;
      }
      try {
        setStatus("negotiating");
        const peerConnection = await ensurePeerConnection(signal.sessionId);
        const offerPayload = signal.payload as RTCSessionDescriptionInit | null;
        if (!offerPayload) {
          throw new Error("Offer payload missing.");
        }

        await peerConnection.setRemoteDescription(offerPayload);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        await sendSignalEnvelope(signal.sessionId, "answer", JSON.parse(JSON.stringify(answer)));
      } catch (offerError) {
        console.error("Failed to process offer", offerError);
        setError(
          offerError instanceof Error ? offerError.message : "Offer failed.",
        );
        setStatus("error");
      }
    },
    [ensurePeerConnection, sendSignalEnvelope],
  );

  const processAnswer = useCallback(async (signal: WebRtcSignal) => {
    try {
      if (!pcRef.current || !signal.payload) {
        return;
      }
      await pcRef.current.setRemoteDescription(
        signal.payload as RTCSessionDescriptionInit,
      );
      setStatus("negotiating");
    } catch (answerError) {
      console.error("Failed to process answer", answerError);
      setError(
        answerError instanceof Error ? answerError.message : "Answer failed.",
      );
      setStatus("error");
    }
  }, []);

  const processCandidate = useCallback(async (signal: WebRtcSignal) => {
    try {
      if (!pcRef.current || !signal.payload) {
        return;
      }
      await pcRef.current.addIceCandidate(signal.payload as RTCIceCandidateInit);
    } catch (candidateError) {
      console.error("Failed to add ICE candidate", candidateError);
      setError(
        candidateError instanceof Error
          ? candidateError.message
          : "Failed to add ICE candidate.",
      );
    }
  }, []);

  const handleIncomingSignal = useCallback(
    async (signal: WebRtcSignal) => {
      if (signal.senderId === normalizedSelfId) {
        return;
      }

      switch (signal.type) {
        case "offer":
          await processOffer(signal);
          break;
        case "answer":
          await processAnswer(signal);
          break;
        case "candidate":
          await processCandidate(signal);
          break;
        case "bye":
          await cleanupConnection();
          break;
        default:
          break;
      }
    },
    [
      cleanupConnection,
      normalizedSelfId,
      processAnswer,
      processCandidate,
      processOffer,
    ],
  );

  const drainPendingSignals = useCallback(async () => {
    if (backlogDrainedRef.current || !normalizedSelfId) {
      return;
    }
    try {
      const backlog = await fetchPendingSignals(
        normalizedSelfId,
        sessionIdRef.current ?? undefined,
      );
      for (const signal of backlog) {
        await handleIncomingSignal(signal);
      }
      backlogDrainedRef.current = true;
    } catch (drainError) {
      console.error("Failed to fetch pending signals", drainError);
    }
  }, [handleIncomingSignal, normalizedSelfId]);

  useEffect(() => {
    backlogDrainedRef.current = false;
  }, [normalizedSelfId, normalizedPeerId]);

  useEffect(() => {
    if (!enabled || !normalizedSelfId) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      void cleanupConnection();
      setSocketStatus("disconnected");
      return;
    }

    let cancelled = false;

    const establishSocket = () => {
      if (cancelled) {
        return;
      }
      setSocketStatus("connecting");
      const socket = new WebSocket(wsUrl);
      wsRef.current = socket;

      socket.onopen = () => {
        if (cancelled) {
          return;
        }
        setSocketStatus("connected");
        socket.send(
          JSON.stringify({ type: "hello", peerId: normalizedSelfId }),
        );
      };

      socket.onmessage = async (event) => {
        try {
          const data = JSON.parse(event.data);
          switch (data.type) {
            case "hello:ack":
              backlogDrainedRef.current = false;
              await drainPendingSignals();
              break;
            case "signal":
              if (data.payload) {
                await handleIncomingSignal(data.payload as WebRtcSignal);
              }
              break;
            case "message:new":
            case "message:status":
              if (data.payload) {
                const payload = data.payload as {
                  id: string;
                  conversationId: string;
                  senderId: string;
                  recipientId: string;
                  content: string;
                  createdAt: string;
                };
                if (payload && typeof payload.id === "string") {
                  onMessage({
                    id: payload.id,
                    conversationId: payload.conversationId,
                    senderId: payload.senderId,
                    recipientId: payload.recipientId,
                    content: payload.content,
                    createdAt: payload.createdAt,
                  });
                }
              }
              break;
            case "error":
              if (typeof data.error === "string") {
                setError(data.error);
              }
              break;
            default:
              break;
          }
        } catch (parseError) {
          console.error("Failed to parse WebSocket payload", parseError);
        }
      };

      const scheduleReconnect = () => {
        if (cancelled) {
          return;
        }
        if (reconnectTimerRef.current !== null) {
          return;
        }
        reconnectTimerRef.current = window.setTimeout(() => {
          reconnectTimerRef.current = null;
          establishSocket();
        }, 2000);
      };

      socket.onclose = () => {
        if (cancelled) {
          return;
        }
        setSocketStatus("disconnected");
        scheduleReconnect();
      };

      socket.onerror = (socketError) => {
        console.error("WebSocket error", socketError);
        setSocketStatus("disconnected");
      };
    };

    establishSocket();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const socket = wsRef.current;
      if (socket) {
        socket.onclose = null;
        socket.onerror = null;
        socket.onopen = null;
        socket.onmessage = null;
        socket.close();
        wsRef.current = null;
      }
      setSocketStatus("disconnected");
    };
  }, [
    cleanupConnection,
    drainPendingSignals,
    enabled,
    handleIncomingSignal,
    normalizedSelfId,
    onMessage,
    wsUrl,
  ]);

  const startConnection = useCallback(async () => {
    if (startInFlightRef.current) {
      return;
    }
    startInFlightRef.current = true;
    try {
      const newSessionId = `${conversationId}-${Date.now()}`;
      const peerConnection = await ensurePeerConnection(newSessionId);

      const dataChannel = peerConnection.createDataChannel("chat", {
        ordered: true,
      });
      setupDataChannel(dataChannel);

      setStatus("negotiating");

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      await sendSignalEnvelope(
        newSessionId,
        "offer",
        JSON.parse(JSON.stringify(offer)),
      );
    } catch (startError) {
      console.error("Failed to start WebRTC connection", startError);
      setError(
        startError instanceof Error
          ? startError.message
          : "Failed to start WebRTC connection.",
      );
      setStatus("error");
    } finally {
      startInFlightRef.current = false;
    }
  }, [conversationId, ensurePeerConnection, sendSignalEnvelope, setupDataChannel]);

  useEffect(() => {
    if (
      !enabled ||
      !normalizedSelfId ||
      !normalizedPeerId ||
      status === "connected" ||
      status === "negotiating" ||
      status === "error"
    ) {
      return;
    }

    if (isInitiator && !pcRef.current && !startInFlightRef.current) {
      void startConnection();
    }
  }, [
    enabled,
    isInitiator,
    normalizedPeerId,
    normalizedSelfId,
    startConnection,
    status,
  ]);

  useEffect(() => {
    return () => {
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const socket = wsRef.current;
      if (socket) {
        socket.close();
        wsRef.current = null;
      }
      void cleanupConnection();
    };
  }, [cleanupConnection]);

  const sendMessage = useCallback(async (message: WebRtcMessage) => {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== "open") {
      throw new Error("WebRTC data channel is not ready.");
    }
    channel.send(JSON.stringify(message));
  }, []);

  const disconnect = useCallback(async () => {
    await cleanupConnection();
  }, [cleanupConnection]);

  return {
    status,
    socketStatus,
    error,
    sendMessage,
    disconnect,
  };
}

export default useWebRtcMessaging;
