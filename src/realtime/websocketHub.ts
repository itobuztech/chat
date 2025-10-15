import type { Server as HttpServer } from "http";
import type { ObjectId } from "mongodb";
import { WebSocketServer, WebSocket } from "ws";

import type { MessageDocument } from "../lib/mongoClient";
import { saveSignal } from "../services/signalingService";
import type { ApiMessage, ApiSignal } from "../types/api";
import { toApiMessage } from "../utils/formatters";

type ClientRegistry = Map<string, Set<WebSocket>>;

type TypingState = "start" | "stop";
type PresenceStatus = "online" | "away" | "offline";

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

interface PresencePayload {
  peerId: string;
  status: PresenceStatus;
  timestamp: number;
}

interface PresenceUpdateOutbound {
  type: "presence:update";
  payload: PresencePayload;
}

interface PresenceSyncOutbound {
  type: "presence:sync";
  payload: PresencePayload[];
}

interface ErrorOutbound {
  type: "error";
  error: string;
}

type OutboundEvent =
  | SignalOutbound
  | MessageOutbound
  | TypingOutbound
  | PresenceUpdateOutbound
  | PresenceSyncOutbound
  | ErrorOutbound
  | Record<string, unknown>;

let registry: ClientRegistry = new Map();
let wss: WebSocketServer | null = null;

interface PresenceInfo {
  status: PresenceStatus;
  updatedAt: number;
}

const presenceMap: Map<string, PresenceInfo> = new Map();

function serializePresence(): PresencePayload[] {
  return Array.from(presenceMap.entries()).map(([peerId, info]) => ({
    peerId,
    status: info.status,
    timestamp: info.updatedAt,
  }));
}

function emitToAll(message: OutboundEvent, exclude?: WebSocket) {
  for (const sockets of registry.values()) {
    for (const socket of sockets.values()) {
      if (socket !== exclude) {
        send(socket, message);
      }
    }
  }
}

function updatePresence(peerId: string, status: PresenceStatus, options?: { notify?: boolean; exclude?: WebSocket }) {
  const timestamp = Date.now();
  presenceMap.set(peerId, { status, updatedAt: timestamp });
  if (options?.notify !== false) {
    emitToAll(
      {
        type: "presence:update",
        payload: { peerId, status, timestamp },
      },
      options?.exclude,
    );
  }
}

export function getPresenceStatus(peerId: string): PresenceStatus {
  return presenceMap.get(peerId)?.status ?? "offline";
}

export function getPresenceSnapshot(): Record<string, PresenceStatus> {
  const snapshot: Record<string, PresenceStatus> = {};
  for (const [peerId, info] of presenceMap.entries()) {
    snapshot[peerId] = info.status;
  }
  return snapshot;
}


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

            updatePresence(incomingPeer, "online", { notify: false });
            send(socket, { type: "hello:ack", peerId: incomingPeer });
            send(socket, {
              type: "presence:sync",
              payload: serializePresence(),
            });
            updatePresence(incomingPeer, "online", { exclude: socket });
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
          case "presence": {
            if (!peerId) {
              send(socket, { type: "error", error: "Handshake not completed." });
              return;
            }
            const status =
              data.status === "online"
                ? "online"
                : data.status === "away"
                  ? "away"
                  : null;
            if (!status) {
              send(socket, { type: "error", error: "Invalid presence payload." });
              break;
            }
            updatePresence(peerId, status);
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
        updatePresence(peerId, "offline");
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
}

export function broadcastSignal(signal: ApiSignal, excludePeerId?: string): void {
  if (excludePeerId !== signal.recipientId) {
    emitToPeer(signal.recipientId, { type: "signal", payload: signal });
  }
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
