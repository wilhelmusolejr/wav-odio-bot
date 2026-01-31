import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import { connectDB } from "./functions/database.js";
import { handleMessage, handleDisconnect } from "./handlers.js";
import { safeSend } from "./utils.js";

dotenv.config();
await connectDB();

const PORT = process.env.PORT || 8080;

// HTTP Server
const server = createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  } else {
    res.writeHead(404);
    res.end();
  }
});

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
