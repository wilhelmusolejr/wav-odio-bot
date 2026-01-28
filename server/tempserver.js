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
import { archivePlayerAudios, uploadNewAudios } from "./functions/audio.js";
import { safeSend } from "./functions/helper.js";

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
groups.push({
  name: "Bonk",
  status: "waiting",
  players: [],
  bot: null,
});
// player.push({
//   name: playerName,
//   type: playerType || "ERROR",
//   isConnected: true,
//   status: "waiting",
// });
// bots.push({
//   name: "BotAlpha",
//   status: "available",
//   sessionStatus: "idle", // undefined | idle | speaking | done
//   assignedGroup: null,
//   isConnected: false,
// });

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
        ws.role = "player";
        ws.playerName = msg.playerName;
        joinPlayer(wss, ws, msg, data);
        break;

      case "JOIN_MASTER":
        ws.role = "master";
        safeSend(ws, { type: "INITIAL_STATE", data: data });
        break;

      case "JOIN_BOT":
        ws.role = "bot";
        ws.botName = msg.botName || "anonymous-bot";

        let bot = {
          name: msg.botName,
          status: "available",
          sessionStatus: "idle",
          assignedGroup: null,
          isConnected: true,
        };

        data.bots.push(bot);
        safeSend(ws, { type: "JOIN_SUCCESS", bot: bot });

        broadcastToMasters(wss, {
          type: "STATE_UPDATE",
          data: data,
        });
        break;

      case "PLAYER_FINISHED":
        console.log(
          `Player finished: ${msg.playerName} in group ${msg.groupName}`,
        );

        handlePlayerFinished(wss, ws, msg, data);
        break;

      default:
        safeSend(ws, { type: "ERROR", message: `Unknown type: ${msg.type}` });
    }
  });

  ws.on("close", () => console.log("Client disconnected"));
  ws.on("error", (err) => console.error("WebSocket error:", err.message));
});

function broadcastToMasters(wss, data) {
  wss.clients.forEach((client) => {
    if (client.role === "master" && client.readyState === 1) {
      safeSend(client, data);
    }
  });
}

async function handlePlayerFinished(wss, ws, msg, data) {
  // get the group based on the playerName and groupName
  const group = data.groups.find((g) => g.name === msg.groupName);
  if (!group) return;

  for (const player of group.players) {
    if (player.name === msg.playerName) {
      player.status = "done";
      break;
    }
  }

  // Tell all players in the group their statuses are updated
  wss.clients.forEach((client) => {
    if (
      client.role === "player" &&
      client.group === group.name &&
      client.readyState === 1
    ) {
      safeSend(client, {
        type: "UPDATE_PLAYERS",
        players: group.players,
      });
    }
  });

  // if all players in group are done, set group status to completed
  if (
    data.groups
      .find((g) => g.name === msg.groupName)
      .players.every((p) => p.status === "done")
  ) {
    let group = data.groups.find((g) => g.name === msg.groupName);

    for (const player of group.players) {
      player.status = "finished";
    }

    // Tell all players in the group their statuses are updated
    wss.clients.forEach((client) => {
      if (
        client.role === "player" &&
        client.group === group.name &&
        client.readyState === 1
      ) {
        safeSend(client, {
          type: "UPDATE_PLAYERS",
          players: group.players,
        });
      }
    });

    let playersCopy = [...group.players];

    if (group) {
      group.status = "waiting";
      group.bot = null;
      group.players = [];
    }

    // update bot status
    for (const bot of data.bots) {
      if (bot.assignedGroup === msg.groupName) {
        bot.status = "available";
        bot.sessionStatus = "done";
        bot.assignedGroup = null;

        console.log(`Bot ${bot.name} is now available.`);

        wss.clients.forEach((client) => {
          if (
            client.role === "bot" &&
            client.botName === bot.name &&
            client.readyState === 1
          ) {
            safeSend(client, {
              type: "STATE_UPDATE",
              bot: bot,
            });
          }
        });

        break;
      }
    }

    // 1 archive audios for each player in group
    for (const player of playersCopy) {
      await archivePlayerAudios(player.name);
    }

    // 2 generate audios for players
    const playerNames = playersCopy.map((p) => p.name);
    await generateLocalAudio(playerNames, 1);

    // 3. Upload files to S3
    for (const playerName of playerNames) {
      await uploadNewAudios(playerName);
    }
  }

  broadcastToMasters(wss, {
    type: "STATE_UPDATE",
    data: data,
  });
}

async function generateLocalAudio(playerNames, numFiles = 1) {
  try {
    const pythonScript = path.join(
      process.cwd(),
      "..",
      "new_audio",
      "conversation.py",
    );

    console.log(
      `Running: python ${pythonScript} --usernames ${playerNames.join(" ")} --num-files ${numFiles}`,
    );

    return new Promise((resolve, reject) => {
      const python = spawn(
        "python",
        [
          pythonScript,
          "--usernames",
          ...playerNames,
          "--num-files",
          numFiles.toString(),
        ],
        {
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        },
      );

      let stderr = "";
      let stdout = "";

      python.stdout.on("data", (data) => {
        stdout += data.toString();
        console.log(`[Python stdout]: ${data}`);
      });

      python.stderr.on("data", (data) => {
        stderr += data.toString();
        console.error(`[Python stderr]: ${data}`);
      });

      python.on("close", (code) => {
        if (code === 0) {
          console.log("Audio generation completed successfully");
          resolve();
        } else {
          console.error(`Python script exited with code ${code}`);
          console.error(`Full stderr output:\n${stderr}`);
          reject(new Error(`Python script failed: ${stderr}`));
        }
      });

      python.on("error", reject);
    });
  } catch (error) {
    console.error("Error generating audio:", error);
    throw error;
  }
}

server.listen(PORT, () => {
  console.log(`HTTP: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws`);
});
