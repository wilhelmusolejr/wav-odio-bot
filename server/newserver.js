import { createServer, get } from "http";
import { WebSocketServer } from "ws";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";

dotenv.config();

const PORT = 8081;
const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

// Basic HTTP server (needed for ws upgrade)
const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("WebSocket server is running\n");
});

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// WebSocket server
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`🔌 Client connected from ${clientIp}`);

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log("📨 Received message:", msg);

      switch (msg.type) {
        case "JOIN_PLAYER":
          JOIN_PLAYER_HANDLER(ws, msg);
          break;
        case "JOIN_MASTER":
          // Handle master joining
          break;
        case "REQUEST_AUDIO_LIST":
          // Handle audio list request
          break;
        default:
          console.log("⚠️ Unknown message type:", msg.type);
      }
    } catch (err) {
      console.error("❌ Failed to parse message:", err.message);
    }
  });

  ws.on("close", () => {
    console.log(`🔌 Client disconnected: ${clientIp}`);
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket error:", err.message);
  });
});

// FUNCTIONS
async function getS3Files(username) {
  const s3Folder = `audios/current/${username}/`;

  const command = new ListObjectsV2Command({
    Bucket: BUCKET_NAME,
    Prefix: s3Folder,
  });

  try {
    const response = await s3.send(command);

    if (!response.Contents || response.Contents.length === 0) {
      console.warn(`⚠️ No audio files found for ${username}`);
      return [];
    }

    // Map the results to return full URLs
    const audioFiles = response.Contents.filter(
      (obj) => obj.Key.endsWith(".mp3") || obj.Key.endsWith(".wav"),
    ).map((obj, index) => ({
      id: index + 1,
      name: obj.Key.split("/").pop(), // Get filename
      url: `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${obj.Key}`,
    }));

    return audioFiles;
  } catch (err) {
    console.error("S3 Error:", err);
    return [];
  }
}

function JOIN_PLAYER_HANDLER(ws, msg) {
  const playerName = msg.playerName || "<unknown>";
  const groupName = msg.groupName || "<none>";
  console.log(`👤 JOIN_PLAYER | player: ${playerName} | group: ${groupName}`);
}

function REQUEST_AUDIO_LIST_HANDLER(ws, msg) {
  const username = msg.username;
  console.log(`🎵 REQUEST_AUDIO_LIST | username: ${username}`);

  // Get audios for the username
  const audios = getS3Files(username);
  console.log(`   ✅ Found ${audios.length} audios for ${username}`);
  res.status(200).json(audios);
}

server.listen(PORT, () => {
  console.log(`🚀 WebSocket server running on ws://localhost:${PORT}/ws`);
});
