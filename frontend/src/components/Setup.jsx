import { useState, useEffect } from "react";

const API = "http://localhost:5000";

const generateDeviceId = () => {
    return 'device_' + Math.random().toString(36).substr(2, 9);
};

const toGamePlayers = (list) =>
    list.map((p) => ({ name: p.name, attempts: [], bestTime: Infinity }));

export default function Setup({ onStart }) {
    const [players, setPlayers] = useState(() => {
        let deviceId = localStorage.getItem("deviceId");
        if (!deviceId) {
            deviceId = generateDeviceId();
            localStorage.setItem("deviceId", deviceId);
        }

        const saved = localStorage.getItem("playerNames");
        return saved ? JSON.parse(saved) : [{ name: "" }];
    });

    const [leaderboard, setLeaderboard] = useState([]);

    useEffect(() => {
        const fetchLeaderboard = async () => {
            try {
                const response = await fetch("http://localhost:5000/api/leaderboard");
                const data = await response.json();
                setLeaderboard(Array.isArray(data) ? data : []);
            } catch (error) {
                console.error("Failed to fetch leaderboard:", error);
            }
        };

        fetchLeaderboard();
    }, []);

    const handleNameChange = (index, value) => {
        const copy = [...players];
        copy[index].name = value;
        setPlayers(copy);
        localStorage.setItem("playerNames", JSON.stringify(copy));
    };

    const handleAddPlayer = () => {
        setPlayers([...players, { name: "" }]);
    };

    return (
        <div className="setup-wrapper">
            <video className="background-video" autoPlay muted loop>
                <source src="/SaveVid.Net_AQOCOX4P58UbGTHphTnXrli5M9fM6jmsh7Pqe311NOyS7kKf7FxufrsfsLkKsZOT2zBmyrcfZ6vtRHa9Ke-ZeDY6wQkl5JEUEO1TyGxeUg.mp4" type="video/mp4" />
            </video>
            
            <nav className="standings-nav" aria-label="Standings">
                <h2>Standings</h2>
                <div className="leaderboard-list" role="list">
                    {leaderboard.length === 0 ? (
                        <p className="no-data">No standings yet</p>
                    ) : (
                        leaderboard.map((entry, index) => (
                            <div key={index} className="leaderboard-entry" role="listitem">
                                <span className="rank">
                                    {index + 1}
                                </span>
                                <span className="name">{entry.name}</span>
                                <span className="time">{(Number(entry.bestTime) || 0).toFixed(0)} ms</span>
                            </div>
                        ))
                    )}
                </div>
            </nav>

            <div className="setup-content">
                <div className="setup-container">
                    <h1>Reaction Time Challenge 🏁</h1>

                    <p>
                        Please use your REAL name.<br />
                        The leaderboard is public.
                    </p>

                    {players.map((p, i) => (
                        <input
                            key={i}
                            placeholder={`Player ${i + 1} Name`}
                            value={p.name}
                            onChange={e => handleNameChange(i, e.target.value)}
                        />
                    ))}

                    <div className="button-group">
                        <button onClick={handleAddPlayer}>Add Player</button>
                        <button
                            onClick={async () => {
                                const list = [{
                                    ...players[0],
                                    attempts: [],
                                    bestTime: Infinity
                                }];
                                try {
                                    const res = await fetch(`${API}/api/game`, {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ players: list })
                                    });
                                    const game = await res.json();
                                    onStart(list, game._id);
                                } catch (err) {
                                    console.error("Failed to start game:", err);
                                }
                            }}
                        >
                            Solo Mode
                        </button>
                        <button
                            onClick={async () => {
                                const list = toGamePlayers(players.filter((p) => p.name?.trim()));
                                if (list.length === 0) return;
                                try {
                                    const res = await fetch(`${API}/api/game`, {
                                        method: "POST",
                                        headers: { "Content-Type": "application/json" },
                                        body: JSON.stringify({ players: list })
                                    });
                                    const game = await res.json();
                                    onStart(list, game._id);
                                } catch (err) {
                                    console.error("Failed to start game:", err);
                                }
                            }}
                        >
                            Multiplayer
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}