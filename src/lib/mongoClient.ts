import { MongoClient, type Collection, type Db, ObjectId } from "mongodb";

console.log("Mongo URI:", process.env.MONGO_URI);
const mongoUri = process.env.MONGO_URI ?? "mongodb://localhost:27017";
const databaseName = process.env.MONGO_DB ?? "p2p-chat";

const client = new MongoClient(mongoUri);
let dbPromise: Promise<Db> | null = null;
let messageIndexesInitialized = false;
let signalIndexesInitialized = false;
let groupIndexesInitialized = false;
let groupMessageIndexesInitialized = false;

export interface MessageDocument {
  _id?: ObjectId;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  createdAt: Date;
  delivered: boolean;
  read: boolean;
  replyTo?: {
    messageId: ObjectId;
    senderId: string;
    content: string;
    createdAt: Date;
  };
  reactions?: {
    [emoji: string]: {
      userIds: string[];
      count: number;
    };
  };
}

export type GroupMemberRole = "owner" | "admin" | "member";

export interface GroupMember {
  userId: string;
  role: GroupMemberRole;
  joinedAt: Date;
}

export interface GroupDocument {
  _id?: ObjectId;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  members: GroupMember[];
}

export interface GroupMessageDocument {
  _id?: ObjectId;
  groupId: string;
  senderId: string;
  content: string;
  createdAt: Date;
  replyTo?: {
    messageId: ObjectId;
    senderId: string;
    content: string;
    createdAt: Date;
  };
  reactions?: {
    [emoji: string]: {
      userIds: string[];
      count: number;
    };
  };
  readBy: Record<string, Date>;
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

export async function getGroupsCollection(): Promise<
  Collection<GroupDocument>
> {
  const db = await getDatabase();
  const collection = db.collection<GroupDocument>("groups");

  if (!groupIndexesInitialized) {
    await Promise.all([
      collection.createIndex({ "members.userId": 1 }),
      collection.createIndex({ createdBy: 1, createdAt: -1 }),
    ]);
    groupIndexesInitialized = true;
  }

  return collection;
}

export async function getGroupMessagesCollection(): Promise<
  Collection<GroupMessageDocument>
> {
  const db = await getDatabase();
  const collection = db.collection<GroupMessageDocument>("group_messages");

  if (!groupMessageIndexesInitialized) {
    await Promise.all([
      collection.createIndex({ groupId: 1, createdAt: -1 }),
    ]);
    groupMessageIndexesInitialized = true;
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
  groupIndexesInitialized = false;
  groupMessageIndexesInitialized = false;
}
