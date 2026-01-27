import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import dotenv from "dotenv";
import fs, { stat } from "fs";
import path from "path";
import { promisify } from "util";
import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readdir, readFile, unlink } from "fs/promises";
import { spawn } from "child_process";

import { joinPlayer } from "./functions/player.js";
import { handleRequestAudio } from "./functions/audio.js";

dotenv.config();

let groups = [];
let players = [];
let bots = [];

groups.push({
  name: "Benk",
  status: "waiting",
  players: [],
  bot: null,
});
players.push({
  playerId: "player_123",
  name: "Alice",
});
bots.push({
  name: "BotAlpha",
  status: "available",
});

let data = {
  groups: groups,
  players: players,
  bots: bots,
};

const app = express();
const PORT = process.env.PORT || 8080;

// Basic HTTP server (optional health check)
const server = createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Basic WebSocket server at ws://localhost:8080/ws
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`Client connected from ${clientIp}`);

  // Greet new client
  ws.send(JSON.stringify({ type: "CONNECTED", message: "Welcome" }));

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      safeSend(ws, { type: "ERROR", message: "Invalid JSON" });
      return;
    }

    switch (msg.type) {
      // STARTER
      case "PING":
        safeSend(ws, { type: "PONG" });
        break;
      case "ECHO":
        safeSend(ws, { type: "ECHO", data: msg.data ?? null });
        break;

      // HANDLERS
      case "JOIN_PLAYER":
        joinPlayer(wss, ws, msg, data);
        break;

      case "JOIN_MASTER":
        ws.role = "master";
        safeSend(ws, { type: "INITIAL_STATE", data: data });
        break;

      case "JOIN_BOT":
        // PENDING: validate botName uniqueness
        ws.role = "bot";
        ws.botName = msg.botName || "anonymous-bot";
        safeSend(ws, { type: "JOIN_SUCCESS", botName: ws.botName });
        break;

      case "REQUEST_AUDIO":
        handleRequestAudio(ws, msg);
        break;

      default:
        safeSend(ws, { type: "ERROR", message: `Unknown type: ${msg.type}` });
    }
  });

  ws.on("close", () => console.log("Client disconnected"));
  ws.on("error", (err) => console.error("WebSocket error:", err.message));
});

// Safe send helper
function safeSend(ws, data) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
}

function broadcastToMasters(wss, data) {
  wss.clients.forEach((client) => {
    if (client.role === "master" && client.readyState === 1) {
      safeSend(client, data);
    }
  });
}

server.listen(PORT, () => {
  console.log(`HTTP: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws`);
});
