import { MongoClient, type Collection, type Db, ObjectId } from "mongodb";

console.log("Mongo URI:", process.env.MONGO_URI);
const mongoUri = process.env.MONGO_URI ?? "mongodb://localhost:27017";
const databaseName = process.env.MONGO_DB ?? "p2p-chat";

const client = new MongoClient(mongoUri);
let dbPromise: Promise<Db> | null = null;
let messageIndexesInitialized = false;
let signalIndexesInitialized = false;

export interface MessageDocument {
  _id?: ObjectId;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  createdAt: Date;
  delivered: boolean;
  deliveredAt?: Date;
  read: boolean;
  readAt?: Date;
  replyTo?: {
    messageId: ObjectId;
    senderId: string;
    content: string;
    createdAt: Date;
  };
}

export type WebRTCSignalType = "offer" | "answer" | "candidate" | "bye";

export interface WebRTCSignalDocument {
  _id?: ObjectId;
  sessionId: string;
  senderId: string;
  recipientId: string;
  type: WebRTCSignalType;
  payload: Record<string, unknown> | null;
  createdAt: Date;
  consumed: boolean;
  consumedAt?: Date;
}

async function getDatabase(): Promise<Db> {
  if (!dbPromise) {
    dbPromise = client.connect().then((connectedClient) => {
      return connectedClient.db(databaseName);
    });
  }

  return dbPromise;
}

export async function getMessagesCollection(): Promise<Collection<MessageDocument>> {
  const db = await getDatabase();
  const collection = db.collection<MessageDocument>("messages");

  if (!messageIndexesInitialized) {
    await Promise.all([
      collection.createIndex({ conversationId: 1, createdAt: -1 }),
      collection.createIndex({ recipientId: 1, delivered: 1, createdAt: 1 }),
    ]);
    messageIndexesInitialized = true;
  }

  return collection;
}

export async function getSignalsCollection(): Promise<
  Collection<WebRTCSignalDocument>
> {
  const db = await getDatabase();
  const collection = db.collection<WebRTCSignalDocument>("webrtc_signals");

  if (!signalIndexesInitialized) {
    await Promise.all([
      collection.createIndex({ recipientId: 1, consumed: 1, createdAt: 1 }),
      collection.createIndex({ sessionId: 1, createdAt: 1 }),
      collection.createIndex({ senderId: 1, createdAt: 1 }),
    ]);
    signalIndexesInitialized = true;
  }

  return collection;
}

export async function connectToDatabase(): Promise<void> {
  await getDatabase();
}

export async function closeDatabase(): Promise<void> {
  await client.close();
  dbPromise = null;
  messageIndexesInitialized = false;
  signalIndexesInitialized = false;
}
