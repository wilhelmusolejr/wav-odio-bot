import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
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

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let AUDIO_PATH = `audio/current/`;
const AWS_REGION = process.env.AWS_REGION || "us-east-1";

// Promisify fs functions for async/await
const unlinkAsync = promisify(fs.unlink);
const readdirAsync = promisify(fs.readdir);
const existsAsync = promisify(fs.exists);

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

const S3_BUCKET = process.env.AWS_BUCKET_NAME || "your-bucket-name";
const S3_AUDIO_PREFIX = process.env.AWS_S3_AUDIO_PREFIX || "audios/current/";
const S3_KEY = process.env.AWS_ACCESS_KEY_ID;
const S3_SECRET = process.env.AWS_SECRET_ACCESS_KEY;

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: S3_KEY,
    secretAccessKey: S3_SECRET,
  },
});

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
      PLAYER_FINISHED: () => handlePlayerFinished(ws, msg), // 🆕 Player finished all audio
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

  // Set group status to speaking
  group.status = "speaking";

  // Set all players in the group to speaking
  group.players.forEach((player) => {
    if (player.status === "ready") {
      player.status = "speaking";
    }
  });

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

    const response = await s3.send(command);

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

function handlePlayerFinished(ws, msg) {
  const { playerName, groupName } = msg;

  console.log(`🏁 Player ${playerName} finished playing all audio`);

  // Find group by groupName
  const group = Array.from(groups.values()).find(
    (g) => g.groupName === groupName,
  );

  if (!group) {
    console.warn(`⚠️ Group not found: ${groupName}`);
    return;
  }

  const player = group.players.find((p) => p.name === playerName);
  if (player) {
    player.status = "finished";
    console.log(`   ${playerName} status updated to: finished`);
  }

  // Check if all players in the group are finished
  const allFinished = group.players.every((p) => p.status === "finished");

  if (allFinished) {
    console.log(`✅ All players in ${groupName} have finished!`);
    executeRegenerationWorkflow(
      group.groupName,
      group.players.map((p) => p.name),
    );

    // Update group status
    group.status = "Breaktime";
    group.players.forEach((p) => {
      p.status = "waiting"; // Reset player status for next round
    });

    // Update assigned bot status
    if (group.assignedBotId && bots.has(group.assignedBotId)) {
      const bot = bots.get(group.assignedBotId);
      bot.status = "break time";
      bot.isAssigned = false;
      bot.groupNameAssigned = null;
    }
    let delaySeconds = 60; // Default 5 minutes break

    group.schedule_info = {
      mode: "right_now",
      nextRunAt: Date.now() + delaySeconds * 1000, // Calculate once
    };
  }

  // Broadcast updated state to all masters
  broadcastStateToMasters();
}

async function executeRegenerationWorkflow(groupName, playerNames) {
  console.log(`\n${"═".repeat(47)}`);
  console.log(`🔄 AUDIO REGENERATION WORKFLOW STARTED`);
  console.log(`   Group: ${groupName}`);
  console.log(`   Players: ${playerNames.join(", ")}`);
  console.log(`${"═".repeat(47)}\n`);

  try {
    // Step 1: Archive audios for all players
    for (const playerName of playerNames) {
      await archivePlayerAudios(playerName);
    }

    // Step 2: Trigger audio generator
    await triggerAudioGenerator(playerNames);

    // Step 3: Upload new audios for all players
    for (const playerName of playerNames) {
      await uploadNewAudios(playerName);
    }

    console.log(
      `\n✅ Audio regeneration workflow completed for group ${groupName}!\n`,
    );
  } catch (error) {
    console.error(`\n❌ Regeneration workflow failed:`, error);
    throw error;
  }
}

/* -------------------- HELPER FUNCTIONS FOR SESSION PREPARATION -------------------- */

async function archivePlayerAudios(username) {
  console.log(`\n📦 Step 1: Archiving audios for ${username}...`);

  try {
    // List all current audio files
    const listCommand = new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: `audios/current/${username}/`,
    });

    const response = await s3.send(listCommand);

    if (!response.Contents || response.Contents.length === 0) {
      console.log(`   ⚠️ No audio files found for ${username}`);
      return;
    }

    const audioFiles = response.Contents.filter(
      (obj) => obj.Key.endsWith(".mp3") || obj.Key.endsWith(".wav"),
    );

    console.log(`   📁 Found ${audioFiles.length} audio files to archive`);

    // Copy each file to archive
    for (const file of audioFiles) {
      const fileName = file.Key.split("/").pop();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const archiveKey = `audios/archive/${username}/${timestamp}_${fileName}`;

      // Copy to archive
      const copyCommand = new CopyObjectCommand({
        Bucket: S3_BUCKET,
        CopySource: `${S3_BUCKET}/${file.Key}`,
        Key: archiveKey,
      });

      await s3.send(copyCommand);
      console.log(`   ✅ Archived: ${fileName} → ${archiveKey}`);

      // Delete from current
      const deleteCommand = new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: file.Key,
      });

      await s3.send(deleteCommand);
      console.log(`   🗑️ Deleted from current: ${file.Key}`);
    }

    console.log(`   ✅ Archiving complete for ${username}`);
  } catch (error) {
    console.error(
      `   ❌ Error archiving audios for ${username}:`,
      error.message,
    );
    throw error;
  }
}

