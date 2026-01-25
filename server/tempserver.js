import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

let AUDIO_PATH = `audio/current/`;
const AWS_REGION = process.env.AWS_REGION || "us-east-1";

/* -------------------- MIDDLEWARE -------------------- */
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.use(express.json());

/* -------------------- SERVER SETUP -------------------- */
const server = createServer(app);
const wss = new WebSocketServer({
  server,
  path: "/ws",
});

/* -------------------- STATE MANAGEMENT -------------------- */
// Store all connected clients with their metadata
const clients = new Map(); // Map<clientId, WebSocket>

// Counter for generating unique IDs
let clientIdCounter = 0;
let groupIdCounter = 0;
let playerIdCounter = 0;
let botIdCounter = 0;

// Main data structures (these will be sent to masters)
const groups = new Map(); // Map<groupId, GroupObject>
const bots = new Map(); // Map<botId, BotObject>

/* 
  Group Object Structure:
  {
    id: "group_1",
    groupName: "Group Alpha",
    channelName: "channel-alpha",
    status: "waiting" | "speaking" | "finished",  // 🆕 Group-level status
    assignedBotId: "bot_1" or null,
    players: [
      {
        id: "player_1",
        name: "John",
        status: "waiting" | "speaking" | "finish",
        isConnected: true | false
      }
    ]
  }

  Bot Object Structure:
  {
    id: "bot_1",
    botName: "Bot Alpha",
    status: "recording" | "break time" | "no bot" | "available",
    isAssigned: true | false,
    groupNameAssigned: "Group Alpha" or null
  }
*/

/* -------------------- AWS S3 CLIENT SETUP -------------------- */
const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const S3_BUCKET = process.env.AWS_BUCKET_NAME || "your-bucket-name";
const S3_AUDIO_PREFIX = process.env.AWS_S3_AUDIO_PREFIX || "audios/current/";

/* -------------------- WEBSOCKET CONNECTION HANDLER -------------------- */
wss.on("connection", (ws, req) => {
  // Generate unique client ID
  const clientId = `client-${++clientIdCounter}`;
  const clientIP = req.socket.remoteAddress;

  // Store client metadata on the WebSocket object
  ws.clientId = clientId;
  ws.role = null; // Will be "master" | "player" | "bot"
  ws.playerName = null;
  ws.groupId = null;
  ws.botName = null;

  // Add to clients map
  clients.set(clientId, ws);
  console.log(`✅ [Connected] ${clientId} from ${clientIP}`);

  // Send welcome message
  ws.send(
    JSON.stringify({
      type: "CONNECTED",
      clientId: clientId,
      message: "Welcome to the WebSocket server!",
    }),
  );

  // Handle incoming messages
  ws.on("message", (raw) => handleMessage(ws, raw));

  // Handle client disconnect
  ws.on("close", () => handleDisconnect(ws));

  // Handle errors
  ws.on("error", (error) => {
    console.error(`❌ [Error] ${ws.clientId}:`, error.message);
  });
});

/* -------------------- MESSAGE ROUTER -------------------- */
function handleMessage(ws, raw) {
  try {
    const msg = JSON.parse(raw);
    console.log(`📨 [${ws.clientId}] Received: ${msg.type}`);

    // Route message to appropriate handler
    const handlers = {
      PING: () => handlePing(ws),
      JOIN_MASTER: () => handleJoinMaster(ws),
      JOIN_PLAYER: () => handleJoinPlayer(ws, msg),
      JOIN_BOT: () => handleJoinBot(ws, msg),
      REQUEST_STATE: () => handleRequestState(ws),

      //   schedule related messages can be added here
      APPLY_SCHEDULE: () => handleApplySchedule(ws, msg),

      //
      AUTO_PLAY_TRIGGERED: () => handleAutoPlayTriggered(ws, msg),

      PLAYER_AUDIO_READY: () => handlePlayerAudioReady(ws, msg), // 🆕 Add this
      PLAY_AUDIO: () => handlePlayAudio(ws, msg),
    };

    const handler = handlers[msg.type];
    if (handler) {
      handler();
    } else {
      console.log(`⚠️ Unknown message type: ${msg.type}`);
    }
  } catch (error) {
    console.error(`❌ Error parsing message:`, error.message);
  }
}

