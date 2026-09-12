import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../config/api";
import { parseServerMessage } from "../arena/protocol";

const INTERPOLATION_DELAY_MS = 100;
const CURSOR_SEND_INTERVAL_MS = 50;
const emojis = ["👏", "🔥", "⚡", "🎉"];

const getClientId = () => {
    const key = "arena-client-id";
    let id = sessionStorage.getItem(key);
    if (!id) {
        id = crypto.randomUUID();
        sessionStorage.setItem(key, id);
    }
    return id;
};

const wsUrl = (room) => {
    const base = API_BASE || window.location.origin;
    const url = new URL(base, window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws/arena";
    url.search = `?room=${encodeURIComponent(room)}`;
    return url.toString();
};

export default function LiveArena({ roomCode, playerName, onExit }) {
    const canvasRef = useRef(null);
    const socketRef = useRef(null);
    const reconnectRef = useRef(null);
    const participantsRef = useRef(new Map());
    const sequenceRef = useRef(0);
    const lastCursorSentRef = useRef(0);
    const selectedEmojiRef = useRef(emojis[0]);
    const [participants, setParticipants] = useState([]);
    const [selectedEmoji, setSelectedEmoji] = useState(emojis[0]);
    const [connection, setConnection] = useState("connecting");
    const [reactions, setReactions] = useState([]);

    const publish = (message) => {
        if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify(message));
    };

    const syncParticipants = () => setParticipants([...participantsRef.current.values()]);

    useEffect(() => {
        selectedEmojiRef.current = selectedEmoji;
    }, [selectedEmoji]);

    useEffect(() => {
        let stopped = false;
        let retryDelay = 500;
        const connect = () => {
            if (stopped) return;
            setConnection("connecting");
            const socket = new WebSocket(wsUrl(roomCode));
            socketRef.current = socket;
            socket.onopen = () => {
                retryDelay = 500;
                setConnection("live");
                publish({ type: "hello", clientId: getClientId(), name: playerName });
            };
            socket.onmessage = (event) => {
                const message = parseServerMessage(event.data);
                if (!message) return;
                const now = performance.now();
                if (message.type === "snapshot") {
                    participantsRef.current.clear();
                    message.clients.forEach((client) => {
                        participantsRef.current.set(client.id, { ...client, samples: [{ x: client.x, y: client.y, time: now }] });
                    });
                    syncParticipants();
                } else if (message.type === "presence") {
                    if (message.action === "leave") participantsRef.current.delete(message.clientId);
                    if (message.action === "join" && message.client) {
                        participantsRef.current.set(message.clientId, { ...message.client, samples: [{ x: message.client.x, y: message.client.y, time: now }] });
                    }
                    syncParticipants();
                } else if (message.type === "cursor") {
                    const participant = participantsRef.current.get(message.clientId);
                    if (!participant || message.seq <= participant.cursorSeq) return;
                    participant.cursorSeq = message.seq;
                    participant.samples = [...participant.samples.slice(-1), { x: message.x, y: message.y, time: now }];
                } else if (message.type === "reaction") {
                    setReactions((current) => [...current.slice(-24), { ...message, id: `${message.clientId}-${message.seq}`, born: now }]);
                }
            };
            socket.onclose = () => {
                if (stopped) return;
                setConnection("reconnecting");
                reconnectRef.current = window.setTimeout(connect, retryDelay);
                retryDelay = Math.min(5000, retryDelay * 2);
            };
            socket.onerror = () => socket.close();
        };
        connect();
        return () => {
            stopped = true;
            window.clearTimeout(reconnectRef.current);
            socketRef.current?.close();
        };
    }, [roomCode, playerName]);

    useEffect(() => {
        let animationFrame;
        const draw = (time) => {
            const canvas = canvasRef.current;
            const context = canvas?.getContext("2d");
            if (!canvas || !context) return;
            const width = canvas.clientWidth;
            const height = canvas.clientHeight;
            const scale = window.devicePixelRatio || 1;
            if (canvas.width !== width * scale || canvas.height !== height * scale) {
                canvas.width = width * scale;
                canvas.height = height * scale;
            }
            context.setTransform(scale, 0, 0, scale, 0, 0);
            context.clearRect(0, 0, width, height);
            context.fillStyle = "rgba(9, 18, 35, 0.48)";
            context.fillRect(0, 0, width, height);
            const targetTime = time - INTERPOLATION_DELAY_MS;
            participantsRef.current.forEach((participant) => {
                const samples = participant.samples;
                const first = samples[0];
                const second = samples[1] || first;
                const fraction = second.time === first.time ? 1 : Math.max(0, Math.min(1, (targetTime - first.time) / (second.time - first.time)));
                const x = (first.x + (second.x - first.x) * fraction) * width;
                const y = (first.y + (second.y - first.y) * fraction) * height;
                context.beginPath();
                context.arc(x, y, participant.id === getClientId() ? 9 : 12, 0, Math.PI * 2);
                context.fillStyle = participant.color;
                context.shadowColor = participant.color;
                context.shadowBlur = 18;
                context.fill();
                context.shadowBlur = 0;
                context.fillStyle = "#06111f";
                context.font = "600 12px Georgia";
                context.fillText(participant.name, x + 16, y + 4);
            });
            setReactions((current) => current.filter((reaction) => time - reaction.born < 1400));
            animationFrame = requestAnimationFrame(draw);
        };
        animationFrame = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(animationFrame);
    }, []);

    const pointFromEvent = (event) => {
        const rect = canvasRef.current.getBoundingClientRect();
        return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
    };

    const handlePointerMove = (event) => {
        const now = performance.now();
        if (now - lastCursorSentRef.current < CURSOR_SEND_INTERVAL_MS) return;
        lastCursorSentRef.current = now;
        const point = pointFromEvent(event);
        publish({ type: "cursor", seq: sequenceRef.current++, ...point });
        const self = participantsRef.current.get(getClientId());
        if (self) {
            self.x = point.x;
            self.y = point.y;
            self.samples = [...self.samples.slice(-1), { ...point, time: now }];
        }
    };

    const handleReact = (event) => {
        const point = pointFromEvent(event);
        publish({ type: "reaction", seq: sequenceRef.current++, ...point, emoji: selectedEmojiRef.current });
    };

    return (
        <main className="arena-shell">
            <header className="arena-header">
                <div>
                    <p className="eyebrow">REAL-TIME FAN MOMENT</p>
                    <h1>Live Arena <span>/{roomCode}</span></h1>
                </div>
                <div className={`arena-status ${connection}`}><i /> {connection === "live" ? "Live" : connection}</div>
                <button type="button" className="arena-exit" onClick={onExit}>Exit</button>
            </header>
            <section className="arena-layout">
                <div className="arena-stage-wrap">
                    <div className="arena-instruction">Move your cursor through the field. Click anywhere to send a reaction.</div>
                    <canvas ref={canvasRef} className="arena-canvas" onPointerMove={handlePointerMove} onClick={handleReact} aria-label="Shared live cursor arena" />
                    {reactions.map((reaction) => <span key={reaction.id} className="arena-reaction" style={{ left: `${reaction.x * 100}%`, top: `${reaction.y * 100}%` }}>{reaction.emoji}</span>)}
                </div>
                <aside className="arena-sidebar">
                    <div className="arena-sidebar-heading"><span>Room pulse</span><strong>{participants.length} live</strong></div>
                    <p className="arena-muted">Cursors are shared at 20 updates/sec and rendered 100 ms behind the network edge for smoother motion.</p>
                    <div className="emoji-picker" aria-label="Choose reaction">
                        {emojis.map((emoji) => <button type="button" key={emoji} className={selectedEmoji === emoji ? "selected" : ""} onClick={() => setSelectedEmoji(emoji)}>{emoji}</button>)}
                    </div>
                    <div className="arena-people">
                        {participants.map((participant) => <div className="arena-person" key={participant.id}><i style={{ background: participant.color }} /><span>{participant.name}{participant.id === getClientId() ? " (you)" : ""}</span></div>)}
                    </div>
                </aside>
            </section>
        </main>
    );
}
