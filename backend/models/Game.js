import mongoose from "mongoose";

const gameSchema = new mongoose.Schema({
  players: Array,
  winner: String,
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Game = mongoose.model("Game", gameSchema);
export default Game;