/* -------------------- MESSAGE HANDLERS -------------------- */

function handlePlayAudio(ws, msg) {
  const { groupId, groupName } = msg;

  const group =
    groups.get(groupId) ||
    Array.from(groups.values()).find((g) => g.groupName === groupName);

  if (!group) {
    console.warn(`⚠️ PLAY_AUDIO: Group not found: ${groupName}`);
    return;
  }

  console.log(`🎵 PLAY_AUDIO triggered for group: ${group.groupName}`);
  console.log(
    `   Players ready: ${group.players.filter((p) => p.status === "ready").length}/${group.players.length}`,
  );

  // Notify all players in this group to start playing
  for (const client of wss.clients) {
    if (
      client.role === "player" &&
      client.groupId === group.id &&
      client.readyState === WebSocket.OPEN
    ) {
      client.send(
        JSON.stringify({
          type: "START_PLAYBACK",
          groupId: group.id,
          groupName: group.groupName,
        }),
      );
      console.log(`   ▶️ Sent START_PLAYBACK to ${client.playerName}`);
    }
  }

  broadcastStateToMasters();
}

// Handle PING request (simple heartbeat)
function handlePing(ws) {
  ws.send(JSON.stringify({ type: "PONG" }));
  console.log(`🏓 Sent PONG to ${ws.clientId}`);
}

// Handle master joining
function handleJoinMaster(ws) {
  ws.role = "master";
  console.log(`🎛️ ${ws.clientId} joined as MASTER`);

  // Send current state to the new master
  sendInitialState(ws);
}

// Handle player joining a group
function handleJoinPlayer(ws, msg) {
  const { playerName, groupName, channelName } = msg;

  ws.role = "player";
  ws.playerName = playerName;

  console.log(`👤 Player joining: ${playerName} → Group: ${groupName}`);

  // Find or create group
  let group = Array.from(groups.values()).find(
    (g) => g.groupName === groupName,
  );

  if (!group) {
    // Create new group
    const groupId = `group_${++groupIdCounter}`;
    group = {
      id: groupId,
      groupName: groupName,
      channelName: channelName || `channel-${groupName.toLowerCase()}`,
      status: "waiting", // 🆕 Group starts in waiting status
      assignedBotId: null,
      players: [],
      schedule_info: null,
    };
    groups.set(groupId, group);
    console.log(`🆕 Created new group: ${groupName} (${groupId})`);
  }

  // Store groupId on WebSocket for easy access
  ws.groupId = group.id;

  // Check if player with same name already exists
  const existingPlayerIndex = group.players.findIndex(
    (p) => p.name === playerName,
  );

  let playerId;

  if (existingPlayerIndex !== -1) {
    // Player exists - remove old entry and create new one
    const oldPlayer = group.players[existingPlayerIndex];
    playerId = oldPlayer.id; // Keep the same ID for consistency

    // Remove old player entry
    group.players.splice(existingPlayerIndex, 1);

    console.log(
      `🔄 ${playerName} reconnecting to group ${groupName} (replacing old entry)`,
    );
  } else {
    // New player - generate new ID
    playerId = `player_${++playerIdCounter}`;
    console.log(`✅ ${playerName} joined group ${groupName}`);
  }

  // Create new player object (replaces old one if existed)
  const player = {
    id: playerId,
    name: playerName,
    status: "waiting",
    isConnected: true,
  };

  // Add player to group
  group.players.push(player);
  console.log(`   Total players in ${groupName}: ${group.players.length}`);

  // Send success response to player
  ws.send(
    JSON.stringify({
      type: "JOIN_SUCCESS",
      playerId: playerId,
      groupId: group.id,
      groupName: groupName,
    }),
  );

  // Broadcast updated state to all masters
  broadcastStateToMasters();
}

