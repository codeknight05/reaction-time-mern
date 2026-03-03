import { useEffect, useRef, useState } from "react";

const ATTEMPTS = 5;
const FALSE_START_MESSAGE = "ACHA LAUDE";
const FALSE_START_DELAY_MS = 1000;

export default function Game({ players, onFinish }) {
    const [current, setCurrent] = useState(0);
    const [attempt, setAttempt] = useState(0);
    const [startTime, setStartTime] = useState(null);
    const [status, setStatus] = useState("ready");
    const [lightsOn, setLightsOn] = useState(0);

    const sequenceTimerRef = useRef(null);
    const goTimerRef = useRef(null);
    const falseStartTimerRef = useRef(null);

    const clearPendingTimers = () => {
        if (sequenceTimerRef.current) {
            clearTimeout(sequenceTimerRef.current);
            sequenceTimerRef.current = null;
        }
        if (goTimerRef.current) {
            clearTimeout(goTimerRef.current);
            goTimerRef.current = null;
        }
        if (falseStartTimerRef.current) {
            clearTimeout(falseStartTimerRef.current);
            falseStartTimerRef.current = null;
        }
    };

    useEffect(() => () => clearPendingTimers(), []);

    const triggerFalseStart = () => {
        clearPendingTimers();
        setLightsOn(0);
        setStartTime(null);
        setStatus("false-start");
        falseStartTimerRef.current = setTimeout(() => {
            setStatus("ready");
            falseStartTimerRef.current = null;
        }, FALSE_START_DELAY_MS);
    };

    const handleClick = () => {
        if (status === "sequence") {
            triggerFalseStart();
            return;
        }

        if (status === "false-start" || status === "clicked") {
            return;
        }

        if (!startTime) {
            if (status !== "ready") return;

            setStatus("sequence");

            const stepDuration = 500;
            const totalLights = 5;

            const runSequence = (step) => {
                if (step <= totalLights) {
                    setLightsOn(step);
                    sequenceTimerRef.current = setTimeout(() => runSequence(step + 1), stepDuration);
                } else {
                    const randomDelay = 1000 + Math.random() * 2000;
                    goTimerRef.current = setTimeout(() => {
                        setLightsOn(0);
                        setStatus("go");
                        setStartTime(performance.now());
                        goTimerRef.current = null;
                    }, randomDelay);
                }
            };

            runSequence(1);
            return;
        }

        const time = Math.round(performance.now() - startTime);
        players[current].attempts.push(time);
        players[current].bestTime = Math.min(players[current].bestTime, time);

        setStatus("clicked");
        setStartTime(null);

        setTimeout(() => {
            if (attempt === ATTEMPTS - 1) {
                if (current === players.length - 1) {
                    onFinish(players);
                } else {
                    setCurrent(current + 1);
                    setAttempt(0);
                    setStatus("ready");
                }
            } else {
                setAttempt(attempt + 1);
                setStatus("ready");
            }
            setLightsOn(0);
        }, 500);
    };

    const statusMessage = (() => {
        if (status === "ready") return "Tap to start the lights";
        if (status === "sequence") return lightsOn === 5 ? "All lights red... wait for GO!" : "Lights on... get ready";
        if (status === "false-start") return FALSE_START_MESSAGE;
        if (status === "go") return "GO! Tap now!";
        if (status === "clicked") return "Recording time...";
        return "";
    })();

    return (
        <div
            className={`game-container ${status === "go" ? "go" : "ready"}`}
            onClick={handleClick}
        >
            <div className="game-text">
                <div className="game-player-label">
                    {players[current].name}
                </div>
                <div className="game-attempt-label">
                    Attempt {attempt + 1}/{ATTEMPTS}
                </div>

                <div className="start-lights">
                    {[0, 1, 2, 3, 4].map((i) => (
                        <div
                            key={i}
                            className={`start-light ${lightsOn > i ? "on" : ""}`}
                        />
                    ))}
                </div>

                <div className="game-status-text">
                    {statusMessage}
                </div>
            </div>
        </div>
    );
}
