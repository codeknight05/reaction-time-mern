import mongoose from "mongoose";

const leaderboardSchema = new mongoose.Schema({
  name: String,
  nameKey: { type: String, sparse: true }, // normalized: trim + uppercase, for one entry per person
  bestTime: Number,
  gamesPlayed: { type: Number, default: 0 }
});

const Leaderboard = mongoose.model("Leaderboard", leaderboardSchema);
export default Leaderboard;