// Handle bot joining
function handleJoinBot(ws, msg) {
  const { botName } = msg;

  ws.role = "bot";
  ws.botName = botName;

  const botId = `bot_${++botIdCounter}`;

  // Create bot object
  const bot = {
    id: botId,
    botName: botName,
    status: "available",
    isAssigned: false,
    groupNameAssigned: null,
  };

  bots.set(botId, bot);
  console.log(`🤖 ${ws.clientId} joined as BOT: ${botName} (${botId})`);

  // Send success response
  ws.send(
    JSON.stringify({
      type: "BOT_JOIN_SUCCESS",
      botId: botId,
      botName: botName,
    }),
  );

  // Broadcast updated bot list to all masters
  broadcastStateToMasters();
}

// Handle request for current state
function handleRequestState(ws) {
  console.log(`📤 Sending current state to ${ws.clientId}`);
  sendInitialState(ws);
}

function handleApplySchedule(ws, msg) {
  const { mode, groupNames, config } = msg;
  console.log(`🗓️ Applying schedule from ${ws.clientId}`);

  groupNames.forEach((groupName) => {
    const group = Array.from(groups.values()).find(
      (g) => g.groupName === groupName,
    );

    if (!group) {
      console.warn(`⚠️ Group not found: ${groupName}`);
      return;
    }

    let delaySeconds = 0;

    switch (mode) {
      case "right_now":
        delaySeconds = 3;
        break;
      case "randomize":
        const randomHours =
          Math.random() * (config.randomMax - config.randomMin) +
          config.randomMin;
        delaySeconds = randomHours * 3600;
        break;
      case "set_time":
        const [h, m] = config.timeValue.split(":").map(Number);
        const nextRun = new Date();
        nextRun.setHours(h, m, 0, 0);
        if (nextRun <= new Date()) nextRun.setDate(nextRun.getDate() + 1);
        delaySeconds = Math.floor((nextRun.getTime() - Date.now()) / 1000);
        break;
    }

    // Store nextRunAt as timestamp, NOT recalculating delay
    group.schedule_info = {
      mode: mode,
      nextRunAt: Date.now() + delaySeconds * 1000, // Calculate once
    };
  });

  broadcastStateToMasters();
}

async function handleAutoPlayTriggered(ws, msg) {
  const { groupId, groupName } = msg;

  let group = null;
  if (groupId && groups.has(groupId)) {
    group = groups.get(groupId);
  } else if (groupName) {
    group = Array.from(groups.values()).find((g) => g.groupName === groupName);
  }
  if (!group) {
    console.warn(
      `⚠️ AUTO_PLAY_TRIGGERED: group not found (${groupId || groupName})`,
    );
    return;
  }

  console.log(`⏰ AUTO PLAY: ${group.groupName}`);

  // 1) Notify all players in this group to load audio from S3
  let playerCount = 0;

  for (const client of wss.clients) {
    if (
      client.role === "player" &&
      client.groupId === group.id &&
      client.readyState === WebSocket.OPEN
    ) {
      // Get all audio files from S3 for this player
      const audioFiles = await getAudioFilesForPlayer(client.playerName);

      console.log(client.playerName);
      console.log(audioFiles);

      client.send(
        JSON.stringify({
          type: "LOAD_AUDIO",
          groupId: group.id,
          groupName: group.groupName,
          s3Bucket: S3_BUCKET,
          audioPath: audioFiles,
          playerName: client.playerName,
        }),
      );

      console.log(
        `📤 Sent LOAD_AUDIO to player: ${client.playerName} (${audioFiles.length} file(s))`,
      );
      playerCount++;
    }
  }

  console.log(`📤 Notified ${playerCount} player(s) in group ${groupName}`);

  group.schedule_info = null;
  group.status = "loading audio";

  if (group.assignedBotId && bots.has(group.assignedBotId)) {
    const bot = bots.get(group.assignedBotId);
    bot.status = "recording";
    bot.isAssigned = true;
    bot.groupNameAssigned = group.groupName;
  }

  broadcastStateToMasters();
}

/* -------------------- HELPER FUNCTIONS -------------------- */

// Send initial state to a specific client (usually a new master)
function sendInitialState(ws) {
  const state = {
    type: "INITIAL_STATE",
    groups: Array.from(groups.values()),
    bots: Array.from(bots.values()),
  };

  ws.send(JSON.stringify(state));
  console.log(`📤 Sent INITIAL_STATE to ${ws.clientId}`);
}

