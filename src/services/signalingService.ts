import {
  WebRTCSignalType,
  getSignalsCollection,
  WebRTCSignalDocument,
} from "../lib/mongoClient";
import type { ApiSignal } from "../types/api";
import { toApiSignal } from "../utils/formatters";

const ALLOWED_SIGNAL_TYPES: ReadonlySet<WebRTCSignalType> = new Set([
  "offer",
  "answer",
  "candidate",
  "bye",
]);

export interface SignalInput {
  sessionId?: string | null;
  senderId?: string | null;
  recipientId?: string | null;
  type?: WebRTCSignalType | string | null;
  payload?: Record<string, unknown> | null;
}

export async function saveSignal(input: SignalInput): Promise<{
  document: WebRTCSignalDocument;
  api: ApiSignal;
}> {
  const sessionId = input.sessionId?.trim() ?? "";
  const senderId = input.senderId?.trim() ?? "";
  const recipientId = input.recipientId?.trim() ?? "";
  const type = input.type as WebRTCSignalType | undefined;

  if (!sessionId || !senderId || !recipientId || !type) {
    throw new Error("sessionId, senderId, recipientId and type are required.");
  }

  if (!ALLOWED_SIGNAL_TYPES.has(type)) {
    throw new Error(`Unsupported signal type "${type}".`);
  }

  const normalizedPayload =
    type === "bye"
      ? null
      : input.payload && typeof input.payload === "object"
        ? input.payload
        : null;

  if (type !== "bye" && !normalizedPayload) {
    throw new Error("Signals (except bye) require a payload object.");
  }

  const signals = await getSignalsCollection();
  const signalDoc: WebRTCSignalDocument = {
    sessionId,
    senderId,
    recipientId,
    type,
    payload: normalizedPayload,
    createdAt: new Date(),
    consumed: false,
  };

  const result = await signals.insertOne(signalDoc);
  const storedDoc: WebRTCSignalDocument = {
    ...signalDoc,
    _id: result.insertedId,
  };

  return {
    document: storedDoc,
    api: toApiSignal(storedDoc),
  };
}

export function isValidSignalType(type: string): type is WebRTCSignalType {
  return ALLOWED_SIGNAL_TYPES.has(type as WebRTCSignalType);
}
