# P2P Chat Express App

Minimal Express server bootstrapped with TypeScript.

## Prerequisites
- Node.js 18+ (ships with npm)

## Supporting Services (Docker)
This project ships with a `docker-compose.yml` that starts:
- `coturn`: TURN/STUN server for real-time communication.
- `mongodb`: database used by the backend.

To run the services:
```bash
docker compose up -d
```

Override sensitive defaults by exporting environment variables or creating a `.env` file alongside the compose file:
```bash
export TURN_USERNAME="turnuser"
export TURN_PASSWORD="strongSecret"
export TURN_REALM="p2p-chat.example"
export TURN_PUBLIC_IP="203.0.113.10" # optional, set if behind NAT
export MONGO_ROOT_USERNAME="mongo"
export MONGO_ROOT_PASSWORD="mongoPassword123"
docker compose up -d
```

Backend connection details:
- TURN server: `turn:${TURN_USERNAME}:${TURN_PASSWORD}@localhost:3478?transport=udp`
- MongoDB URI: `mongodb://${MONGO_ROOT_USERNAME}:${MONGO_ROOT_PASSWORD}@localhost:27017`

If you later move the backend into Docker, point it at the service names (`coturn` and `mongodb`) on the default compose network.

## Getting Started
1. Install dependencies:
   ```bash
   npm install
   ```
2. Start in development mode (auto-restarts on changes):
   ```bash
   npm run dev
   ```
3. Build and run production bundle:
   ```bash
   npm run build
   npm start
   ```

The server listens on `http://localhost:3000` by default. Adjust the port via the `PORT` environment variable.

## Web Frontend (Vite + React)
The `webapp` directory contains a Vite-powered React client scaffold.

```bash
cd webapp
npm install
npm run dev
```

Set `VITE_API_BASE_URL` in a `.env` file under `webapp/` to point the client to your signaling API (defaults to `http://localhost:3000`). The default page includes a lightweight chat interface that uses the messaging API to poll and post messages between two peer identifiers.

## Messaging API
The Express server exposes lightweight REST APIs that act as the WebRTC signaling and persistence layer for peer messages.

- `POST /api/messages`  
  Send a message to another peer. Body:
  ```json
  {
    "senderId": "alice",
    "recipientId": "bob",
    "content": "Hello via WebRTC!"
  }
  ```
  Stores the message and returns the created record.

- `GET /api/messages/conversation?peerA=alice&peerB=bob&limit=50&before=<messageId>`  
  Fetch ordered history between two peers. `limit` (default 50, max 200) paginates, `before` provides a cursor using a previous message id.

- `GET /api/messages/pending/:recipientId?after=<messageId>`  
  Retrieve undelivered messages for a peer; results are marked as delivered automatically. Optionally pass `after` to only receive items newer than a specific message.

Environment variables:
- `MONGO_URI` (default `mongodb://localhost:27017`) – connection string.
- `MONGO_DB` (default `p2p-chat`) – database name.
- `CORS_ALLOW_ORIGINS` – optional comma-separated list of allowed origins for HTTP requests (defaults to permitting all origins).

## Linting
Run the linter to catch common issues:
```bash
npm run lint
```