// Broadcast current state to all connected masters
function broadcastStateToMasters() {
  const state = {
    type: "STATE_UPDATE",
    groups: Array.from(groups.values()),
    bots: Array.from(bots.values()),
  };

  let masterCount = 0;
  wss.clients.forEach((client) => {
    if (client.role === "master" && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(state));
      masterCount++;
    }
  });

  console.log(`📤 Broadcast STATE_UPDATE to ${masterCount} master(s)`);
}

// Handle client disconnect
function handleDisconnect(ws) {
  const { clientId, role, playerName, groupId, botName } = ws;

  console.log(`🔌 [Disconnected] ${clientId} (role: ${role})`);

  // If player disconnected, update their connection status
  if (role === "player" && groupId) {
    const group = groups.get(groupId);
    if (group) {
      const player = group.players.find((p) => p.name === playerName);
      if (player) {
        player.isConnected = false;
        console.log(
          `👋 Player ${playerName} marked as disconnected in ${group.groupName}`,
        );

        // Broadcast updated state
        broadcastStateToMasters();
      }
    }
  }

  // If bot disconnected, remove it
  if (role === "bot") {
    const botEntry = Array.from(bots.entries()).find(
      ([id, bot]) => bot.botName === botName,
    );
    if (botEntry) {
      const [botId, bot] = botEntry;
      bots.delete(botId);
      console.log(`🤖 Bot ${botName} removed`);

      // If bot was assigned to a group, clear the assignment
      groups.forEach((group) => {
        if (group.assignedBotId === botId) {
          group.assignedBotId = null;
          console.log(`🔓 Bot unassigned from ${group.groupName}`);
        }
      });

      // Broadcast updated state
      broadcastStateToMasters();
    }
  }

  // Remove from clients map
  clients.delete(clientId);
}

async function getAudioFilesForPlayer(playerName) {
  try {
    const prefix = `${S3_AUDIO_PREFIX}${playerName}/`;

    const command = new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: prefix,
    });

    const response = await s3Client.send(command);

    if (!response.Contents || response.Contents.length === 0) {
      console.warn(`⚠️ No audio files found for ${playerName} in S3`);
      return [];
    }

    // Filter only audio files and exclude the folder itself
    const audioExtensions = [".mp3", ".wav", ".ogg", ".m4a", ".flac"];
    const audioFiles = response.Contents.filter((obj) => {
      const key = obj.Key;
      // Skip if it's just the folder prefix
      if (key === prefix) return false;

      const ext = key.substring(key.lastIndexOf(".")).toLowerCase();
      return audioExtensions.includes(ext);
    }).map((obj) => {
      // Construct public S3 URL
      const awsRegion = AWS_REGION || "us-east-1";
      const url = `https://${S3_BUCKET}.s3.${awsRegion}.amazonaws.com/${obj.Key}`;

      return {
        key: obj.Key,
        url: url,
        name: obj.Key.split("/").pop(),
      };
    });

    console.log(
      `📁 Found ${audioFiles.length} audio file(s) for ${playerName} in S3`,
    );
    return audioFiles;
  } catch (error) {
    console.error(
      `❌ Error reading S3 bucket for ${playerName}:`,
      error.message,
    );
    return [];
  }
}

function handlePlayerAudioReady(ws, msg) {
  const { playerName, groupName } = msg;

  console.log(`✅ Player ${playerName} audio ready`);

  // Find group by groupName, not groupId
  const group = Array.from(groups.values()).find(
    (g) => g.groupName === groupName,
  );

  if (!group) {
    console.warn(`⚠️ Group not found: ${groupName}`);
    return;
  }

  const player = group.players.find((p) => p.name === playerName);
  if (player) {
    player.status = "ready";
    console.log(`   ${playerName} status updated to: ready`);
  }

  // Broadcast updated state to all masters
  broadcastStateToMasters();
}

/* -------------------- HTTP ROUTES -------------------- */
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "WebSocket server running",
    connectedClients: clients.size,
    totalGroups: groups.size,
    totalBots: bots.size,
  });
});

/* -------------------- START SERVER -------------------- */
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Test Server running on http://0.0.0.0:${PORT}`);
  console.log(`🔌 WebSocket ready at ws://0.0.0.0:${PORT}/ws\n`);
});
