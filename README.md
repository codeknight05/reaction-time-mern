# Reaction Time F1 – MERN

A Formula 1–inspired reaction-time game built with the MERN stack. Players tap as soon as the start lights go out, compete over multiple attempts, and see global standings on a live leaderboard.

## Tech Stack

- **Frontend**: React (Vite), CSS
- **Backend**: Node.js, Express, Mongoose
- **Database**: MongoDB Atlas
- **Build/Runtime**: npm

---

## Features

- **F1-style start sequence**  
  Five red lights sequence on, then go out after a random delay (1–3s). Your tap time is measured from “GO!”.

- **Solo & Multiplayer modes**  
  - Solo: one driver, multiple attempts.  
  - Multiplayer: multiple drivers take turns; each gets a fixed number of attempts.

- **Online Multiplayer (cross-device rooms)**  
  - Create or join a room using a 6-character code.  
  - Host can start when at least 2 players are in lobby and can kick players before start.  
  - Match runs in synced rounds (5 attempts per player) with randomized GO timing each round.  
  - Live room status shows who has tapped, attempts completed, and current best times.  
  - Prevents duplicate same-name joins from the same IP in the same room.  
  - Final winner is the fastest best reaction; results are saved to game history and leaderboard.
- **Global leaderboard**  
  - Stores best time per player name.  
  - Returning players update their **existing** entry when they set a better time.  
  - Standings panel shows the top 10 fastest drivers.

- **Persistent names per device**  
  Player names are remembered locally so returning users don’t have to retype them.

---


