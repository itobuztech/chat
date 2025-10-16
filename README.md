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

Set `VITE_API_BASE_URL` in a `.env` file under `webapp/` to point the client to your signaling API (defaults to `http://localhost:3000`). The default page:
- Loads historical messages via the REST API.
- Opens a WebSocket connection (`ws://<host>/ws`) for signaling and live message delivery.
- Establishes a WebRTC data channel (using the TURN server) so new texts flow peer-to-peer in real time, falling back to server delivery if the peer is offline.
- Surfaces live typing indicators that travel over WebRTC when available (and fall back to WebSocket events).

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
- `PATCH /api/messages/:messageId/status`  
  Update a message lifecycle state (`delivered` or `read`). The frontend uses this in combination with WebRTC/WebSocket signaling so every status change is persisted even if the peer is temporarily offline.

Messages are persisted in MongoDB so offline peers can retrieve them when they come back. A WebSocket push delivers new messages instantly when recipients are connected.
Each message keeps track of `sent`, `delivered`, and `read` timestamps—updates flow over WebRTC when possible, falling back to the WebSocket channel and stored in MongoDB.

## Group Chat API
Group conversations persist to a dedicated `groups` collection. The first iteration exposes lifecycle endpoints that the frontend can call as the UI lands:

- `POST /api/groups`  
  Create a group. Body:
  ```json
  {
    "name": "Weekend Riders",
    "creatorId": "alice",
    "memberIds": ["bob", "charlie"], // optional, creator becomes owner automatically
    "description": "Route planning and shared photos"
  }
  ```
  Responds with the stored group and the membership roster.

- `GET /api/groups?memberId=alice`  
  List groups, optionally filtered to those that include a specific user id.

- `GET /api/groups/<groupId>`  
  Fetch details and membership for a single group.

- `POST /api/groups/<groupId>/members`  
  Add one or more members. Body:
  ```json
  {
    "requesterId": "alice",
    "userIds": ["dave", "erin"]
  }
  ```
  Only owners and admins may add new members.

- `DELETE /api/groups/<groupId>/members`  
  Remove members. Body:
  ```json
  {
    "requesterId": "alice",
    "userIds": ["bob"]
  }
  ```
  Owners can remove any non-owner; admins can remove members (not other admins or the owner).

- `POST /api/group-messages`  
  Persist a new message in the group timeline and fan it out over WebRTC/WebSocket. Body:
  ```json
  {
    "groupId": "<groupId>",
    "senderId": "alice",
    "content": "Who's up for a Sunday ride?",
    "replyToId": "<optional message id>"
  }
  ```
  The response includes `readBy` metadata keyed by user id.

- `GET /api/group-messages/<groupId>?limit=50&before=<messageId>`  
  Paginate through a group's history, returning messages sorted oldest → newest.

- `POST /api/group-messages/<messageId>/read`  
  Record that a participant has read the message; broadcasts the updated `readBy` map.

- `POST|DELETE /api/group-messages/<messageId>/reactions`  
  Add or remove emoji reactions. Payload: `{ "emoji": "👍", "userId": "bob" }`.

Environment variables:
- `MONGO_URI` (default `mongodb://localhost:27017`) – connection string.
- `MONGO_DB` (default `p2p-chat`) – database name.
- `CORS_ALLOW_ORIGINS` – optional comma-separated list of allowed origins for HTTP requests (defaults to permitting all origins).
- `TURN_HOST` (default resolves to `TURN_PUBLIC_IP`, realm, or `localhost`) – hostname advertised to clients for TURN/STUN.
- `TURN_PORT` (default `3478`) – listening port exposed for TURN/STUN.
- `TURN_USERNAME` / `TURN_PASSWORD` / `TURN_REALM` / `TURN_PUBLIC_IP` – credentials surfaced to WebRTC clients. (Public IP is optional but recommended outside localhost.)
- `ICE_SERVERS_JSON` – optional JSON array override for the ICE server list returned to clients.
- `ICE_TTL_SECONDS` (default `3600`) – TTL hint for the ICE configuration response.

## WebRTC Signaling API
WebRTC negotiation is handled via the `/api/webrtc/*` endpoints:

- `GET /api/webrtc/ice-config` – Returns the TURN/STUN list advertised to browsers.
- `POST /api/webrtc/signals` – Queues offers, answers, candidates, and bye messages between peers.
- `GET /api/webrtc/signals/pending/:recipientId?sessionId=<id>` – Retrieves and consumes pending signaling payloads.

The frontend automatically negotiates a data channel using these endpoints; messages are persisted through the REST messaging API but delivered live over WebRTC once the connection is established.

## Linting
Run the linter to catch common issues:
```bash
npm run lint
```
