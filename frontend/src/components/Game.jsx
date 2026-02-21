import { useState } from "react";

const ATTEMPTS = 5;

export default function Game({ players, onFinish }) {
    const [current, setCurrent] = useState(0);
    const [attempt, setAttempt] = useState(0);
    const [startTime, setStartTime] = useState(null);
    const [status, setStatus] = useState("ready");
    const [lightsOn, setLightsOn] = useState(0);

    const handleClick = () => {
        if (!startTime) {
            // Only allow the sequence to start from the ready state
            if (status !== "ready") return;

            setStatus("sequence");

            const stepDuration = 500;
            const totalLights = 5;

            const runSequence = (step) => {
                if (step <= totalLights) {
                    setLightsOn(step);
                    setTimeout(() => runSequence(step + 1), stepDuration);
                } else {
                    // All lights are red - now wait 1000-3000ms before GO
                    const randomDelay = 1000 + Math.random() * 2000;
                    setTimeout(() => {
                        // Lights out = GO
                        setLightsOn(0);
                        setStatus("go");
                        setStartTime(performance.now());
                    }, randomDelay);
                }
            };

            runSequence(1);
        } else {
            const time = Math.round(performance.now() - startTime);
            players[current].attempts.push(time);
            players[current].bestTime = Math.min(
                players[current].bestTime,
                time
            );

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
        }
    };

    const statusMessage = (() => {
        if (status === "ready") return "Tap to start the lights";
        if (status === "sequence") return lightsOn === 5 ? "All lights red… wait for GO!" : "Lights on… get ready";
        if (status === "go") return "GO! Tap now!";
        if (status === "clicked") return "Recording time…";
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