# Live Arena Architecture

## Data flow

```text
Canvas pointer events
        |
        v
LiveArena UI  --20 Hz-->  native WebSocket transport  -->  HTTP upgrade server
   ^                              ^                              |
   |                              |                              v
Canvas renderer  <--validated messages--  protocol parser  <--  room state
```

## Boundaries

- `frontend/src/arena/protocol.ts` defines the client/server message unions and validates all incoming JSON before it reaches React state.
- `frontend/src/components/LiveArena.jsx` owns the browser WebSocket lifecycle, reconnect backoff, bounded cursor samples, and canvas/UI rendering.
- `backend/server.js` owns the raw RFC 6455 upgrade, masked-frame parser, runtime message validation, in-memory room presence, latest cursor state, fan-out, and ping/pong liveness.
- The server stores only the latest position and sequence number for each participant. Reaction events are relayed but not persisted.

## Reconciliation model

Cursor positions use normalized coordinates and monotonically increasing client sequence numbers. The server drops stale cursor sequences and excludes the sender from cursor broadcasts. The client maintains at most two samples per remote cursor and renders 100 ms behind the newest sample using linear interpolation. This trades approximately 100 ms of visual latency for smoother motion under jitter without unbounded history.

A new client receives a `snapshot` containing every current participant and their latest position. A reconnect uses the same tab-scoped identity; the server replaces any old socket with that identity and sends a fresh snapshot.

## Failure model

The server sends a ping every 15 seconds. A client that fails to answer the next heartbeat is destroyed and its `presence/leave` message is broadcast. Normal close/error events use the same cleanup path. The client reconnects with exponential backoff and returns to the room without duplicating its participant.

Malformed JSON, unknown message types, invalid coordinates/sequences, oversized payloads, unsupported frame flags/opcodes, and unmasked client frames are rejected. The room process is intentionally single-instance and in-memory; MongoDB is unrelated to Live Arena and optional for this demo.
