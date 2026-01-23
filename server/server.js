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
const groupFinishedPlayers = new Map(); // Track finished players per group
let clientIdCounter = 0;

/* -------------------- WEBSOCKET -------------------- */
wss.on("connection", (ws, req) => {
  const clientId = `client-${++clientIdCounter}`;
  const clientIP = req.socket.remoteAddress;

  ws.clientId = clientId;
  ws.role = null;
  ws.playerName = null;
  ws.groupName = null;

  clients.set(clientId, ws);
  console.log(`✅ [Connected] ${clientId} from ${clientIP}`);

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw);
      console.log(`📨 [${clientId}] Received: ${msg.type}`);

      switch (msg.type) {
        case "PING":
          ws.send(JSON.stringify({ type: "PONG" }));
          break;

        case "JOIN_MASTER":
          ws.role = "master";
          console.log(`🎛️ ${clientId} is now a MASTER`);

          // Send initial groups
          ws.send(
            JSON.stringify({
              type: "INITIAL_GROUPS",
              groups: Array.from(groups.values()),
            }),
          );
          break;

        case "JOIN_PLAYER": {
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
            clientId: clientId,
            name: playerName,
          });

          console.log(`✅ ${playerName} joined group ${groupName}`);
          console.log(
            `📊 Group ${groupName} now has ${group.players.length} players`,
          );

          // Send success to player
          ws.send(
            JSON.stringify({
              type: "JOIN_SUCCESS",
              clientId: clientId,
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
          break;
        }

        case "PLAY_AUDIO": {
          const { groupName } = msg;
          console.log(
            `\n🎵 PLAY_AUDIO command received for group: ${groupName}`,
          );

          const group = groups.get(groupName);
          if (!group) {
            console.error(`❌ Group not found: ${groupName}`);
            return;
          }

          // Step 1 & 2: Assign audio to each player in the group
          assignAudioToPlayers(group).then(() => {
            // Step 4: After audio is loaded, send play command
            console.log(
              `\n▶️ Step 4: Sending START_PLAYBACK to group ${groupName}`,
            );

            wss.clients.forEach((client) => {
              if (
                client.role === "player" &&
                client.groupName === groupName &&
                client.readyState === WebSocket.OPEN
              ) {
                client.send(
                  JSON.stringify({
                    type: "START_PLAYBACK",
                  }),
                );
                console.log(`  ▶️ Sent START_PLAYBACK to ${client.playerName}`);
              }
            });
          });
          break;
        }

        case "AUDIO_FINISHED": {
          const { playerName, groupName } = msg;
          console.log(
            `✅ ${playerName} finished playing audio in ${groupName}`,
          );

          // Broadcast to all masters
          broadcastToMasters({
            type: "AUDIO_FINISHED",
            playerName: playerName,
            groupName: groupName,
            timestamp: new Date().toISOString(),
          });

          // Track finished players
          if (!groupFinishedPlayers.has(groupName)) {
            groupFinishedPlayers.set(groupName, new Set());
          }
          groupFinishedPlayers.get(groupName).add(playerName);

          // Check if all players in group have finished
          const group = groups.get(groupName);
          if (group) {
            const finishedPlayers = groupFinishedPlayers.get(groupName);
            const allFinished = group.players.every((player) =>
              finishedPlayers.has(player.name),
            );

            if (allFinished) {
              console.log(
                `\n🎉 All players in group ${groupName} have finished!`,
              );
              console.log(
                `📢 Waiting for master to trigger regeneration (no auto-run on server)\n`,
              );

              // Clear finished players for this group; master will coordinate regeneration
              groupFinishedPlayers.delete(groupName);
            }
          }
          break;
        }

        case "PLAYER_FINISHED": {
          const { playerName, groupName } = msg;
          console.log(`✅ Player ${playerName} finished in group ${groupName}`);

          // Forward to all masters
          broadcastToMasters({
            type: "PLAYER_FINISHED",
            playerName: playerName,
            groupName: groupName,
          });

          console.log(`📤 Forwarded PLAYER_FINISHED to all masters`);
          break;
        }

        case "TRIGGER_REGENERATION": {
          const { groupName, playerNames } = msg;
          console.log(
            `\n🔄 TRIGGER_REGENERATION received for group: ${groupName}`,
          );
          console.log(`   Players: ${playerNames.join(", ")}`);

          executeRegenerationWorkflow(groupName, playerNames)
            .then(() => {
              // Notify master that regeneration is complete
              ws.send(
                JSON.stringify({
                  type: "REGENERATION_COMPLETE",
                  groupName: groupName,
                }),
              );
              console.log(`✅ Sent REGENERATION_COMPLETE to master\n`);
            })
            .catch((error) => {
              console.error(`❌ Regeneration failed:`, error);
              ws.send(
                JSON.stringify({
                  type: "REGENERATION_ERROR",
                  groupName: groupName,
                  error: error.message,
                }),
              );
            });
          break;
        }

        default:
          console.log(`⚠️ Unknown message type: ${msg.type}`);
      }
    } catch (error) {
      console.error(`❌ Error parsing message:`, error.message);
    }
  });

  ws.on("close", () => {
    // Remove player from group
    if (ws.role === "player" && ws.groupName && groups.has(ws.groupName)) {
      const group = groups.get(ws.groupName);
      group.players = group.players.filter((p) => p.clientId !== clientId);

      console.log(`👋 ${ws.playerName} left group ${ws.groupName}`);

      // Delete group if empty
      if (group.players.length === 0) {
        groups.delete(ws.groupName);
        console.log(`🗑️ Deleted empty group: ${ws.groupName}`);
      }

      // 🆕 Broadcast updated groups to all masters
      broadcastToMasters({
        type: "GROUPS_UPDATE",
        groups: Array.from(groups.values()),
      });
      console.log(`📤 Sent GROUPS_UPDATE to masters (player disconnected)`);
    }

    clients.delete(clientId);
    console.log(`🔌 [Disconnected] ${clientId}`);
  });

  ws.on("error", (error) => {
    console.error(`❌ [Error] ${clientId}:`, error.message);
  });
});

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

/* -------------------- START SERVER -------------------- */
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Server running on http://0.0.0.0:${PORT}`);
  console.log(`🔌 WebSocket ready at ws://0.0.0.0:${PORT}/ws\n`);
});
