import { useEffect, useState } from "react";
import { API_BASE, API_MISCONFIGURED, parseJsonResponse } from "../config/api";

export default function Finish({ players }) {
    const [leaderboard, setLeaderboard] = useState([]);

    useEffect(() => {
        if (API_MISCONFIGURED) {
            console.error("Invalid VITE_API_BASE_URL: replace placeholder URL with your backend URL.");
            return;
        }

        fetch(`${API_BASE}/api/leaderboard`)
            .then(parseJsonResponse)
            .then(setLeaderboard);
    }, []);

    return (
        <div className="finish-container">
            <h2>Game Results</h2>

            <div className="results-section">
                {players.map(p => (
                    <div key={p.name} className="result-item">
                        {p.name} – Best Time: <strong>{p.bestTime}</strong> ms
                    </div>
                ))}
            </div>

            <h2>Global Leaderboard</h2>

            <div className="results-section">
                {leaderboard.length > 0 ? (
                    leaderboard.map((p, i) => (
                        <div key={i} className="leaderboard-item">
                            #{i + 1} {p.name} – {p.bestTime} ms
                        </div>
                    ))
                ) : (
                    <p>Loading leaderboard...</p>
                )}
            </div>
        </div>
    );
}
