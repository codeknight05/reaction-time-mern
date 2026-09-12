import dns from "dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import http from "http";
import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import { createHash, randomUUID } from "crypto";
import Game from "./models/Game.js";
import Leaderboard from "./models/Leaderboard.js";

const app = express();
app.use(cors());
app.use(express.json());

const ATTEMPTS = 5;
const onlineSessions = new Map();
const arenaRooms = new Map();
const ARENA_MAX_MESSAGE_BYTES = 4096;

const arenaRoom = (roomId) => {
    const key = String(roomId || "main").trim().slice(0, 32) || "main";
    let room = arenaRooms.get(key);
    if (!room) {
        room = { id: key, clients: new Map() };
        arenaRooms.set(key, room);
    }
    return room;
};

const arenaPublicClient = (client) => ({
    id: client.id,
    name: client.name,
    x: client.x,
    y: client.y,
    color: client.color,
    cursorSeq: client.cursorSeq
});

const arenaColors = ["#ffcf56", "#69e2ff", "#ff7b91", "#9dff8a", "#c6a7ff", "#ff9f5a"];
const arenaColorFor = (id) => arenaColors[Number.parseInt(id.slice(-2), 16) % arenaColors.length];
const isFiniteUnit = (value) => Number.isFinite(value) && value >= 0 && value <= 1;

const arenaMessage = (value) => {
    if (!value || typeof value !== "object" || typeof value.type !== "string") return null;
    if (value.type === "hello") {
        if (typeof value.clientId !== "string" || value.clientId.length > 80) return null;
        if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 32) return null;
        return { type: "hello", clientId: value.clientId, name: value.name.trim() };
    }
    if (value.type === "cursor") {
        if (!Number.isInteger(value.seq) || value.seq < 0 || !isFiniteUnit(value.x) || !isFiniteUnit(value.y)) return null;
        return { type: "cursor", seq: value.seq, x: value.x, y: value.y };
    }
    if (value.type === "reaction") {
        if (!Number.isInteger(value.seq) || value.seq < 0 || !isFiniteUnit(value.x) || !isFiniteUnit(value.y)) return null;
        if (typeof value.emoji !== "string" || value.emoji.length > 8) return null;
        return { type: "reaction", seq: value.seq, x: value.x, y: value.y, emoji: value.emoji };
    }
    return null;
};

const arenaFrame = (payload) => {
    const length = payload.length;
    if (length >= 126) {
        const frame = Buffer.alloc(length < 65536 ? 4 + length : 10 + length);
        frame[0] = 0x81;
        if (length < 65536) {
            frame[1] = 126;
            frame.writeUInt16BE(length, 2);
            payload.copy(frame, 4);
        } else {
            frame[1] = 127;
            frame.writeBigUInt64BE(BigInt(length), 2);
            payload.copy(frame, 10);
        }
        return frame;
    }
    return Buffer.concat([Buffer.from([0x81, length]), payload]);
};

const arenaSend = (socket, value) => {
    if (!socket.destroyed) socket.write(arenaFrame(Buffer.from(JSON.stringify(value))));
};

const arenaBroadcast = (room, value, exceptId = null) => {
    room.clients.forEach((client) => {
        if (client.id !== exceptId && client.ready) arenaSend(client.socket, value);
    });
};

const arenaRemove = (room, client, announce = true) => {
    if (room.clients.get(client.id) !== client) return;
    room.clients.delete(client.id);
    if (announce) arenaBroadcast(room, { type: "presence", action: "leave", clientId: client.id });
    if (room.clients.size === 0) arenaRooms.delete(room.id);
};

const arenaHandle = (room, client, raw) => {
    let parsed;
    try { parsed = JSON.parse(raw.toString("utf8")); } catch { return false; }
    const message = arenaMessage(parsed);
    if (!message) return false;
    if (message.type === "hello") {
        if (client.ready) return true;
        const previous = room.clients.get(message.clientId);
        if (previous && previous !== client) arenaRemove(room, previous, false);
        client.id = message.clientId;
        client.name = message.name;
        client.color = client.color || arenaColorFor(client.id);
        client.ready = true;
        room.clients.set(client.id, client);
        arenaSend(client.socket, { type: "snapshot", selfId: client.id, clients: [...room.clients.values()].map(arenaPublicClient) });
        arenaBroadcast(room, { type: "presence", action: "join", client: arenaPublicClient(client) }, client.id);
        return true;
    }
    if (!client.ready) return false;
    if (message.type === "cursor") {
        if (message.seq <= client.cursorSeq) return true;
        client.cursorSeq = message.seq;
        client.x = message.x;
        client.y = message.y;
        arenaBroadcast(room, { type: "cursor", clientId: client.id, seq: message.seq, x: message.x, y: message.y }, client.id);
        return true;
    }
    arenaBroadcast(room, { type: "reaction", clientId: client.id, seq: message.seq, x: message.x, y: message.y, emoji: message.emoji });
    return true;
};

