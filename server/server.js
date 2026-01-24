import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import dotenv from "dotenv";
import {
  S3Client,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { spawn } from "child_process";
import { readdir, readFile, unlink } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

/* -------------------- AWS S3 SETUP -------------------- */
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.AWS_BUCKET_NAME;

/* -------------------- MIDDLEWARE -------------------- */
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.use(express.json());

/* -------------------- SERVER -------------------- */
const server = createServer(app);
const wss = new WebSocketServer({
  server,
  path: "/ws",
});

/* -------------------- STATE -------------------- */
const clients = new Map();
const groups = new Map();
const groupBotStatus = new Map();
const playingGroups = new Map();
const groupSchedules = new Map(); // 🆕 Store schedules server-side
const bots = new Map(); // 🆕 track bots

let clientIdCounter = 0;

// 🆕 Helper functions for scheduling
const getInitialDelay = () => Math.floor(Math.random() * 10 * 60); // 0-10 minutes
const getNextCycleDelay = (min_hour = 1, max_hour = 3) => {
  const minSeconds = min_hour * 3600;
  const maxSeconds = max_hour * 3600;

  return Math.floor(Math.random() * (maxSeconds - minSeconds) + minSeconds);
};

const randomInt = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/* -------------------- WEBSOCKET HANDLERS -------------------- */
wss.on("connection", (ws, req) => {
  const clientId = `client-${++clientIdCounter}`;
  const clientIP = req.socket.remoteAddress;

  ws.clientId = clientId;
  ws.role = null;
  ws.playerName = null;
  ws.groupName = null;

  clients.set(clientId, ws);
  console.log(`✅ [Connected] ${clientId} from ${clientIP}`);

  ws.on("message", (raw) => handleMessage(ws, raw));
  ws.on("close", () => handleDisconnect(ws));
  ws.on("error", (error) => {
    console.error(`❌ [Error] ${ws.clientId}:`, error.message);
  });
});

function handleJoinMaster(ws) {
  ws.role = "master";
  console.log(`🎛️ ${ws.clientId} is now a MASTER`);

  // 🆕 Send initial groups and schedules
  const schedulesData = {};
  groupSchedules.forEach((schedule, groupName) => {
    schedulesData[groupName] = schedule;
  });

  ws.send(
    JSON.stringify({
      type: "INITIAL_GROUPS",
      groups: Array.from(groups.values()),
      schedules: schedulesData, // 🆕 Include schedules
      bots: Array.from(bots.values()), // 🆕 send bots
    }),
  );
}

function handleJoinPlayer(ws, msg) {
  const { playerName, groupName } = msg;
  ws.role = "player";
  ws.playerName = playerName;
  ws.groupName = groupName;

  console.log(`👤 Player joining: ${playerName} → Group: ${groupName}`);

  // Create group if doesn't exist
  if (!groups.has(groupName)) {
    groups.set(groupName, {
      name: groupName,
      players: [],
    });
    console.log(`🆕 Created new group: ${groupName}`);
  }

  // Add player to group
  const group = groups.get(groupName);
  group.players.push({
    clientId: ws.clientId,
    name: playerName,
  });

  console.log(`✅ ${playerName} joined group ${groupName}`);
  console.log(`📊 Group ${groupName} now has ${group.players.length} players`);

  // Send success to player
  ws.send(
    JSON.stringify({
      type: "JOIN_SUCCESS",
      clientId: ws.clientId,
      playerName: playerName,
      groupName: groupName,
      playersInGroup: group.players.length,
    }),
  );

  // Broadcast group update to all masters
  broadcastToMasters({
    type: "GROUPS_UPDATE",
    groups: Array.from(groups.values()),
  });
}

async function handlePlayAudio(msg) {
  const { groupName } = msg;
  console.log(`\n🎵 PLAY_AUDIO command received for group: ${groupName}`);

  const group = groups.get(groupName);
  if (!group) {
    console.error(`❌ Group not found: ${groupName}`);
    return;
  }

  // 🆕 Initialize playing group tracker
  playingGroups.set(groupName, {
    totalPlayers: group.players.length,
    finishedPlayers: new Set(),
  });

  // 🆕 Update schedule status to speaking
  if (groupSchedules.has(groupName)) {
    const schedule = groupSchedules.get(groupName);
    schedule.status = "speaking";
    schedule.isPlaying = true;
    schedule.countdown = 0;
    broadcastScheduleUpdate();
  }

  // Update bot status to running
  groupBotStatus.set(groupName, "running");
  broadcastBotStatusUpdate(groupName, "running");
  console.log(`🤖 Bot status: ${groupName} → RUNNING`);

  // Assign audio and start playback
  await assignAudioToPlayers(group);

  console.log(`\n▶️ Step 4: Sending START_PLAYBACK to group ${groupName}`);

  wss.clients.forEach((client) => {
    if (
      client.role === "player" &&
      client.groupName === groupName &&
      client.readyState === WebSocket.OPEN
    ) {
      client.send(JSON.stringify({ type: "START_PLAYBACK" }));
      console.log(`  ▶️ Sent START_PLAYBACK to ${client.playerName}`);
    }
  });
}

function handlePlayerFinished(msg) {
  const { playerName, groupName } = msg;
  console.log(`✅ Player ${playerName} finished in group ${groupName}`);

  // 🆕 Track finished player
  const playingGroup = playingGroups.get(groupName);
  if (playingGroup) {
    playingGroup.finishedPlayers.add(playerName);
    console.log(
      `📊 ${groupName}: ${playingGroup.finishedPlayers.size}/${playingGroup.totalPlayers} players finished`,
    );

    // 🆕 Check if ALL players finished
    if (playingGroup.finishedPlayers.size === playingGroup.totalPlayers) {
      console.log(`\n🎉 ALL PLAYERS IN GROUP ${groupName} FINISHED SPEAKING!`);

      // 🆕 Set bot status to IDLE immediately
      groupBotStatus.set(groupName, "idle");
      broadcastBotStatusUpdate(groupName, "idle");
      console.log(`🤖 Bot status: ${groupName} → IDLE`);

      // Clean up playing group tracking
      playingGroups.delete(groupName);

      // Trigger regeneration for next cycle
      const group = groups.get(groupName);
      if (group) {
        const allPlayerNames = group.players.map((p) => p.name);
        triggerRegenerationForGroup(groupName, allPlayerNames);
      }
    }
  }

  // Forward to all masters
  broadcastToMasters({
    type: "PLAYER_FINISHED",
    playerName: playerName,
    groupName: groupName,
  });

  console.log(`📤 Forwarded PLAYER_FINISHED to all masters`);
}

// 🆕 Handle bot assignment
function handleAssignBot(msg) {
  const { botName, groupName } = msg;

  const bot = Array.from(bots.values()).find((b) => b.botName === botName);

  if (!bot) {
    console.log(`❌ Bot ${botName} not found`);
    return;
  }

  if (bot.status !== "available" || bot.hasGroup) {
    console.log(`❌ Bot ${botName} is not available`);
    return;
  }

  // Update bot
  bots.set(bot.id, {
    ...bot,
    status: "occupied",
    hasGroup: true,
    groupName: groupName,
  });

  console.log(`✅ Assigned bot ${botName} to group ${groupName}`);

  // Notify the bot
  wss.clients.forEach((client) => {
    if (
      client.role === "bot" &&
      client.botName === botName &&
      client.readyState === WebSocket.OPEN
    ) {
      client.send(
        JSON.stringify({
          type: "BOT_ASSIGNED",
          groupName: groupName,
          sessionStatus: "speaking",
        }),
      );
    }
  });

  // Broadcast updated bot list
  broadcastBotsList();
}

// 🆕 Trigger regeneration (extracted function)
function triggerRegenerationForGroup(groupName, playerNames) {
  // Send to first connected master to handle regeneration
  for (const [, client] of clients) {
    if (client.role === "master" && client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: "TRIGGER_REGENERATION",
          groupName: groupName,
          playerNames: playerNames,
        }),
      );
      console.log(
        `📤 Sent TRIGGER_REGENERATION for group: ${groupName} (via master)`,
      );
      break;
    }
  }
}

