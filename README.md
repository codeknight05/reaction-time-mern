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

- **Global leaderboard**  
  - Stores best time per player name.  
  - Returning players update their **existing** entry when they set a better time.  
  - Standings panel shows the top 10 fastest drivers.

- **Persistent names per device**  
  Player names are remembered locally so returning users don’t have to retype them.

---

## Getting Started

### 1. Clone the repo

git clone https://github.com/<your-username>/reaction-time-mern.git
cd reaction-time-mern
