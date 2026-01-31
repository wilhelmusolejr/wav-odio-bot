import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import path from "path";
import { spawn } from "child_process";
import { connectDB } from "./functions/database.js";

import { joinPlayer } from "./functions/player.js";
import { archivePlayerAudios, uploadNewAudios } from "./functions/audio.js";
import { safeSend } from "./functions/helper.js";
import { skipMiddlewareFunction } from "mongoose";
import { defaultS3HttpAuthSchemeParametersProvider } from "@aws-sdk/client-s3/dist-types/auth/httpAuthSchemeProvider.js";
import { DeleteBucketLifecycle$ } from "@aws-sdk/client-s3";
import { kStringMaxLength } from "buffer";

dotenv.config();
await connectDB();

let groups = [];
let players = [];
let bots = [];

// 🔥 Audio generation queue
let audioGenerationQueue = [];
let isProcessingAudio = false;

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

// FETCH DATABASESE IN AUDIO GENERATOR
// MAKE AUDIO GENERATO ONLY USE USERNAME INPUT AND IT SHOULD FETCH DATA VIA MONGODB
// BEFORE GENERATING AUDIO FILES, MAKE SURE TO DELETE OLD FILES FIRST (IN LOCAL)
// THEN BEFORE UPLOADING THE NEWLY GENERATE AUDIOS, MAKE SURE SE 3 FOLDER IS EMPTY EITHER BY ARCHIVING THE OLD FILES OR DELETING IT, THEN UPLOAD NEW FILES TO S3

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

  ws.on("close", () => {
    handleDisconnect(wss, ws, data);
    console.log("Client disconnected");
  });
  ws.on("error", (err) => console.error("WebSocket error:", err.message));
});

function handleDisconnect(wss, ws, data) {
  if (ws.role !== "player") {
    return;
  }

  const groupName = ws.group;
  const playerName = ws.playerName;

  if (!groupName) {
    return;
  }

  const group = data.groups.find((g) => g.name === groupName);
  if (!group) {
    return;
  }

  // Remove player from group and global list
  group.players = group.players.filter((p) => p.name !== playerName);
  data.players = data.players.filter((p) => p.name !== playerName);

  // Reset group if empty
  if (group.players.length === 0) {
    group.status = "waiting";
    if (group.bot) {
      const bot = group.bot;
      bot.status = "available";
      bot.sessionStatus = "idle";
      bot.assignedGroup = null;

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
    }

    group.bot = null;
  }

  // Notify remaining players in the group
  wss.clients.forEach((client) => {
    if (
      client.role === "player" &&
      client.group === groupName &&
      client.readyState === 1
    ) {
      safeSend(client, {
        type: "UPDATE_PLAYERS",
        players: group.players,
      });
    }
  });

  // Broadcast updated state to masters
  broadcastToMasters(wss, {
    type: "STATE_UPDATE",
    data: data,
  });
}

async function handlePlayerFinished(wss, ws, msg, data) {
  const { playerName, groupName } = msg;

  // Get the group
  const group = data.groups.find((g) => g.name === groupName);
  if (!group) {
    console.error(`Group ${groupName} not found`);
    return;
  }

  // Update the specific player's status to "done"
  const player = group.players.find((p) => p.name === playerName);
  if (!player) {
    console.error(`Player ${playerName} not found in group ${groupName}`);
    return;
  }

  player.status = "done";
  console.log(`Player ${playerName} finished in group ${groupName}`);

  // Broadcast updated status to all players in THIS group
  broadcastToGroup(wss, groupName, {
    type: "UPDATE_PLAYERS",
    players: group.players, // Shows current status (some "done", some "speaking")
  });

  // Check if ALL players in the group are done
  const allPlayersDone = group.players.every((p) => p.status === "done");

  if (allPlayersDone) {
    console.log(
      `All players in group ${groupName} are done. Starting completion process.`,
    );
    await handleGroupCompletion(wss, group, data);
  }

  // Broadcast state update to masters
  broadcastToMasters(wss, {
    type: "STATE_UPDATE",
    data: data,
  });
}

/**
 * Handle group completion when all players finish
 */