const arenaParseFrames = (client, chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    while (client.buffer.length >= 2) {
        const second = client.buffer[1];
        const first = client.buffer[0];
        const opcode = first & 0x0f;
        const masked = (second & 0x80) !== 0;
        const isControlFrame = opcode === 0x8 || opcode === 0x9 || opcode === 0xA;
        if ((first & 0x70) !== 0 || (first & 0x80) === 0 || (![0x1, 0x8, 0x9, 0xA].includes(opcode))) return false;
        let offset = 2;
        let length = second & 0x7f;
        if (length === 126) {
            if (client.buffer.length < 4) return true;
            length = client.buffer.readUInt16BE(2); offset = 4;
        } else if (length === 127) {
            if (client.buffer.length < 10) return true;
            const largeLength = client.buffer.readBigUInt64BE(2);
            if (largeLength > BigInt(ARENA_MAX_MESSAGE_BYTES)) return false;
            length = Number(largeLength); offset = 10;
        }
        if (!masked || length > ARENA_MAX_MESSAGE_BYTES || (isControlFrame && (length > 125 || (second & 0x7f) >= 126))) return false;
        if (client.buffer.length < offset + 4 + length) return true;
        const mask = client.buffer.subarray(offset, offset + 4);
        offset += 4;
        const payload = Buffer.alloc(length);
        for (let index = 0; index < length; index += 1) payload[index] = client.buffer[offset + index] ^ mask[index % 4];
        client.buffer = client.buffer.subarray(offset + length);
        if (opcode === 0x8) return false;
        if (opcode === 0xA) {
            client.alive = true;
            continue;
        }
        if (opcode === 0x9) client.socket.write(Buffer.from([0x8a, payload.length, ...payload]));
        else if (opcode === 0x1 && !arenaHandle(client.room, client, payload)) return false;
    }
    return true;
};

const handleArenaUpgrade = (request, socket) => {
    const key = request.headers["sec-websocket-key"];
    const url = new URL(request.url, "http://localhost");
    if (!key || url.pathname !== "/ws/arena") return false;
    const room = arenaRoom(url.searchParams.get("room"));
    const accept = createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const client = { id: "", name: "", color: "", x: 0.5, y: 0.5, cursorSeq: -1, ready: false, alive: true, room, socket, buffer: Buffer.alloc(0) };
    socket.on("data", (chunk) => {
        if (!arenaParseFrames(client, chunk)) socket.destroy();
    });
    socket.on("close", () => arenaRemove(room, client));
    socket.on("error", () => arenaRemove(room, client));
    return true;
};

const normalizeName = (n) => (n && String(n).trim()) || "";
const nameKey = (n) => normalizeName(n).toUpperCase();

const sanitizePlayers = (players = []) =>
    players.map((player) => {
        const attempts = Array.isArray(player.attempts)
            ? player.attempts.map((t) => Number(t)).filter((t) => Number.isFinite(t) && t >= 0)
            : [];
        const best = Number(player.bestTime);
        const bestTime = Number.isFinite(best)
            ? best
            : (attempts.length > 0 ? Math.min(...attempts) : Infinity);
        return {
            name: normalizeName(player.name),
            attempts,
            bestTime
        };
    }).filter((p) => p.name);

const buildWinner = (players = []) => {
    const valid = players.filter((p) => Number.isFinite(Number(p.bestTime)));
    if (valid.length === 0) return null;
    return valid.reduce((best, p) => (Number(p.bestTime) < Number(best.bestTime) ? p : best), valid[0]);
};

const createDelayMs = () => 3500 + Math.floor(Math.random() * 2001);

const createRoomCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i += 1) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
};

const getSession = (code) => onlineSessions.get(String(code || "").toUpperCase());

