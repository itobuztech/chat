import express, { Request, Response } from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json());

app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Hello from Express + TypeScript!" });
});

app.listen(port, () => {
  const host = process.env.HOST ?? "localhost";
  // Log a friendly startup message so it's easy to tell the server is running.
  console.log(`Server listening at http://${host}:${port}`);
});
