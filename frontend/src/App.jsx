import { useState } from "react";
import Setup from "./components/Setup";
import Game from "./components/Game";
import Finish from "./components/Finish";

const API = "http://localhost:5000";

function App() {
    const [players, setPlayers] = useState(null);
    const [gameId, setGameId] = useState(null);
    const [finished, setFinished] = useState(false);

    const handleStart = (playerList, id) => {
        setPlayers(playerList);
        setGameId(id);
        setFinished(false);
    };

    const handleFinish = async (finalPlayers) => {
        if (!gameId || !finalPlayers) {
            setFinished(true);
            return;
        }
        try {
            await fetch(`${API}/api/game/${gameId}/finish`, {
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
        } catch (err) {
            console.error("Failed to save results:", err);
        }
        setFinished(true);
    };

    if (!players) return <Setup onStart={handleStart} />;
    if (finished) return <Finish players={players} />;

    return (
        <Game
            players={players}
            onFinish={handleFinish}
        />
    );
}

export default App;