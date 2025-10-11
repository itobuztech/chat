import { MongoClient, type Collection, type Db, ObjectId } from "mongodb";

const mongoUri = process.env.MONGO_URI ?? "mongodb://mongo:mongoPassword123@localhost:27017/";
const databaseName = process.env.MONGO_DB ?? "p2p-chat";

const client = new MongoClient(mongoUri);
let dbPromise: Promise<Db> | null = null;
let indexesInitialized = false;

export interface MessageDocument {
  _id?: ObjectId;
  conversationId: string;
  senderId: string;
  recipientId: string;
  content: string;
  createdAt: Date;
  delivered: boolean;
  deliveredAt?: Date;
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

  if (!indexesInitialized) {
    await Promise.all([
      collection.createIndex({ conversationId: 1, createdAt: -1 }),
      collection.createIndex({ recipientId: 1, delivered: 1, createdAt: 1 }),
    ]);
    indexesInitialized = true;
  }

  return collection;
}

export async function connectToDatabase(): Promise<void> {
  await getDatabase();
}

export async function closeDatabase(): Promise<void> {
  await client.close();
  dbPromise = null;
  indexesInitialized = false;
}
