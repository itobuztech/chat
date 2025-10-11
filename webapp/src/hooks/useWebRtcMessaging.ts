import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchIceConfig,
  fetchPendingSignals,
  sendSignal,
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

export function useWebRtcMessaging({
  selfId,
  peerId,
  enabled,
  onMessage,
}: UseWebRtcMessagingOptions): UseWebRtcMessagingResult {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const normalizedSelfId = selfId.trim();
  const normalizedPeerId = peerId.trim();
  const conversationId = useMemo(
    () => createConversationId(normalizedSelfId, normalizedPeerId),
    [normalizedPeerId, normalizedSelfId],
  );

  const isInitiator = useMemo(() => {
    return normalizedSelfId < normalizedPeerId;
  }, [normalizedPeerId, normalizedSelfId]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const iceBundleRef = useRef<IceBundle | null>(null);
  const pendingIcePromiseRef = useRef<Promise<IceBundle> | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);
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
          await sendSignal({
            sessionId: sessionIdRef.current,
            senderId: normalizedSelfId,
            recipientId: normalizedPeerId,
            type: "candidate",
            payload: event.candidate.toJSON(),
          });
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
    [
      ensureIceConfig,
      normalizedPeerId,
      normalizedSelfId,
      resetConnectionRefs,
      setupDataChannel,
    ],
  );

  const sendByeSignal = useCallback(async () => {
    if (!sessionIdRef.current) {
      return;
    }
    try {
      await sendSignal({
        sessionId: sessionIdRef.current,
        senderId: normalizedSelfId,
        recipientId: normalizedPeerId,
        type: "bye",
        payload: null,
      });
    } catch (byeError) {
      console.warn("Failed to send BYE signal", byeError);
    }
  }, [normalizedPeerId, normalizedSelfId]);

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

        await sendSignal({
          sessionId: signal.sessionId,
          senderId: normalizedSelfId,
          recipientId: normalizedPeerId,
          type: "answer",
          payload: JSON.parse(JSON.stringify(answer)),
        });
      } catch (offerError) {
        console.error("Failed to process offer", offerError);
        setError(
          offerError instanceof Error ? offerError.message : "Offer failed.",
        );
        setStatus("error");
      }
    },
    [ensurePeerConnection, normalizedPeerId, normalizedSelfId],
  );

  const processAnswer = useCallback(
    async (signal: WebRtcSignal) => {
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
    },
    [],
  );

  const processCandidate = useCallback(async (signal: WebRtcSignal) => {
    try {
      if (!pcRef.current || !signal.payload) {
        return;
      }
      await pcRef.current.addIceCandidate(
        signal.payload as RTCIceCandidateInit,
      );
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

  const startConnection = useCallback(async () => {
    if (startInFlightRef.current) {
      return;
    }
    startInFlightRef.current = true;
    try {
      const sessionId = `${conversationId}-${Date.now()}`;
      const peerConnection = await ensurePeerConnection(sessionId);

      const dataChannel = peerConnection.createDataChannel("chat", {
        ordered: true,
      });
      setupDataChannel(dataChannel);

      setStatus("negotiating");

      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);

      await sendSignal({
        sessionId,
        senderId: normalizedSelfId,
        recipientId: normalizedPeerId,
        type: "offer",
        payload: JSON.parse(JSON.stringify(offer)),
      });
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
  }, [
    conversationId,
    ensurePeerConnection,
    normalizedPeerId,
    normalizedSelfId,
    setupDataChannel,
  ]);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current !== null) {
      window.clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled || !normalizedSelfId || !normalizedPeerId) {
      stopPolling();
      void cleanupConnection();
      setStatus("idle");
      setError(null);
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const signals = await fetchPendingSignals(
          normalizedSelfId,
          sessionIdRef.current ?? undefined,
        );
        for (const signal of signals) {
          if (cancelled) {
            return;
          }
          await handleIncomingSignal(signal);
        }
      } catch (pollError) {
        console.error("Failed to poll WebRTC signals", pollError);
        if (!cancelled) {
          setError(
            pollError instanceof Error
              ? pollError.message
              : "Failed to poll WebRTC signals.",
          );
          setStatus("error");
        }
      }
    };

    void ensureIceConfig()
      .then(() => {
        if (cancelled) {
          return;
        }
        if (isInitiator && !pcRef.current && !startInFlightRef.current) {
          void startConnection();
        }
        void poll();
        if (pollingIntervalRef.current === null) {
          pollingIntervalRef.current = window.setInterval(poll, 2000);
        }
      })
      .catch(() => {
        /* error handled in ensureIceConfig */
      });

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [
    cleanupConnection,
    enabled,
    ensureIceConfig,
    handleIncomingSignal,
    isInitiator,
    normalizedPeerId,
    normalizedSelfId,
    startConnection,
    stopPolling,
  ]);

  useEffect(() => {
    if (!enabled || !isInitiator) {
      return;
    }

    if (
      status === "connected" ||
      status === "negotiating" ||
      status === "error"
    ) {
      return;
    }

    if (pcRef.current || startInFlightRef.current) {
      return;
    }

    void ensureIceConfig()
      .then(() => {
        if (!pcRef.current && !startInFlightRef.current) {
          void startConnection();
        }
      })
      .catch(() => {
        /* handled in ensureIceConfig */
      });
  }, [
    enabled,
    ensureIceConfig,
    isInitiator,
    startConnection,
    status,
  ]);

  useEffect(() => {
    return () => {
      stopPolling();
      void cleanupConnection();
    };
  }, [cleanupConnection, stopPolling]);

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
    error,
    sendMessage,
    disconnect,
  };
}

export default useWebRtcMessaging;
