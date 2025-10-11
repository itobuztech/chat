import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";

import type { ObjectId } from "mongodb";

import type { MessageDocument } from "../lib/mongoClient.js";
import type { ApiMessage, ApiSignal } from "../types/api.js";
import { toApiMessage } from "../utils/formatters.js";
import { saveSignal } from "../services/signalingService.js";

type ClientRegistry = Map<string, Set<WebSocket>>;

interface SignalOutbound {
  type: "signal";
  payload: ApiSignal;
}

interface MessageOutbound {
  type: "message:new" | "message:status";
  payload: ApiMessage;
}

interface ErrorOutbound {
  type: "error";
  error: string;
}

type OutboundEvent = SignalOutbound | MessageOutbound | ErrorOutbound | Record<string, unknown>;

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
            registerClient(peerId, socket);
            send(socket, { type: "hello:ack", peerId });
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
  emitToPeer(apiMessage.senderId, { type: "message:status", payload: apiMessage });
}

export function broadcastSignal(signal: ApiSignal, excludePeerId?: string): void {
  if (excludePeerId !== signal.recipientId) {
    emitToPeer(signal.recipientId, { type: "signal", payload: signal });
  }
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
