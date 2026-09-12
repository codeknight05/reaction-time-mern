# Reaction Time F1 – MERN

A Formula 1–inspired reaction-time game built with the MERN stack. Players tap as soon as the start lights go out, compete over multiple attempts, and see global standings on a live leaderboard.

## Tech Stack

- **Frontend**: React (Vite), CSS
- **Backend**: Node.js, Express, Mongoose
- **Database**: MongoDB Atlas
- **Build/Runtime**: npm

---

## Features

- **F1-style start sequence**  
  Five red lights sequence on, then go out after a random delay (1–3s). Your tap time is measured from “GO!”.

- **Solo & Multiplayer modes**  
  - Solo: one driver, multiple attempts.  
  - Multiplayer: multiple drivers take turns; each gets a fixed number of attempts.

- **Online Multiplayer (cross-device rooms)**  
  - Create or join a room using a 6-character code.  
  - Host can start when at least 2 players are in lobby and can kick players before start.  
  - Match runs in synced rounds (5 attempts per player) with randomized GO timing each round.  
  - Live room status shows who has tapped, attempts completed, and current best times.  
  - Prevents duplicate same-name joins from the same IP in the same room.  
  - Final winner is the fastest best reaction; results are saved to game history and leaderboard.
- **Global leaderboard**  
  - Stores best time per player name.  
  - Returning players update their **existing** entry when they set a better time.  
  - Standings panel shows the top 10 fastest drivers.

- **Persistent names per device**  
  Player names are remembered locally so returning users don’t have to retype them.

---

## Live Arena: real-time cursor and reaction sync

The **Live Arena** button opens a shared room backed by a raw WebSocket connection. Enter the same room code in 3–5 browser tabs or devices, then move and click in the field. Cursor movement and emoji reactions are visible to every participant, and the right rail shows current presence.

### Setup

1. Start the backend: `cd backend && npm install && npm start`
2. Start the frontend in another terminal: `cd frontend && npm install && npm run dev`
3. Open the Vite URL (normally `http://localhost:5173`) in multiple tabs.
4. Enter a name and the same room code, then choose **Live Arena**.

The backend uses the existing Express HTTP server plus a hand-written WebSocket upgrade and frame parser. No Socket.IO, `ws`, or state synchronization library is used. The production frontend can point at the backend with `VITE_API_BASE_URL`; for local development Vite should be configured to proxy or the browser should use the backend URL directly.

### Protocol

Messages are newline-free JSON WebSocket text frames. Client messages are:

- `hello`: `{ type, clientId, name }`. Authenticates a room presence identity and is also the reconnect identity.
- `cursor`: `{ type, seq, x, y }`. `x` and `y` are normalized numbers in `[0, 1]`; the client sends at most 20 per second.
- `reaction`: `{ type, seq, x, y, emoji }`. A discrete click event with normalized coordinates.

Server messages are:

- `snapshot`: `{ type, selfId, clients }`, sent once after `hello`; it gives a joining client the current room state.
- `presence`: `{ type, action, clientId, client? }`, sent when a participant joins or leaves.
- `cursor`: `{ type, clientId, seq, x, y }`, relayed to every other client.
- `reaction`: `{ type, clientId, seq, x, y, emoji }`, relayed to every client including the sender so local and remote rendering use the same event path.

The browser validates every incoming message in `frontend/src/arena/protocol.ts`; the server validates every incoming message before it can mutate room state. Unknown, malformed, oversized, or unmasked client frames are rejected. Cursor sequence numbers are monotonic per client, so stale or reordered cursor messages are discarded by both server and client. Reactions are events rather than durable state and are intentionally not replayed.

### Throttling and interpolation

Pointer events are sampled at 50 ms (20 Hz), rather than sending every browser `pointermove` event. This keeps bandwidth predictable while remaining responsive for a cursor field. The server stores only each participant’s latest normalized position and sequence number.

Remote cursors keep a two-sample buffer. The renderer draws 100 ms behind the newest received sample and linearly interpolates between those two samples. This adds an estimated 100 ms of visual latency, plus network latency, but absorbs ordinary packet jitter and avoids visible teleporting. A delayed or missing packet holds the last position until the next sample arrives; the buffer is bounded and never grows with session history. The local cursor is updated immediately.

### Failure handling and limitations

- The server sends raw WebSocket ping frames every 15 seconds and removes clients that fail to answer on the next heartbeat, so dropped tabs do not leave permanent cursors.
- The client reconnects with the same local `clientId` using exponential backoff. A reconnect replaces the old socket for that identity, receives a fresh snapshot, and does not duplicate the cursor.
- The identity is stored in tab-scoped `sessionStorage`, so multiple tabs are separate participants while a reload in the same tab resumes the same identity.
- Closing a tab triggers the normal WebSocket close path; network loss is handled by heartbeat cleanup and the client’s reconnect loop.
- Rooms are in-memory only: a server restart loses presence, there is no authentication, no persistence, and no horizontal scaling. A multi-instance deployment would need a shared room/pub-sub layer and sticky or coordinated connection routing.
- This is intentionally sized for approximately 3–10 clients per room, not a distributed production presence service. Reactions are not stored or replayed to late joiners.

### Time and tools

Estimated implementation time: approximately 4 hours for the sync engine, demo UI, validation, and documentation. AI assistance was used to inspect the existing project, draft the raw protocol/server/client implementation, and review the integration; the final code and tradeoffs should be explainable from the files in this repository.


