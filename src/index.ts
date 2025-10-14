import "dotenv/config";

import { createServer } from "http";

import cors from "cors";
import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from "express";

import { closeDatabase, connectToDatabase } from "./lib/mongoClient";
import { initializeWebSocketServer } from "./realtime/websocketHub";
import messagesRouter from "./routes/messages";
import webrtcRouter from "./routes/webrtc";

const app = express();
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

await connectToDatabase();

const allowedOrigins = process.env.CORS_ALLOW_ORIGINS?.split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

app.use(
  cors({
    origin: allowedOrigins && allowedOrigins.length > 0 ? allowedOrigins : true,
  }),
);

app.use(express.json());

app.get("/", (_req: Request, res: Response) => {
  res.json({ status: "ok", message: "P2P chat signaling server running." });
});

app.use("/api/messages", messagesRouter);
app.use("/api/webrtc", webrtcRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res) => {
  console.error(err);
  const statusCode =
    typeof err?.status === "number" ? err.status : Number(err?.statusCode);
  res
    .status(Number.isInteger(statusCode) ? Number(statusCode) : 500)
    .json({ error: "Internal server error" });
};

app.use(errorHandler);

const httpServer = createServer(app);
initializeWebSocketServer(httpServer);

httpServer.listen(port, () => {
  const host = process.env.HOST ?? "localhost";
  console.log(`Server listening at http://${host}:${port}`);
});

async function shutdown() {
  console.log("Shutting down gracefully...");
  await closeDatabase().catch((error) => {
    console.error("Failed to close database connection", error);
  });
  httpServer.close(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
