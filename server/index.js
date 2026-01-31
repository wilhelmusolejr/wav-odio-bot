import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import { connectDB } from "./functions/database.js";
import { handleMessage, handleDisconnect } from "./handlers.js";
import { safeSend } from "./utils.js";
import { Account } from "./models/Account.js";

dotenv.config();
await connectDB();

const PORT = process.env.PORT || 8080;

// Express App
const app = express();
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
      { password: 0 }
    );

    res.json({ count: accounts.length, accounts });
  } catch (error) {
    console.error("Error fetching accounts:", error.message);
    res.status(500).json({ error: "Failed to fetch accounts" });
  }
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