async function handleTriggerRegeneration(ws, msg) {
  const { groupName, playerNames } = msg;
  console.log(`\n🔄 TRIGGER_REGENERATION received for group: ${groupName}`);
  console.log(`   Players: ${playerNames.join(", ")}`);

  try {
    await executeRegenerationWorkflow(groupName, playerNames);

    ws.send(
      JSON.stringify({
        type: "REGENERATION_COMPLETE",
        groupName: groupName,
      }),
    );
    console.log(`✅ Sent REGENERATION_COMPLETE to master\n`);

    // 🆕 Reschedule AFTER regeneration completes
    if (groupSchedules.has(groupName)) {
      const nextDelay = getNextCycleDelay(3, 5);
      const hours = Math.floor(nextDelay / 3600);
      const mins = Math.floor((nextDelay % 3600) / 60);

      const nextRunAt = Date.now() + nextDelay * 1000;

      groupSchedules.set(groupName, {
        nextRunAt,
        countdown: nextDelay,
        status: "waiting",
        isPlaying: false,
      });

      console.log(
        `📅 Rescheduled ${groupName}: ${hours}h ${mins}m (next run at ${new Date(
          nextRunAt,
        ).toLocaleTimeString()})`,
      );

      // 🆕 Broadcast updated schedules to all masters
      broadcastScheduleUpdate();
    }
  } catch (error) {
    console.error(`❌ Regeneration failed:`, error);

    ws.send(
      JSON.stringify({
        type: "REGENERATION_ERROR",
        groupName: groupName,
        error: error.message,
      }),
    );
  }
}

