import mongoose from "mongoose";

const accountSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: false },
  discordName: String,
  voiceType: { type: String, required: true },
  backgroundNoise: { type: String, required: true },
  playerType: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

export const Account = mongoose.model("Account", accountSchema);
