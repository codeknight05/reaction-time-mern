import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE, API_MISCONFIGURED, parseJsonResponse } from "../config/api";

const POLL_INTERVAL_MS = 700;

const formatMs = (value) => `${Math.max(0, Math.round(value || 0))} ms`;

export default function OnlineGame({ roomCode, playerId, onFinish }) {
    const [session, setSession] = useState(null);
    const [error, setError] = useState("");
    const [now, setNow] = useState(Date.now());
    const [submitting, setSubmitting] = useState(false);
    const finishedRef = useRef(false);

    const me = useMemo(
        () => session?.players?.find((p) => p.id === playerId) || null,
        [session, playerId]
    );
    const isHost = session?.hostId === playerId;
    const isRunning = session?.status === "running";
    const hasSubmitted = Boolean(me?.submitted);
    const canTap = isRunning && !hasSubmitted && session?.goAt && now >= session.goAt && !submitting;

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        if (API_MISCONFIGURED) {
            setError("Invalid API URL configuration.");
            return;
        }

        let cancelled = false;
        const fetchState = async () => {
            try {
                const res = await fetch(`${API_BASE}/api/online/session/${roomCode}`);
                const data = await parseJsonResponse(res);
                if (!cancelled) {
                    setSession(data);
                    setError("");
                }
            } catch (err) {
                if (!cancelled) setError(err.message || "Failed to load room.");
            }
        };

        fetchState();
        const poll = setInterval(fetchState, POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            clearInterval(poll);
        };
    }, [roomCode]);

    useEffect(() => {
        if (!session || session.status !== "finished" || finishedRef.current) return;
        finishedRef.current = true;
        const finalPlayers = (session.players || []).map((p) => ({
            name: p.name,
            attempts: Array.isArray(p.attempts) ? p.attempts : [],
            bestTime: Number.isFinite(Number(p.bestTime)) ? Number(p.bestTime) : Infinity
        }));
        onFinish(finalPlayers);
    }, [session, onFinish]);

    const handleStart = async () => {
        try {
            const res = await fetch(`${API_BASE}/api/online/session/${roomCode}/start`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerId })
            });
            const data = await parseJsonResponse(res);
            setSession(data);
            setError("");
        } catch (err) {
            setError(err.message || "Failed to start room.");
        }
    };

    const handleTap = async () => {
        if (!session || !canTap) return;
        try {
            setSubmitting(true);
            const reactionTime = Math.max(0, Date.now() - session.goAt);
            const res = await fetch(`${API_BASE}/api/online/session/${roomCode}/tap`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerId, reactionTime })
            });
            const data = await parseJsonResponse(res);
            setSession(data);
            setError("");
        } catch (err) {
            setError(err.message || "Failed to submit tap.");
        } finally {
            setSubmitting(false);
        }
    };

    const statusText = (() => {
        if (!session) return "Loading room...";
        if (session.status === "waiting") return "Waiting in lobby";
        if (session.status === "finished") return "Race complete";
        if (hasSubmitted) return "Attempt submitted. Waiting for others...";
        if (now < session.goAt) return "Lights sequence in progress...";
        return "GO! Tap now!";
    })();

    return (
        <div
            className={`game-container ${canTap ? "go" : "ready"}`}
            onClick={handleTap}
        >
            <div className="online-panel">
                <h2>Online Multiplayer</h2>
                <p>Room: <strong>{roomCode}</strong></p>
                <p>
                    Attempt {session?.attempt || 1}/{session?.totalAttempts || 5}
                </p>
                <p>{statusText}</p>
                {error ? <p className="online-error">{error}</p> : null}

                {session?.status === "waiting" && isHost ? (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleStart();
                        }}
                    >
                        Start Match
                    </button>
                ) : null}

                <div className="online-players">
                    {(session?.players || []).map((p) => (
                        <div key={p.id} className="online-player-row">
                            <span>{p.name}{p.id === playerId ? " (You)" : ""}</span>
                            <span>{p.bestTime == null ? "-" : formatMs(p.bestTime)}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
