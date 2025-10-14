import type { Server as HttpServer } from "http";

import type { ObjectId } from "mongodb";
import { WebSocketServer, WebSocket } from "ws";


import type { MessageDocument } from "../lib/mongoClient";
import { updateMessageStatus } from "../services/messageService";
import { saveSignal } from "../services/signalingService";
import type { ApiMessage, ApiSignal } from "../types/api";
import { toApiMessage } from "../utils/formatters";

type ClientRegistry = Map<string, Set<WebSocket>>;

type TypingState = "start" | "stop";

type MessageStatus = "sent" | "delivered" | "read";

interface SignalOutbound {
  type: "signal";
  payload: ApiSignal;
}

interface MessageOutbound {
  type: "message:new" | "message:status";
  payload: ApiMessage;
}

interface TypingPayload {
  senderId: string;
  recipientId: string;
  conversationId: string;
  state: TypingState;
  timestamp: number;
}

interface TypingOutbound {
  type: "typing";
  payload: TypingPayload;
}

interface MessageStatusPayload {
  messageId: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  status: MessageStatus;
  timestamp: number;
}

interface MessageStatusOutbound {
  type: "message:status-update";
  payload: MessageStatusPayload;
}

interface ErrorOutbound {
  type: "error";
  error: string;
}

type OutboundEvent =
  | SignalOutbound
  | MessageOutbound
  | TypingOutbound
  | MessageStatusOutbound
  | ErrorOutbound
  | Record<string, unknown>;

let registry: ClientRegistry = new Map();
let wss: WebSocketServer | null = null;

export function initializeWebSocketServer(server: HttpServer): void {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket: WebSocket) => {
    let peerId: string | null = null;

    socket.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        const type = data?.type;
        switch (type) {
          case "hello": {
            const incomingPeer = typeof data.peerId === "string" ? data.peerId.trim() : "";
            if (!incomingPeer) {
              send(socket, { type: "error", error: "peerId is required" });
              socket.close();
              return;
            }
            peerId = incomingPeer;
            registerClient(peerId!, socket);

            send(socket, { type: "hello:ack", peerId: incomingPeer });
            break;
          }
          case "signal": {
            if (!peerId) {
              send(socket, { type: "error", error: "Handshake not completed." });
              return;
            }
            await handleSignalEvent(socket, data);
            break;
          }
          case "messageStatus": {
            if (!peerId) {
              send(socket, { type: "error", error: "Handshake not completed." });
              return;
            }
            const messageId =
              typeof data.messageId === "string" ? data.messageId.trim() : "";
            const status =
              data.status === "delivered"
                ? "delivered"
                : data.status === "read"
                  ? "read"
                  : null;
            if (!messageId || !status) {
              send(socket, { type: "error", error: "Invalid message status payload." });
              break;
            }

            const result = await updateMessageStatus(messageId, status);
            if (!result) {
              send(socket, {
                type: "error",
                error: "Unable to update message status.",
              });
              break;
            }

            const payload: MessageStatusPayload = {
              messageId,
              conversationId: result.after.conversationId,
              senderId: result.after.senderId,
              recipientId: result.after.recipientId,
              status,
              timestamp: result.timestamp.getTime(),
            };

            broadcastMessageStatus(payload);
            send(socket, { type: "message:status-ack", payload });
            break;
          }
          case "typing": {
            if (!peerId) {
              send(socket, { type: "error", error: "Handshake not completed." });
              return;
            }
            const recipientId =
              typeof data.recipientId === "string" ? data.recipientId.trim() : "";
            const rawState = data.state === "start" ? "start" : data.state === "stop" ? "stop" : null;
            if (!recipientId || !rawState) {
              send(socket, { type: "error", error: "Invalid typing payload." });
              return;
            }
            const timestamp =
              typeof data.timestamp === "number" ? data.timestamp : Date.now();
            const conversationId =
              typeof data.conversationId === "string" && data.conversationId.length > 0
                ? data.conversationId
                : createConversationId(peerId, recipientId);

            broadcastTyping({
              senderId: peerId,
              recipientId,
              conversationId,
              state: rawState,
              timestamp,
            });
            break;
          }
          case "ping": {
            send(socket, { type: "pong", ts: Date.now() });
            break;
          }
          default:
            send(socket, { type: "error", error: `Unknown event type "${type}"` });
            break;
        }
      } catch (error) {
        console.error("WebSocket message error", error);
        send(socket, { type: "error", error: "Malformed message payload." });
      }
    });

    socket.on("close", () => {
      if (peerId) {
        unregisterClient(peerId, socket);
      }
    });
  });

  wss.on("close", () => {
    registry = new Map();
  });
}

export function broadcastNewMessage(doc: MessageDocument & { _id?: ObjectId }): void {
  const apiMessage = toApiMessage(doc);
  emitToPeer(apiMessage.recipientId, { type: "message:new", payload: apiMessage });
  broadcastMessageStatus({
    messageId: apiMessage.id,
    conversationId: apiMessage.conversationId,
    senderId: apiMessage.senderId,
    recipientId: apiMessage.recipientId,
    status: "sent",
    timestamp: doc.createdAt.getTime(),
  });
}

export function broadcastSignal(signal: ApiSignal, excludePeerId?: string): void {
  if (excludePeerId !== signal.recipientId) {
    emitToPeer(signal.recipientId, { type: "signal", payload: signal });
  }
}

export function broadcastMessageStatus(payload: MessageStatusPayload): void {
  emitToPeer(payload.senderId, { type: "message:status-update", payload });
  emitToPeer(payload.recipientId, { type: "message:status-update", payload });
}

export function broadcastTyping(payload: TypingPayload): void {
  emitToPeer(payload.recipientId, { type: "typing", payload });
}

export function getConnectedPeerIds(): string[] {
  return Array.from(registry.keys());
}

function registerClient(peerId: string, socket: WebSocket) {
  const existing = registry.get(peerId);
  if (existing) {
    existing.add(socket);
  } else {
    registry.set(peerId, new Set([socket]));
  }
}

function unregisterClient(peerId: string, socket: WebSocket) {
  const existing = registry.get(peerId);
  if (!existing) {
    return;
  }
  existing.delete(socket);
  if (existing.size === 0) {
    registry.delete(peerId);
  }
}

function send(socket: WebSocket, message: OutboundEvent) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function emitToPeer(peerId: string, message: OutboundEvent) {
  const sockets = registry.get(peerId);
  if (!sockets) {
    return;
  }
  for (const socket of sockets.values()) {
    send(socket, message);
  }
}

async function handleSignalEvent(socket: WebSocket, data: Record<string, unknown>) {
  try {
    const { document, api } = await saveSignal({
      sessionId: typeof data.sessionId === "string" ? data.sessionId : null,
      senderId: typeof data.senderId === "string" ? data.senderId : null,
      recipientId: typeof data.recipientId === "string" ? data.recipientId : null,
      type: typeof data.signalType === "string" ? (data.signalType as string) : null,
      payload:
        data.payload && typeof data.payload === "object"
          ? (data.payload as Record<string, unknown>)
          : null,
    });

    // broadcast to recipient
    broadcastSignal(api, document.senderId);
    // acknowledge sender with stored copy
    send(socket, { type: "signal:ack", payload: api });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to persist signaling payload.";
    send(socket, { type: "error", error: message });
  }
}

function createConversationId(peerA: string, peerB: string): string {
  return [peerA.trim(), peerB.trim()].sort((left, right) => left.localeCompare(right)).join("#");
}