// 🆕 Apply schedule settings from master
function handleApplySchedule(msg) {
  const { mode, time, groupNames } = msg;
  console.log(`\n🎚️ APPLY_SCHEDULE received for ${groupNames.length} group(s)`);

  groupNames.forEach((groupName) => {
    let nextRunAt;

    if (mode === "randomize") {
      const delay = getNextCycleDelay();
      nextRunAt = Date.now() + delay * 1000;
      console.log(
        `🎲 Applied randomize to ${groupName}: ${Math.floor(delay / 60)}m ${delay % 60}s`,
      );
    } else if (mode === "time") {
      // Time mode - calculate next occurrence
      const [h, m] = time.split(":").map(Number);
      const now = new Date();
      const next = new Date();
      next.setHours(h, m, 0, 0);

      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }

      nextRunAt = next.getTime();
      console.log(`⏰ Applied time ${time} to ${groupName}`);
    }

    const delay = Math.floor((nextRunAt - Date.now()) / 1000);

    groupSchedules.set(groupName, {
      nextRunAt,
      countdown: delay,
      status: "waiting",
      isPlaying: false,
    });
  });

  console.log(`✅ Applied schedule to ${groupNames.length} group(s)\n`);

  // 🆕 Broadcast updated schedules to all masters
  broadcastScheduleUpdate();
}

// 🆕 Broadcast schedule updates to all masters
function broadcastScheduleUpdate() {
  const schedulesData = {};
  groupSchedules.forEach((schedule, groupName) => {
    schedulesData[groupName] = schedule;
  });

  wss.clients.forEach((client) => {
    if (client.role === "master" && client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: "SCHEDULES_UPDATE",
          schedules: schedulesData,
        }),
      );
    }
  });

  console.log(
    `📤 Broadcast SCHEDULES_UPDATE to all masters (${Object.keys(schedulesData).length} schedules)`,
  );
}

// 🆕 Broadcast bot status to all masters
function broadcastBotStatusUpdate(groupName, status) {
  wss.clients.forEach((client) => {
    if (client.role === "master" && client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: "BOT_STATUS_UPDATE",
          groupName: groupName,
          status: status, // "no bot" | "acquired" | "running" | "idle"
        }),
      );
    }
  });
  console.log(`📤 Broadcast bot status: ${groupName} → ${status}`);
}

// 🆕 Handle bot acquisition from Hidemium
function handleBotAcquired(msg) {
  const { groupName } = msg;
  console.log(`🤖 Bot acquired for group: ${groupName}`);

  // Only set to acquired if not currently running
  if (groupBotStatus.get(groupName) !== "running") {
    groupBotStatus.set(groupName, "acquired");
    broadcastBotStatusUpdate(groupName, "acquired");
    console.log(`🤖 Bot status: ${groupName} → ACQUIRED`);
  }
}

