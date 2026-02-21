import dns from "dns";
dns.setServers(["8.8.8.8", "8.8.4.4"]);

import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import Game from "./models/Game.js";
import Leaderboard from "./models/Leaderboard.js";

const app = express();
app.use(cors());
app.use(express.json());

mongoose.connect(
  "mongodb+srv://reactionUser:React%401234@cluster0.wuxry2m.mongodb.net/reaction-game?retryWrites=true&w=majority"
)
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
        ? req.body.players
        : game.players;

    const winner = players.reduce((best, p) => (p.bestTime < best.bestTime ? p : best), players[0]);
    game.winner = winner.name;
    await game.save();

    // Normalize name so "YASH", "Yash", " yash " all update the same leaderboard entry
    const normalizeName = (n) => (n && String(n).trim()) || "";
    const nameKey = (n) => normalizeName(n).toUpperCase();

    // Update leaderboard (one row per person; returning player's better time updates same entry)
    for (const player of players) {
        const displayName = normalizeName(player.name);
        const key = nameKey(player.name);
        if (!key) continue;

        const bestTime = Number(player.bestTime);
        const newBest = isFinite(bestTime) ? bestTime : 0;

        const existing = await Leaderboard.findOne({ nameKey: key })
            || await Leaderboard.findOne({ name: displayName });

        if (existing) {
            existing.name = displayName;
            existing.nameKey = key;
            existing.bestTime = Math.min(existing.bestTime, newBest);
            existing.gamesPlayed = (existing.gamesPlayed || 0) + 1;
            await existing.save();
        } else {
            await Leaderboard.create({
                name: displayName,
                nameKey: key,
                bestTime: newBest,
                gamesPlayed: 1
            });
        }
    }

    res.json(game);
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

app.listen(5000, () =>
    console.log("Server running on http://localhost:5000")
);