const getClientIp = (req) => {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
        return forwarded.split(",")[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || "unknown";
};

const publicSession = (session) => ({
    code: session.code,
    status: session.status,
    hostId: session.hostId,
    attempt: session.attempt + 1,
    totalAttempts: ATTEMPTS,
    goAt: session.goAt,
    winner: session.winner,
    players: session.players.map((p) => ({
        id: p.id,
        name: p.name,
        attempts: p.attempts,
        bestTime: Number.isFinite(p.bestTime) ? p.bestTime : null,
        submitted: session.submittedPlayerIds.has(p.id)
    }))
});

const savePlayersToLeaderboard = async (players) => {
    for (const player of players) {
        const displayName = normalizeName(player.name);
        const key = nameKey(player.name);
        if (!key) continue;

        const bestTime = Number(player.bestTime);
        if (!Number.isFinite(bestTime)) continue;

        const existing = await Leaderboard.findOne({ nameKey: key })
            || await Leaderboard.findOne({ name: displayName });

        if (existing) {
            existing.name = displayName;
            existing.nameKey = key;
            existing.bestTime = Math.min(existing.bestTime, bestTime);
            existing.gamesPlayed = (existing.gamesPlayed || 0) + 1;
            await existing.save();
        } else {
            await Leaderboard.create({
                name: displayName,
                nameKey: key,
                bestTime,
                gamesPlayed: 1
            });
        }
    }
};

if (process.env.MONGODB_URI) {
    mongoose.connect(process.env.MONGODB_URI)
        .then(() => console.log("MongoDB Atlas connected"))
        .catch(err => console.error("MongoDB connection error:", err));
} else {
    console.warn("MONGODB_URI is not configured; database-backed game history is disabled.");
}

app.post("/api/game", async (req, res) => {
    const { players } = req.body;
    const game = await Game.create({ players });
    res.json(game);
});

app.post("/api/game/:id/finish", async (req, res) => {
    const game = await Game.findById(req.params.id);
    if (!game) return res.status(404).json({ error: "Game not found" });

    // Use final player data from body if sent (frontend has current bestTime); else use stored game.players
    const players = Array.isArray(req.body.players) && req.body.players.length > 0
        ? sanitizePlayers(req.body.players)
        : sanitizePlayers(game.players);

    const winner = buildWinner(players);
    game.winner = winner?.name || "";
    await game.save();

    await savePlayersToLeaderboard(players);

    res.json(game);
});

app.post("/api/online/session", (req, res) => {
    const playerName = normalizeName(req.body?.name);
    if (!playerName) return res.status(400).json({ error: "Player name is required" });
    const playerIp = getClientIp(req);

    let code = createRoomCode();
    while (onlineSessions.has(code)) {
        code = createRoomCode();
    }

    const playerId = randomUUID();
    const session = {
        code,
        hostId: playerId,
        status: "waiting",
        attempt: 0,
        goAt: null,
        submittedPlayerIds: new Set(),
        winner: null,
        players: [{
            id: playerId,
            name: playerName,
            ip: playerIp,
            attempts: [],
            bestTime: Infinity
        }]
    };

    onlineSessions.set(code, session);
    res.json({ playerId, session: publicSession(session) });
});

app.post("/api/online/session/:code/join", (req, res) => {
    const session = getSession(req.params.code);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status !== "waiting") return res.status(400).json({ error: "Session already started" });

    const playerName = normalizeName(req.body?.name);
    if (!playerName) return res.status(400).json({ error: "Player name is required" });
    const playerIp = getClientIp(req);
    const requestedNameKey = nameKey(playerName);

    const duplicateFromSameIp = session.players.some((p) =>
        p.ip === playerIp && nameKey(p.name) === requestedNameKey
    );

    if (duplicateFromSameIp) {
        return res.status(409).json({ error: "This name is already in use from your IP in this room." });
    }

    const playerId = randomUUID();
    session.players.push({
        id: playerId,
        name: playerName,
        ip: playerIp,
        attempts: [],
        bestTime: Infinity
    });

    res.json({ playerId, session: publicSession(session) });
});

app.post("/api/online/session/:code/kick", (req, res) => {
    const session = getSession(req.params.code);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status !== "waiting") return res.status(400).json({ error: "Can only kick players in lobby" });

    const requesterId = req.body?.playerId;
    const targetPlayerId = req.body?.targetPlayerId;

    if (session.hostId !== requesterId) return res.status(403).json({ error: "Only host can kick players" });
    if (!targetPlayerId) return res.status(400).json({ error: "Target player is required" });
    if (targetPlayerId === session.hostId) return res.status(400).json({ error: "Host cannot be kicked" });

    const beforeCount = session.players.length;
    session.players = session.players.filter((p) => p.id !== targetPlayerId);
    session.submittedPlayerIds.delete(targetPlayerId);

    if (session.players.length === beforeCount) {
        return res.status(404).json({ error: "Player not found in session" });
    }

    res.json(publicSession(session));
});