// 🆕 Handle bot release from Hidemium
function handleBotReleased(msg) {
  const { groupName } = msg;
  console.log(`🔓 Bot released for group: ${groupName}`);

  groupBotStatus.delete(groupName);
  broadcastBotStatusUpdate(groupName, "no bot");
  console.log(`🤖 Bot status: ${groupName} → NO BOT`);
}

/* -------------------- HELPER FUNCTIONS -------------------- */

// Broadcast to all masters
function broadcastToMasters(payload) {
  wss.clients.forEach((client) => {
    if (client.role === "master" && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(payload));
    }
  });
}

// 🆕 Get audio files from S3 for a specific user
async function getAudioFilesFromS3(username) {
  try {
    console.log(`🔍 Fetching audio files for: ${username}`);

    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: `audios/current/${username}/`,
    });

    const response = await s3.send(command);

    if (!response.Contents || response.Contents.length === 0) {
      console.warn(`⚠️ No audio files found for ${username}`);
      return [];
    }

    // Filter only audio files and create URLs
    const audioFiles = response.Contents.filter(
      (obj) => obj.Key.endsWith(".mp3") || obj.Key.endsWith(".wav"),
    ).map((obj, index) => ({
      id: index + 1,
      name: obj.Key.split("/").pop(), // Get filename
      url: `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${obj.Key}`,
    }));

    console.log(`✅ Found ${audioFiles.length} audio files for ${username}`);
    return audioFiles;
  } catch (error) {
    console.error(`❌ Error fetching audio from S3:`, error.message);
    return [];
  }
}

