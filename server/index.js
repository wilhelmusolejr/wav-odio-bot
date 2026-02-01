import express from "express";
import cors from "cors";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { spawn } from "child_process";
import path from "path";
import dotenv from "dotenv";
import { connectDB } from "./functions/database.js";
import { handleMessage, handleDisconnect } from "./handlers.js";
import { safeSend } from "./utils.js";
import { Account } from "./models/Account.js";
import {
  deleteLocalAudios,
  deletePlayerAudios,
  uploadNewAudios,
} from "./functions/audio.js";

dotenv.config();
await connectDB();

const PORT = process.env.PORT || 8080;

// Express App
const app = express();

// CORS Configuration
app.use(
  cors({
    origin: "http://localhost:5173", // Vite dev server
    credentials: true,
  }),
);

app.use(express.json());

app.get("/", (req, res) => {
  res.send("OK");
});

// API: Get accounts by usernames
app.post("/api/accounts", async (req, res) => {
  const { usernames } = req.body;

  if (!usernames || !Array.isArray(usernames)) {
    return res.status(400).json({ error: "usernames must be an array" });
  }

  try {
    const accounts = await Account.find(
      { username: { $in: usernames } },
      { password: 0 },
    );

    res.json({ count: accounts.length, accounts });
  } catch (error) {
    console.error("Error fetching accounts:", error.message);
    res.status(500).json({ error: "Failed to fetch accounts" });
  }
});

// API: Get all accounts (for audio generation UI)
app.get("/api/accounts/all", async (req, res) => {
  try {
    const accounts = await Account.find(
      {},
      { username: 1, discordName: 1, _id: 0 },
    );
    res.json({ count: accounts.length, accounts });
  } catch (error) {
    console.error("Error fetching all accounts:", error.message);
    res.status(500).json({ error: "Failed to fetch accounts" });
  }
});

// API: Generate audio files
const PYTHON_SCRIPT = path.join(
  process.cwd(),
  "..",
  "audio",
  "audio_generator_improved.py",
);

app.post("/api/generate-audio", async (req, res) => {
  const { usernames, numFiles } = req.body;

  if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
    return res
      .status(400)
      .json({ error: "usernames must be a non-empty array" });
  }

  if (!numFiles || numFiles < 1 || numFiles > 10) {
    return res.status(400).json({ error: "numFiles must be between 1 and 10" });
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`🎵 AUDIO GENERATION REQUEST`);
  console.log(`   Users: ${usernames.join(", ")}`);
  console.log(`   Files per user: ${numFiles}`);
  console.log(`${"=".repeat(50)}\n`);

  // Return immediately, process in background
  res.json({
    success: true,
    message: `Audio generation started for ${usernames.length} user(s)`,
    usernames,
    numFiles,
  });

  // Process each user sequentially
  for (const username of usernames) {
    try {
      console.log(`\n🎵 Processing: ${username}`);

      // Step 1: Delete old local audio files
      await deleteLocalAudios(username);

      // Step 2: Generate new audio files
      console.log(
        `\n📝 Step 2: Generating ${numFiles} audio file(s) for ${username}...`,
      );
      await new Promise((resolve, reject) => {
        const python = spawn(
          "python",
          [PYTHON_SCRIPT, username, numFiles.toString()],
          {
            env: { ...process.env, PYTHONIOENCODING: "utf-8" },
          },
        );

        python.stdout.on("data", (d) =>
          console.log(`[Python]: ${d.toString().trim()}`),
        );
        python.stderr.on("data", (d) =>
          console.error(`[Python]: ${d.toString().trim()}`),
        );

        python.on("close", (code) => {
          code === 0
            ? resolve()
            : reject(new Error(`Python exited with ${code}`));
        });

        python.on("error", reject);
      });

      // Step 3: Delete old S3 audio files
      await deletePlayerAudios(username);

      // Step 4: Upload new audio files to S3
      await uploadNewAudios(username);

      console.log(`✅ Completed: ${username}`);
    } catch (error) {
      console.error(`❌ Failed for ${username}:`, error.message);
    }
  }

  console.log(`\n${"=".repeat(50)}`);
  console.log(`✅ AUDIO GENERATION COMPLETE`);
  console.log(`${"=".repeat(50)}\n`);
});

// HTTP Server
const server = createServer(app);

// WebSocket Server
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  console.log(`Client connected from ${req.socket.remoteAddress}`);
  safeSend(ws, { type: "CONNECTED", message: "Welcome" });

  ws.on("message", (raw) => handleMessage(wss, ws, raw));
  ws.on("close", () => {
    handleDisconnect(wss, ws);
    console.log("Client disconnected");
  });
  ws.on("error", (err) => console.error("WebSocket error:", err.message));
});

server.listen(PORT, () => {
  console.log(`HTTP: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws`);
});
