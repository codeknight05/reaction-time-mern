import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE, API_MISCONFIGURED, parseJsonResponse } from "../config/api";

const POLL_INTERVAL_MS = 700;

const formatMs = (value) => `${Math.max(0, Math.round(value || 0))} ms`;

const playerStatusLabel = (sessionStatus, submitted) => {
    if (sessionStatus === "waiting") return "In lobby";
    if (sessionStatus === "finished") return "Finished";
    return submitted ? "Tapped" : "Waiting tap";
};

export default function OnlineGame({ roomCode, playerId, onFinish }) {
    const [session, setSession] = useState(null);
    const [error, setError] = useState("");
    const [now, setNow] = useState(Date.now());
    const [submitting, setSubmitting] = useState(false);
    const [kickingId, setKickingId] = useState("");
    const [toast, setToast] = useState("");
    const finishedRef = useRef(false);
    const goSignalRef = useRef(null);
    const audioCtxRef = useRef(null);

    const me = useMemo(
        () => session?.players?.find((p) => p.id === playerId) || null,
        [session, playerId]
    );
    const isHost = session?.hostId === playerId;
    const isRunning = session?.status === "running";
    const hasSubmitted = Boolean(me?.submitted);
    const canTap = isRunning && !hasSubmitted && session?.goAt && now >= session.goAt && !submitting;
    const countdownSeconds = session?.goAt
        ? Math.max(0, Math.ceil((session.goAt - now) / 1000))
        : 0;

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(() => setToast(""), 1800);
        return () => clearTimeout(timer);
    }, [toast]);

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

    useEffect(() => {
        if (!session || session.status !== "running" || !session.goAt) return;
        const key = `${session.attempt}:${session.goAt}`;
        if (goSignalRef.current === key) return;
        if (now < session.goAt) return;

        goSignalRef.current = key;
        playTone(880, 160, "square", 0.07);
        vibrate([40, 30, 40]);
    }, [now, session]);

    const vibrate = (pattern) => {
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
            navigator.vibrate(pattern);
        }
    };

    const getAudioCtx = () => {
        if (typeof window === "undefined") return null;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;
        if (!audioCtxRef.current) audioCtxRef.current = new AudioContextClass();
        return audioCtxRef.current;
    };

    const playTone = (frequency, durationMs, type = "sine", gain = 0.06) => {
        const ctx = getAudioCtx();
        if (!ctx) return;
        if (ctx.state === "suspended") {
            ctx.resume().catch(() => {});
        }
        const osc = ctx.createOscillator();
        const amp = ctx.createGain();
        osc.type = type;
        osc.frequency.value = frequency;
        amp.gain.value = gain;
        osc.connect(amp);
        amp.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + durationMs / 1000);
    };

    const handleCopyCode = async (e) => {
        e.stopPropagation();
        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(roomCode);
            } else {
                const temp = document.createElement("textarea");
                temp.value = roomCode;
                document.body.appendChild(temp);
                temp.select();
                document.execCommand("copy");
                document.body.removeChild(temp);
            }
            setToast("Room code copied");
            playTone(720, 120, "triangle", 0.05);
        } catch {
            setToast("Copy failed");
        }
    };

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
            playTone(520, 110, "square", 0.05);
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
            playTone(980, 100, "triangle", 0.06);
            vibrate(25);
        } catch (err) {
            setError(err.message || "Failed to submit tap.");
        } finally {
            setSubmitting(false);
        }
    };

    const handleKick = async (targetPlayerId) => {
        if (!session || !isHost || session.status !== "waiting" || !targetPlayerId || targetPlayerId === playerId) {
            return;
        }
        try {
            setKickingId(targetPlayerId);
            const res = await fetch(`${API_BASE}/api/online/session/${roomCode}/kick`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ playerId, targetPlayerId })
            });
            const data = await parseJsonResponse(res);
            setSession(data);
            setError("");
            setToast("Player removed");
            playTone(450, 110, "square", 0.05);
        } catch (err) {
            setError(err.message || "Failed to kick player.");
        } finally {
            setKickingId("");
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
                <div className="online-room-row">
                    <p>
                        Room: <strong>{roomCode}</strong>
                    </p>
                    <button type="button" className="copy-room-btn" onClick={handleCopyCode}>
                        Copy Code
                    </button>
                </div>
                <p>
                    Attempt {session?.attempt || 1}/{session?.totalAttempts || 5}
                </p>
                <p>{statusText}</p>
                {error ? <p className="online-error">{error}</p> : null}
                {toast ? <div className="online-toast">{toast}</div> : null}

                {isRunning ? (
                    <div className={`countdown-wrap ${canTap ? "go-live" : ""}`}>
                        <div className="countdown-ring" />
                        <div className="countdown-value">
                            {canTap ? "GO" : countdownSeconds}
                        </div>
                    </div>
                ) : null}

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
                        <div key={p.id} className={`online-player-row ${p.id === playerId ? "is-me" : ""}`}>
                            <div className="online-player-main">
                                <div className="online-player-name">
                                    {p.name}
                                </div>
                                <div className="online-player-badges">
                                    {p.id === playerId ? <span className="online-badge badge-me">You</span> : null}
                                    {session?.hostId === p.id ? <span className="online-badge badge-host">Host</span> : null}
                                    <span className={`online-badge ${p.submitted ? "badge-done" : "badge-wait"}`}>
                                        {playerStatusLabel(session?.status, p.submitted)}
                                    </span>
                                </div>
                            </div>
                            <div className="online-player-stats">
                                <div className="online-stat">
                                    <span className="online-stat-label">Best</span>
                                    <span className="online-stat-value">
                                        {p.bestTime == null ? "-" : formatMs(p.bestTime)}
                                    </span>
                                </div>
                                <div className="online-stat">
                                    <span className="online-stat-label">Attempts</span>
                                    <span className="online-stat-value">
                                        {(p.attempts || []).length}/{session?.totalAttempts || 5}
                                    </span>
                                </div>
                            </div>
                            {isHost && session?.status === "waiting" && p.id !== playerId ? (
                                <button
                                    type="button"
                                    className="kick-player-btn"
                                    disabled={kickingId === p.id}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleKick(p.id);
                                    }}
                                >
                                    {kickingId === p.id ? "Kicking..." : "Kick"}
                                </button>
                            ) : null}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
