import { useState } from "react";
import Setup from "./components/Setup";
import Game from "./components/Game";
import Finish from "./components/Finish";
import OnlineGame from "./components/OnlineGame";
import { API_BASE, API_MISCONFIGURED, parseJsonResponse } from "./config/api";

function App() {
    const [players, setPlayers] = useState(null);
    const [gameId, setGameId] = useState(null);
    const [onlineRoomCode, setOnlineRoomCode] = useState(null);
    const [onlinePlayerId, setOnlinePlayerId] = useState(null);
    const [finished, setFinished] = useState(false);

    const handleStart = (payload, id) => {
        if (payload?.mode === "online") {
            setOnlineRoomCode(payload.roomCode);
            setOnlinePlayerId(payload.playerId);
            setPlayers(null);
            setGameId(null);
            setFinished(false);
            return;
        }

        const playerList = payload;
        setPlayers(playerList);
        setGameId(id);
        setOnlineRoomCode(null);
        setOnlinePlayerId(null);
        setFinished(false);
    };

    const handleFinish = async (finalPlayers) => {
        if (!gameId || !finalPlayers) {
            setFinished(true);
            return;
        }
        if (API_MISCONFIGURED) {
            console.error("Invalid VITE_API_BASE_URL: replace placeholder URL with your backend URL.");
            setFinished(true);
            return;
        }
        try {
            const response = await fetch(`${API_BASE}/api/game/${gameId}/finish`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    players: finalPlayers.map((p) => ({
                        name: p.name,
                        bestTime: p.bestTime,
                        attempts: p.attempts
                    }))
                })
            });
            await parseJsonResponse(response);
        } catch (err) {
            console.error("Failed to save results:", err);
        }
        setFinished(true);
    };

    const handleOnlineFinish = (finalPlayers) => {
        setPlayers(finalPlayers);
        setOnlineRoomCode(null);
        setOnlinePlayerId(null);
        setGameId(null);
        setFinished(true);
    };

    if (!players && !onlineRoomCode) return <Setup onStart={handleStart} />;
    if (onlineRoomCode && onlinePlayerId) {
        return (
            <OnlineGame
                roomCode={onlineRoomCode}
                playerId={onlinePlayerId}
                onFinish={handleOnlineFinish}
            />
        );
    }
    if (finished) return <Finish players={players} />;

    return (
        <Game
            players={players}
            onFinish={handleFinish}
        />
    );
}

export default App;
