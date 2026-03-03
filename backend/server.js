import dns from "dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import { randomUUID } from "crypto";
import Game from "./models/Game.js";
import Leaderboard from "./models/Leaderboard.js";

const app = express();
app.use(cors());
app.use(express.json());

const ATTEMPTS = 5;
const onlineSessions = new Map();

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

mongoose.connect(process.env.MONGODB_URI)
.then(() => console.log("MongoDB Atlas connected"))
.catch(err => console.error("MongoDB connection error:", err));

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
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
    console.log(`Server running on port ${PORT}`)
);