async function deleteLocalOutputFiles(playerName) {
  // Fix: Go up one level from server folder to reach root/audio
  const outputPath = path.join(
    process.cwd(),
    "..",
    "audio",
    "output",
    playerName,
  );

  try {
    if (!fs.existsSync(outputPath)) {
      console.log(`   ⚠️ No output folder found for ${playerName}`);
      return;
    }

    const files = await readdirAsync(outputPath);

    if (files.length === 0) {
      console.log(`   ⚠️ Output folder is already empty`);
      return;
    }

    console.log(`   🗑️ Found ${files.length} file(s) to delete`);

    // Delete files sequentially
    for (const file of files) {
      const filePath = path.join(outputPath, file);
      await unlinkAsync(filePath);
      console.log(`   ✓ Deleted: ${file}`);
    }

    console.log(`   ✅ Successfully deleted ${files.length} file(s)`);
  } catch (error) {
    console.error(`   ❌ Error deleting local files:`, error.message);
    throw error;
  }
}

const randomInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

async function triggerAudioGenerator(playerNames) {
  console.log(`\n🎙️ Step 2: Triggering audio generator...`);
  console.log(`   🐍 Running Python audio generator...`);

  let toGenerateFiles = randomInt(5, 10);

  return new Promise((resolve, reject) => {
    // Build accounts configuration for Python script
    const accounts = playerNames.map((playerName) => ({
      username: playerName,
      audios: 1, // Generate 1 audio file per player
    }));

    const accountsJson = JSON.stringify(accounts);

    console.log(`   📝 Configuration:`);
    accounts.forEach((acc, index) => {
      console.log(
        `      Player ${index + 1}: ${acc.username} (${acc.audios} audio(s))`,
      );
    });

    // Spawn Python process (spawn already imported at top)
    // Set UTF-8 encoding to handle emoji in output
    const pythonProcess = spawn("python", ["../audio/main.py", accountsJson], {
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });

    let outputData = "";
    let errorData = "";

    pythonProcess.stdout.on("data", (data) => {
      const output = data.toString();
      outputData += output;
      console.log(`   🐍 ${output.trim()}`);
    });

    pythonProcess.stderr.on("data", (data) => {
      const error = data.toString();
      errorData += error;
      console.error(`   ❌ Python Error: ${error.trim()}`);
    });

    pythonProcess.on("close", (code) => {
      if (code === 0) {
        console.log(`   ✅ Audio generation complete!`);
        console.log(`   📂 Generated files saved to audio/output/`);
        resolve();
      } else {
        console.error(`   ❌ Python process exited with code ${code}`);
        reject(
          new Error(`Python process failed with code ${code}\n${errorData}`),
        );
      }
    });

    pythonProcess.on("error", (error) => {
      console.error(`   ❌ Failed to start Python process:`, error.message);
      reject(error);
    });
  });
}

async function uploadNewAudios(username) {
  console.log(`\n☁️ Step 3: Uploading new audios for ${username}...`);

  const outputDir = join(__dirname, "..", "audio", "output", username);

  try {
    // Read all files from the output directory
    const files = await readdir(outputDir);
    const audioFiles = files.filter(
      (f) => f.endsWith(".mp3") || f.endsWith(".wav"),
    );

    if (audioFiles.length === 0) {
      console.log(`   ⚠️ No audio files found in ${outputDir}`);
      return;
    }

    console.log(`   📁 Found ${audioFiles.length} audio file(s) to upload`);

    for (const file of audioFiles) {
      const filePath = join(outputDir, file);
      const fileContent = await readFile(filePath);
      const s3Key = `audios/current/${username}/${file}`;

      // Upload to S3
      const uploadCommand = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: fileContent,
        ContentType: file.endsWith(".mp3") ? "audio/mpeg" : "audio/wav",
      });

      await s3.send(uploadCommand);
      console.log(`   ✅ Uploaded: ${file} → ${s3Key}`);

      // Delete local file after successful upload
      await unlink(filePath);
      console.log(`   🗑️ Deleted local: ${filePath}`);
    }

    console.log(`   ✅ Upload complete for ${username}`);
  } catch (error) {
    console.error(
      `   ❌ Error uploading audios for ${username}:`,
      error.message,
    );
    throw error;
  }
}

/* -------------------- START SERVER -------------------- */
server.listen(PORT, () => {
  console.log(`🚀 WebSocket server running on ws://localhost:${PORT}/ws`);
  console.log(`📡 HTTP server running on http://localhost:${PORT}`);
});