async function handleGroupCompletion(wss, group, data) {
  const groupName = group.name;

  // 1. Update all players to "finished" status
  for (const player of group.players) {
    player.status = "finished";
  }

  // 2. ⭐ IMPORTANT: Notify players of "finished" status BEFORE clearing group
  broadcastToGroup(wss, groupName, {
    type: "UPDATE_PLAYERS",
    players: group.players, // Shows all players as "finished"
  });

  // 3. Keep a copy of players for audio processing
  const playersCopy = [...group.players];

  // 4. Release the bot assigned to this group
  releaseBot(wss, group, data);

  // 5. Reset the group to waiting state
  group.status = "waiting";
  group.bot = null;
  group.players = []; // ⚠️ Clear players AFTER sending finished status

  console.log(`Group ${groupName} reset to waiting state`);

  // 6. Add to audio generation queue instead of processing immediately
  addToAudioQueue(playersCopy, groupName);
}

/**
 * Release bot from group assignment
 */
function releaseBot(wss, group, data) {
  if (!group.bot) {
    return;
  }

  const bot = data.bots.find((b) => b.assignedGroup === group.name);
  if (!bot) {
    return;
  }

  bot.status = "available";
  bot.sessionStatus = "done";
  bot.assignedGroup = null;

  console.log(`Bot ${bot.name} released from group ${group.name}`);

  // Notify the bot of status change
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
}

/**
 * Add audio generation task to queue
 */
function addToAudioQueue(players, groupName) {
  const task = { players, groupName, timestamp: new Date() };
  audioGenerationQueue.push(task);

  console.log(`📝 Added audio generation task for group ${groupName} to queue`);
  console.log(`📊 Queue length: ${audioGenerationQueue.length}`);

  // Start processing if not already running
  if (!isProcessingAudio) {
    processAudioQueue();
  }
}

/**
 * Process audio generation queue sequentially
 */
async function processAudioQueue() {
  if (isProcessingAudio || audioGenerationQueue.length === 0) {
    return;
  }

  isProcessingAudio = true;

  while (audioGenerationQueue.length > 0) {
    const task = audioGenerationQueue.shift();
    const { players, groupName } = task;

    console.log(`\n🎵 Processing audio generation for group: ${groupName}`);
    console.log(`📊 Remaining in queue: ${audioGenerationQueue.length}`);

    try {
      await processAudioGeneration(players);
      console.log(`✅ Audio generation completed for group: ${groupName}`);
    } catch (error) {
      console.error(
        `❌ Audio generation failed for group ${groupName}:`,
        error,
      );
    }
  }

  isProcessingAudio = false;
  console.log(`\n✅ Audio generation queue empty`);
}

/**
 * Process audio generation for completed group
 */
async function processAudioGeneration(players) {
  try {
    console.log(`Starting audio generation for ${players.length} players`);

    // 1. Archive existing audios for each player
    for (const player of players) {
      await archivePlayerAudios(player.name);
    }

    // 2. Generate new audio files
    const playerNames = players.map((p) => p.name);
    const numFiles = 5;

    await generateLocalAudio(playerNames, numFiles);

    // 3. Upload files to S3
    for (const playerName of playerNames) {
      await uploadNewAudios(playerName);
    }

    console.log(
      `Audio generation completed for players: ${playerNames.join(", ")}`,
    );
  } catch (error) {
    console.error("Error in processAudioGeneration:", error);
    throw error;
  }
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

/**
 * Broadcast message to all players in a specific group
 */
function broadcastToGroup(wss, groupName, message) {
  wss.clients.forEach((client) => {
    if (
      client.role === "player" &&
      client.group === groupName &&
      client.readyState === 1
    ) {
      safeSend(client, message);
    }
  });
}

/**
 * Broadcast message to all master clients
 */
function broadcastToMasters(wss, message) {
  wss.clients.forEach((client) => {
    if (client.role === "master" && client.readyState === 1) {
      safeSend(client, message);
    }
  });
}

server.listen(PORT, () => {
  console.log(`HTTP: http://localhost:${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}/ws`);
});