app.get("/api/online/session/:code", (req, res) => {
    const session = getSession(req.params.code);
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json(publicSession(session));
});

app.post("/api/online/session/:code/start", (req, res) => {
    const session = getSession(req.params.code);
    if (!session) return res.status(404).json({ error: "Session not found" });

    if (session.status !== "waiting") return res.status(400).json({ error: "Session already started" });
    if (session.hostId !== req.body?.playerId) return res.status(403).json({ error: "Only host can start" });
    if (session.players.length < 2) return res.status(400).json({ error: "Need at least 2 players to start" });

    session.status = "running";
    session.attempt = 0;
    session.submittedPlayerIds = new Set();
    session.goAt = Date.now() + createDelayMs();

    res.json(publicSession(session));
});

app.post("/api/online/session/:code/tap", async (req, res) => {
    const session = getSession(req.params.code);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status !== "running") return res.status(400).json({ error: "Session is not running" });

    const playerId = req.body?.playerId;
    const player = session.players.find((p) => p.id === playerId);
    if (!player) return res.status(404).json({ error: "Player not found in session" });
    if (session.submittedPlayerIds.has(playerId)) return res.status(400).json({ error: "Attempt already submitted" });
    if (Date.now() < session.goAt) return res.status(400).json({ error: "Too early. Wait for GO." });

    const reactionTime = Number(req.body?.reactionTime);
    const measured = Number.isFinite(reactionTime)
        ? Math.max(0, Math.round(reactionTime))
        : Math.max(0, Date.now() - session.goAt);

    player.attempts.push(measured);
    player.bestTime = Math.min(player.bestTime, measured);
    session.submittedPlayerIds.add(playerId);

    if (session.submittedPlayerIds.size >= session.players.length) {
        if (session.attempt >= ATTEMPTS - 1) {
            session.status = "finished";
            const winner = buildWinner(session.players);
            session.winner = winner ? { id: winner.id, name: winner.name, bestTime: winner.bestTime } : null;

            const playersForDb = session.players.map((p) => ({
                name: p.name,
                attempts: p.attempts,
                bestTime: Number.isFinite(p.bestTime) ? p.bestTime : null
            }));

            await Game.create({
                players: playersForDb,
                winner: session.winner?.name || ""
            });

            await savePlayersToLeaderboard(playersForDb);
        } else {
            session.attempt += 1;
            session.submittedPlayerIds = new Set();
            session.goAt = Date.now() + createDelayMs();
        }
    }

    res.json(publicSession(session));
});

// Normalize so "YASH", "Yash", " YASH " all become one key
const leaderboardKey = (entry) => {
    const raw = (entry.nameKey || entry.name || "").toString().trim().toUpperCase();
    return raw.replace(/\s+/g, "");
};

app.get("/api/leaderboard", async (req, res) => {
    if (mongoose.connection.readyState !== 1) {
        return res.json([]);
    }
    try {
        const all = await Leaderboard.find().sort({ bestTime: 1 });
        const byKey = new Map(); // one entry per person, keep best time
        for (const entry of all) {
            const key = leaderboardKey(entry);
            if (!key) continue;
            const best = byKey.get(key);
            const time = Number(entry.bestTime);
            const displayName = (entry.name || "").toString().trim() || key;
            if (!best) {
                byKey.set(key, { name: displayName, bestTime: isFinite(time) ? time : 0 });
            } else if (isFinite(time) && time < Number(best.bestTime)) {
                byKey.set(key, { name: displayName, bestTime: time });
            }
        }
        const leaderboard = [...byKey.values()].sort((a, b) => a.bestTime - b.bestTime).slice(0, 10);
        res.json(leaderboard);
    } catch (error) {
        console.error("Leaderboard unavailable:", error.message);
        res.json([]);
    }
});

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
server.on("upgrade", (request, socket) => {
    if (!handleArenaUpgrade(request, socket)) socket.destroy();
});
setInterval(() => {
    arenaRooms.forEach((room) => {
        room.clients.forEach((client) => {
            if (!client.alive) {
                client.socket.destroy();
                return;
            }
            client.alive = false;
            if (!client.socket.destroyed) client.socket.write(Buffer.from([0x89, 0]));
        });
    });
}, 15000).unref();

server.listen(PORT, () =>
    console.log(`Server running on port ${PORT}`)
);
