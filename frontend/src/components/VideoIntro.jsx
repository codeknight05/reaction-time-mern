import { useEffect, useRef } from "react";

export default function VideoIntro({ onComplete }) {
    const videoRef = useRef(null);

    useEffect(() => {
        const video = videoRef.current;
        if (video) {
            const handleVideoEnd = () => {
                onComplete();
            };
            video.addEventListener("ended", handleVideoEnd);
            return () => video.removeEventListener("ended", handleVideoEnd);
        }
    }, [onComplete]);

    return (
        <div className="video-intro">
            <video 
                ref={videoRef} 
                autoPlay 
                muted 
                onEnded={onComplete}
            >
                <source src="/videos/intro.mp4" type="video/mp4" />
                Your browser does not support the video tag.
            </video>
            <button className="skip-video-btn" onClick={onComplete}>
                Skip
            </button>
        </div>
    );
}