// 🆕 Assign audio files to all players in a group
async function assignAudioToPlayers(group) {
  console.log(
    `\n📤 Step 1 & 2: Assigning audio to ${group.players.length} players in group: ${group.name}`,
  );

  for (const player of group.players) {
    try {
      // Find player's WebSocket
      const playerWs = Array.from(wss.clients).find(
        (client) =>
          client.role === "player" &&
          client.clientId === player.clientId &&
          client.readyState === WebSocket.OPEN,
      );

      if (!playerWs) {
        console.warn(`⚠️ Player ${player.name} not connected`);
        continue;
      }

      // Step 1: Get audio files from S3 for this player
      const audioFiles = await getAudioFilesFromS3(player.name);

      if (audioFiles.length === 0) {
        console.warn(`⚠️ No audio files for ${player.name}, skipping...`);
        continue;
      }

      // Step 2: Send audio files directly to player
      playerWs.send(
        JSON.stringify({
          type: "LOAD_AUDIO",
          audioFiles: audioFiles,
        }),
      );

      console.log(
        `✅ Step 2: Sent ${audioFiles.length} audio files to ${player.name}`,
      );

      // Wait a bit for player to receive
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (error) {
      console.error(
        `❌ Error assigning audio to ${player.name}:`,
        error.message,
      );
    }
  }

  console.log(
    `\n✅ Step 2 Complete: Audio sent to all players in ${group.name}`,
  );
  console.log(`⏳ Step 3: Waiting 2 seconds for players to load audio...\n`);

  // Wait for all players to load audio
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

// 🆕 Execute the complete regeneration workflow
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
    await triggerAudioGenerator(groupName, playerNames);

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

/* -------------------- AUDIO REGENERATION WORKFLOW -------------------- */

async function handleAudioRegeneration(group) {
  console.log(`\n═══════════════════════════════════════════════`);
  console.log(`🔄 AUDIO REGENERATION WORKFLOW STARTED`);
  console.log(`   Group: ${group.name}`);
  console.log(`   Players: ${group.players.map((p) => p.name).join(", ")}`);
  console.log(`═══════════════════════════════════════════════\n`);

  try {
    // Step 1: Archive current audios for all players
    for (const player of group.players) {
      await archivePlayerAudios(player.name);
    }

    // Step 2: Trigger Python audio generator (simulation)
    await triggerAudioGenerator(group);

    // Step 3: Upload new audios (simulation)
    for (const player of group.players) {
      await uploadNewAudios(player.name);
    }

    console.log(
      `\n✅ Audio regeneration workflow completed for group ${group.name}!\n`,
    );
  } catch (error) {
    console.error(`❌ Error in audio regeneration workflow:`, error.message);
  }
}

async function archivePlayerAudios(username) {
  console.log(`\n📦 Step 1: Archiving audios for ${username}...`);

  try {
    // List all current audio files
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
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
        Bucket: BUCKET_NAME,
        CopySource: `${BUCKET_NAME}/${file.Key}`,
        Key: archiveKey,
      });

      await s3.send(copyCommand);
      console.log(`   ✅ Archived: ${fileName} → ${archiveKey}`);

      // Delete from current
      const deleteCommand = new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
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

async function triggerAudioGenerator(groupName, playerNames) {
  console.log(`\n🎙️ Step 2: Triggering audio generator...`);
  console.log(`   🐍 Running Python audio generator...`);

  let toGenerateFiles = randomInt(5, 10);

  return new Promise((resolve, reject) => {
    // Build accounts configuration for Python script
    const accounts = playerNames.map((playerName) => ({
      username: playerName,
      audios: toGenerateFiles, // Generate 1 audio file per player
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
        Bucket: BUCKET_NAME,
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

/* -------------------- ROUTES -------------------- */
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "WebSocket server running",
    connectedClients: clients.size,
    totalGroups: groups.size,
  });
});

/* -------------------- MESSAGE HANDLER -------------------- */
function handleMessage(ws, raw) {
  try {
    const msg = JSON.parse(raw);
    console.log(`📨 [${ws.clientId}] Received: ${msg.type}`);

    const handlers = {
      PING: () => ws.send(JSON.stringify({ type: "PONG" })),
      JOIN_MASTER: () => handleJoinMaster(ws),
      JOIN_PLAYER: () => handleJoinPlayer(ws, msg),
      JOIN_BOT: () => handleJoinBot(ws, msg),
      ASSIGN_BOT: () => handleAssignBot(msg),
      RELEASE_BOT: () => handleReleaseBot(msg), // 🆕
      PLAY_AUDIO: () => handlePlayAudio(msg),
      PLAYER_FINISHED: () => handlePlayerFinished(msg),
      TRIGGER_REGENERATION: () => handleTriggerRegeneration(ws, msg),
      BOT_ACQUIRED: () => handleBotAcquired(msg),
      BOT_RELEASED: () => handleBotReleased(msg),
      ADD_SCHEDULE: () => handleAddSchedule(msg),
      APPLY_SCHEDULE: () => handleApplySchedule(msg),
      TOGGLE_AUTO_CYCLE: () => handleToggleAutoCycle(msg),
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

// 🆕 Add schedule for a single group
function handleAddSchedule(msg) {
  const { groupName } = msg;

  console.log(`\n📅 ADD_SCHEDULE received for ${groupName}`);

  const delay = getNextCycleDelay();
  const nextRunAt = Date.now() + delay * 1000;

  groupSchedules.set(groupName, {
    nextRunAt,
    countdown: delay,
    status: "waiting",
    isPlaying: false,
  });

  const hours = Math.floor(delay / 3600);
  const mins = Math.floor((delay % 3600) / 60);
  console.log(
    `✅ Added schedule for ${groupName}: ${hours}h ${mins}m (next run at ${new Date(nextRunAt).toLocaleTimeString()})`,
  );

  // Broadcast updated schedules to all masters
  broadcastScheduleUpdate();
}

// 🆕 Handle bot join
function handleJoinBot(ws, msg) {
  const botName = msg.botName || "anonymous-bot";
  ws.role = "bot";
  ws.botName = botName;

  bots.set(ws.clientId, {
    id: ws.clientId,
    botName,
    status: "available",
    hasGroup: false,
    groupName: null,
  });

  console.log(`🤖 ${ws.clientId} joined as BOT (${botName})`);
  broadcastBotsList();
}

// 🆕 Handle bot release when all players finish
function handleReleaseBot(msg) {
  const { groupName } = msg;
  console.log(`🔓 Releasing bot for group: ${groupName}`);

  // Find bot assigned to this group
  const botEntry = Array.from(bots.entries()).find(
    ([id, bot]) => bot.status === "occupied" && bot.groupName === groupName,
  );

  if (!botEntry) {
    console.log(`⚠️ No bot assigned to group ${groupName}`);
    return;
  }

  const [botId, bot] = botEntry;

  // Update bot status to available
  bots.set(botId, {
    ...bot,
    status: "available",
    hasGroup: false,
    groupName: null,
  });

  console.log(`✅ Bot ${bot.botName} released from group ${groupName}`);

  // Notify the bot
  wss.clients.forEach((client) => {
    if (
      client.role === "bot" &&
      client.botName === bot.botName &&
      client.readyState === WebSocket.OPEN
    ) {
      client.send(
        JSON.stringify({
          type: "BOT_RELEASED",
        }),
      );
      console.log(`📤 Sent BOT_RELEASED to ${bot.botName}`);
    }
  });

  // Broadcast updated bot list
  broadcastBotsList();
}

// 🆕 Broadcast bots list to masters
function broadcastBotsList() {
  const payload = {
    type: "BOT_LIST_UPDATE",
    bots: Array.from(bots.values()),
  };
  wss.clients.forEach((client) => {
    if (client.role === "master" && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(payload));
    }
  });
}

function handleToggleAutoCycle(msg) {
  const { enabled } = msg;
  console.log(`🔄 Auto-Cycle toggled: ${enabled}`);
  // Can add more logic here if needed
}

function handleDisconnect(ws) {
  const { clientId, role, playerName, groupName } = ws;

  // Remove player from group
  if (role === "player" && groupName && groups.has(groupName)) {
    const group = groups.get(groupName);
    group.players = group.players.filter((p) => p.clientId !== clientId);

    console.log(`👋 ${playerName} left group ${groupName}`);

    // Delete group if empty
    if (group.players.length === 0) {
      groups.delete(groupName);
      playingGroups.delete(groupName);
      groupBotStatus.delete(groupName);
      groupSchedules.delete(groupName); // 🆕 Clean up schedule
      console.log(`🗑️ Deleted empty group: ${groupName}`);
    }

    // Broadcast updated groups to all masters
    broadcastToMasters({
      type: "GROUPS_UPDATE",
      groups: Array.from(groups.values()),
    });
    console.log(`📤 Sent GROUPS_UPDATE to masters (player disconnected)`);
  }

  if (role === "bot") {
    // 🆕 remove bot on disconnect
    bots.delete(clientId);
    broadcastBotsList();
  }

  clients.delete(clientId);
  console.log(`🔌 [Disconnected] ${clientId}`);
}

// 🆕 Countdown ticker - runs every second
setInterval(() => {
  const now = Date.now();
  let scheduleChanged = false;

  groupSchedules.forEach((schedule, groupName) => {
    if (schedule.isPlaying) return;

    const remaining = Math.floor((schedule.nextRunAt - now) / 1000);

    if (remaining <= 0) {
      // Time to trigger play
      console.log(`⏰ Auto-triggering PLAY_AUDIO for ${groupName}`);

      schedule.status = "speaking";
      schedule.isPlaying = true;
      schedule.countdown = 0;
      scheduleChanged = true;

      // Initialize playing group tracker
      playingGroups.set(groupName, {
        totalPlayers: groups.get(groupName)?.players.length || 0,
        finishedPlayers: new Set(),
      });

      // Send PLAY_AUDIO command to master
      wss.clients.forEach((client) => {
        if (client.role === "master" && client.readyState === WebSocket.OPEN) {
          client.send(
            JSON.stringify({
              type: "AUTO_PLAY_TRIGGERED",
              groupName: groupName,
            }),
          );
          console.log(`📤 Sent AUTO_PLAY_TRIGGERED to master for ${groupName}`);
        }
      });
    } else {
      // Update countdown
      if (schedule.countdown !== remaining) {
        schedule.countdown = remaining;
        scheduleChanged = true;
      }
    }
  });

  if (scheduleChanged) {
    broadcastScheduleUpdate();
  }
}, 1000);

/* -------------------- START SERVER -------------------- */
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Server running on http://0.0.0.0:${PORT}`);
  console.log(`🔌 WebSocket ready at ws://0.0.0.0:${PORT}/ws\n`);
});
