import { Router } from "express";
import { ObjectId as MongoObjectId } from "mongodb";

import {
  getSignalsCollection,
  type WebRTCSignalDocument,
  type WebRTCSignalType,
} from "../lib/mongoClient.js";

const router = Router();

const ALLOWED_SIGNAL_TYPES: ReadonlySet<WebRTCSignalType> = new Set([
  "offer",
  "answer",
  "candidate",
  "bye",
]);

router.get("/ice-config", (_req, res) => {
  const ttlSeconds = Number.parseInt(process.env.ICE_TTL_SECONDS ?? "3600", 10);
  const explicitConfig = process.env.ICE_SERVERS_JSON;

  if (explicitConfig) {
    try {
      const iceServers = JSON.parse(explicitConfig);
      return res.json({
        iceServers,
        ttlSeconds: Number.isNaN(ttlSeconds) ? 3600 : ttlSeconds,
        source: "custom",
      });
    } catch (error) {
      console.error("Failed to parse ICE_SERVERS_JSON", error);
      return res
        .status(500)
        .json({ error: "Invalid ICE_SERVERS_JSON configuration." });
    }
  }

  const host =
    process.env.TURN_HOST ??
    process.env.TURN_PUBLIC_IP ??
    process.env.TURN_REALM ??
    "localhost";
  const port = process.env.TURN_PORT ?? "3478";
  const username = (process.env.TURN_USERNAME ?? "turnuser")?.trim();
  const credential = (process.env.TURN_PASSWORD ?? "turnpassword")?.trim();

  const stunUrl = `stun:${host}:${port}`;
  const turnUrls = [
    `turn:${host}:${port}?transport=udp`,
    `turn:${host}:${port}?transport=tcp`,
  ];

  const iceServers = [
    { urls: [stunUrl] },
    ...(username && credential
      ? [{ urls: turnUrls, username, credential }]
      : [{ urls: turnUrls }]),
  ];

  return res.json({
    iceServers,
    ttlSeconds: Number.isNaN(ttlSeconds) ? 3600 : ttlSeconds,
    source: "default",
  });
});

router.post("/signals", async (req, res, next) => {
  try {
    const {
      sessionId,
      senderId,
      recipientId,
      type,
      payload,
    } = req.body as Partial<WebRTCSignalDocument>;

    if (!sessionId || !senderId || !recipientId || !type) {
      return res.status(400).json({
        error: "sessionId, senderId, recipientId and type are required.",
      });
    }

    if (!ALLOWED_SIGNAL_TYPES.has(type)) {
      return res.status(400).json({
        error: `Unsupported signal type "${type}".`,
      });
    }

    const trimmedSessionId = sessionId.trim();
    const trimmedSenderId = senderId.trim();
    const trimmedRecipientId = recipientId.trim();

    if (!trimmedSessionId || !trimmedSenderId || !trimmedRecipientId) {
      return res.status(400).json({
        error: "sessionId, senderId and recipientId cannot be empty.",
      });
    }

    const normalizedPayload =
      type === "bye"
        ? null
        : payload && typeof payload === "object"
          ? (payload as Record<string, unknown>)
          : null;

    if (type !== "bye" && !normalizedPayload) {
      return res.status(400).json({
        error: "Signals (except bye) require a payload object.",
      });
    }

    const signals = await getSignalsCollection();
    const timestamp = new Date();
    const signal: WebRTCSignalDocument = {
      sessionId: trimmedSessionId,
      senderId: trimmedSenderId,
      recipientId: trimmedRecipientId,
      type,
      payload: normalizedPayload,
      createdAt: timestamp,
      consumed: false,
    };

    const result = await signals.insertOne(signal);

    return res.status(201).json({
      signal: formatSignal({ ...signal, _id: result.insertedId }),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/signals/pending/:recipientId", async (req, res, next) => {
  try {
    const { recipientId } = req.params;
    if (!recipientId) {
      return res
        .status(400)
        .json({ error: "recipientId parameter is required." });
    }

    const sessionFilter =
      typeof req.query.sessionId === "string" ? req.query.sessionId.trim() : "";

    const signals = await getSignalsCollection();
    const query = {
      recipientId: recipientId.trim(),
      consumed: false,
      ...(sessionFilter ? { sessionId: sessionFilter } : {}),
    };

    const pendingSignals = await signals
      .find(query, { sort: { createdAt: 1 }, limit: 100 })
      .toArray();

    if (pendingSignals.length === 0) {
      return res.json({ signals: [] });
    }

    const ids = pendingSignals
      .map((doc) => doc._id)
      .filter(Boolean) as MongoObjectId[];

    await signals.updateMany(
      { _id: { $in: ids } },
      { $set: { consumed: true, consumedAt: new Date() } },
    );

    return res.json({
      signals: pendingSignals.map((doc) => formatSignal(doc)),
    });
  } catch (error) {
    next(error);
  }
});

function formatSignal(doc: WebRTCSignalDocument) {
  return {
    id: doc._id?.toString() ?? "",
    sessionId: doc.sessionId,
    senderId: doc.senderId,
    recipientId: doc.recipientId,
    type: doc.type,
    payload: doc.payload,
    createdAt: doc.createdAt.toISOString(),
    consumed: doc.consumed,
    consumedAt: doc.consumedAt?.toISOString(),
  };
}

export default router;
