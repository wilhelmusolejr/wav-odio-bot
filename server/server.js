import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { createReadStream } from "fs";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUDIO_BASE_PATH = path.join(__dirname, "../audio/output");

const app = express();
const PORT = process.env.PORT || 8080;

/* -------------------- MIDDLEWARE -------------------- */
app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.use(express.json());

app.use(
  "/audio",
  (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(AUDIO_BASE_PATH),
);

/* -------------------- SERVER -------------------- */
const server = createServer(app);
const wss = new WebSocketServer({
  server,
  path: "/ws",
  verifyClient: (info) => {
    return true;
  },
});

/* -------------------- STATE -------------------- */
const clients = new Map();
const groups = new Map();
let clientIdCounter = 0;

/* -------------------- S3 CLIENT -------------------- */
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = "bucket-kita-laham";

/* -------------------- S3 HELPERS -------------------- */

// 📊 Get audio count AND file details from S3
async function getS3AudioDetails(username) {
  try {
    console.log(`🔍 Checking S3 audio for: ${username}`);

    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: `audios/current/${username}/`,
    });

    const response = await s3.send(command);
    const audioFiles = (response.Contents || [])
      .filter((obj) => obj.Key.endsWith(".mp3") || obj.Key.endsWith(".wav"))
      .map((obj) => ({
        filename: obj.Key.split("/").pop(),
        s3Key: obj.Key,
        s3Url: `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${obj.Key}`,
        size: obj.Size,
        lastModified: obj.LastModified,
      }));

    console.log(`📊 ${username} has ${audioFiles.length} audio files in S3`);
    return { count: audioFiles.length, files: audioFiles };
  } catch (error) {
    console.error(`❌ Error checking S3 for ${username}:`, error.message);
    return { count: 0, files: [] };
  }
}

// 📊 Check audio balance with file details
async function checkGroupAudioBalance(group) {
  console.log(`\n📋 Checking audio balance for group: ${group.name}`);

  const audioCounts = await Promise.all(
    group.users.map(async (user) => {
      const details = await getS3AudioDetails(user.name);
      return {
        username: user.name,
        count: details.count,
        files: details.files, // ✅ Include file details
      };
    }),
  );

  const maxCount = Math.max(...audioCounts.map((u) => u.count), 0);
  const playersNeedingAudio = audioCounts.filter((u) => u.count < maxCount);

  console.log(`\n📊 Audio Balance Report:`);
  audioCounts.forEach(({ username, count, files }) => {
    const status = count < maxCount ? "⚠️ NEEDS AUDIO" : "✅ OK";
    console.log(`   ${status} ${username}: ${count} files`);

    // ✅ Log first 3 filenames as preview
    if (files.length > 0) {
      const preview = files
        .slice(0, 3)
        .map((f) => f.filename)
        .join(", ");
      console.log(`      Files: ${preview}${files.length > 3 ? "..." : ""}`);
    }
  });
  console.log(`   Max count: ${maxCount}`);
  console.log(`   Players needing audio: ${playersNeedingAudio.length}\n`);

  return { audioCounts, maxCount, playersNeedingAudio };
}

// 📤 Upload single file to S3
async function uploadToS3(filePath, key) {
  const fileStream = createReadStream(filePath);

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: fileStream,
    ContentType: "audio/mpeg",
  });

  await s3.send(command);
  console.log("✅ Uploaded to S3:", key);
}

// 📤 Upload entire folder to S3
async function uploadFolderToS3(username, s3Prefix = `current/${username}/`) {
  const localDir = path.join(AUDIO_BASE_PATH, username);

  if (!fs.existsSync(localDir)) {
    console.log(`⚠️ Local folder not found: ${localDir}`);
    return;
  }

  const files = fs.readdirSync(localDir);
  console.log(`📤 Uploading ${files.length} files for ${username} to S3...`);

  for (const file of files) {
    const fullPath = path.join(localDir, file);
    if (fs.statSync(fullPath).isFile()) {
      await uploadToS3(fullPath, `${s3Prefix}${file}`);
    }
  }

  console.log(`✅ All files uploaded for ${username}`);
}

// 📦 Archive S3 files (move current → archived with timestamp)
async function archiveS3Audio(username) {
  try {
    const timestamp = new Date().toISOString().replace(/:/g, "-").split(".")[0];
    const currentPrefix = `current/${username}/`;
    const archivePrefix = `archived/${username}/${timestamp}/`;

    console.log(
      `📦 Archiving ${username} from ${currentPrefix} to ${archivePrefix}`,
    );

    // List current files
    const listCommand = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: currentPrefix,
    });
    const { Contents } = await s3.send(listCommand);

    if (!Contents || Contents.length === 0) {
      console.log(`⚠️ No files to archive for ${username}`);
      return;
    }

    // Copy to archive and delete from current
    for (const obj of Contents) {
      const filename = obj.Key.replace(currentPrefix, "");

      // Copy to archive
      await s3.send(
        new CopyObjectCommand({
          Bucket: BUCKET_NAME,
          CopySource: `${BUCKET_NAME}/${obj.Key}`,
          Key: `${archivePrefix}${filename}`,
        }),
      );

      // Delete from current
      await s3.send(
        new DeleteObjectCommand({
          Bucket: BUCKET_NAME,
          Key: obj.Key,
        }),
      );
    }

    console.log(`✅ Archived ${Contents.length} files for ${username}`);
  } catch (error) {
    console.error(`❌ Error archiving ${username}:`, error.message);
  }
}

/* -------------------- AUDIO GENERATION -------------------- */

// 🗑️ Delete local audio folder
function deleteAudioFolder(playerName) {
  const folderPath = path.join(AUDIO_BASE_PATH, playerName);
  console.log(`🗑️ Deleting local folder: ${folderPath}`);

  return new Promise((resolve, reject) => {
    try {
      if (fs.existsSync(folderPath)) {
        fs.rmSync(folderPath, { recursive: true, force: true });
        console.log(`✅ Deleted: ${folderPath}`);
        resolve();
      } else {
        console.log(`⚠️ Folder doesn't exist: ${folderPath}`);
        resolve();
      }
    } catch (error) {
      console.error(`❌ Error deleting ${folderPath}:`, error);
      reject(error);
    }
  });
}

// 🐍 Run Python audio generator
function runPythonScript() {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, "../audio/main.py");
    const audioDir = path.join(__dirname, "../audio");

    console.log(`🐍 Running Python script: ${pythonScript}`);

    const pythonProcess = spawn("python", ["main.py"], {
      cwd: audioDir,
      shell: true,
    });

    pythonProcess.stdout.on("data", (data) => {
      console.log(`[Python] ${data.toString().trim()}`);
    });

    pythonProcess.stderr.on("data", (data) => {
      console.error(`[Python Error] ${data.toString().trim()}`);
    });

    pythonProcess.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ Python script completed successfully`);
        resolve();
      } else {
        console.error(`❌ Python script failed with exit code ${code}`);
        reject(new Error(`Python failed: code ${code}`));
      }
    });

    pythonProcess.on("error", (error) => {
      console.error(`❌ Failed to start Python process:`, error);
      reject(error);
    });
  });
}

// 🔄 Generate → Upload → Delete cycle
async function generateAndUploadAudio(usernames) {
  console.log(
    `\n🔄 Starting generate & upload cycle for: ${usernames.join(", ")}`,
  );

  // 1. Generate locally
  console.log(`🐍 Step 1/3: Generating audio files...`);
  await runPythonScript();

  // 2. Upload to S3
  console.log(`📤 Step 2/3: Uploading to S3...`);
  for (const username of usernames) {
    await uploadFolderToS3(username, `current/${username}/`);
  }

  // 3. Delete local files
  console.log(`🗑️ Step 3/3: Cleaning up local files...`);
  for (const username of usernames) {
    await deleteAudioFolder(username);
  }

  console.log(`✅ Generate & upload cycle complete!\n`);
}

/* -------------------- OTHER HELPERS -------------------- */

function broadcastToMasters(payload) {
  wss.clients.forEach((c) => {
    if (c.readyState === 1 && c.role === "master") {
      c.send(JSON.stringify(payload));
    }
  });
}

function broadcastToGroup(groupName, payload) {
  wss.clients.forEach((c) => {
    if (
      c.readyState === 1 &&
      c.role === "player" &&
      c.groupName === groupName
    ) {
      c.send(JSON.stringify(payload));
    }
  });
}

function generateRandomTime(minHours = 3, maxHours = 6) {
  const now = new Date();
  const randomHours = Math.random() * (maxHours - minHours) + minHours;
  const futureTime = new Date(now.getTime() + randomHours * 60 * 60 * 1000);

  const hours = String(futureTime.getHours()).padStart(2, "0");
  const minutes = String(futureTime.getMinutes()).padStart(2, "0");

  return `${hours}:${minutes}`;
}

/* -------------------- SESSION CYCLE -------------------- */

async function handleSessionComplete(group) {
  console.log(`\n🔄 ===== SESSION CYCLE START: ${group.name} =====`);

  try {
    // Step 1: Archive current S3 audio
    console.log(`\n📦 Step 1/3: Archiving S3 audio...`);
    await Promise.all(group.users.map((user) => archiveS3Audio(user.name)));

    // Step 2: Generate new audio for ALL players
    console.log(`\n🐍 Step 2/3: Generating new audio for all players...`);
    const allUsernames = group.users.map((u) => u.name);
    await generateAndUploadAudio(allUsernames);

    // Step 3: Generate new countdown
    console.log(`\n⏰ Step 3/3: Generating new schedule...`);
    const newTime = generateRandomTime(3, 6);
    console.log(`✅ New scheduled time: ${newTime}`);

    // Reset and notify
    group.users.forEach((user) => (user.hasFinishedPlaying = false));

    broadcastToGroup(group.name, {
      type: "REFRESH_AUDIO_LIST",
      message: "New audio files generated and uploaded",
    });

    broadcastToMasters({
      type: "SESSION_CYCLE_COMPLETE",
      groupName: group.name,
      newScheduledTime: newTime,
    });

    console.log(`\n✅ ===== SESSION CYCLE COMPLETE: ${group.name} =====\n`);
  } catch (error) {
    console.error(`\n❌ SESSION CYCLE ERROR:`, error);
    broadcastToMasters({
      type: "SESSION_CYCLE_ERROR",
      groupName: group.name,
      error: error.message,
    });
  }
}

/* -------------------- WEBSOCKET -------------------- */
wss.on("connection", (ws, req) => {
  const clientId = `client-${++clientIdCounter}`;
  const clientIP = req.socket.remoteAddress;
  ws.clientId = clientId;
  ws.role = null;
  ws.groupName = null;
  ws.playerName = null;

  clients.set(clientId, ws);
  console.log(`[Connected] ${clientId} from ${clientIP}`);

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw);

    switch (msg.type) {
      case "MASTER_JOIN": {
        ws.role = "master";
        ws.send(
          JSON.stringify({
            type: "INITIAL_GROUPS",
            groups: Array.from(groups.values()),
          }),
        );
        break;
      }

      case "PLAYER_JOIN": {
        const { playerName, groupName, rdpName } = msg;

        ws.role = "player";
        ws.playerName = playerName;
        ws.groupName = groupName;

        if (!groups.has(groupName)) {
          groups.set(groupName, {
            name: groupName,
            rdpName,
            users: [],
          });
        }

        const group = groups.get(groupName);
        group.users.push({
          id: clientId,
          name: playerName,
          hasFinishedPlaying: false,
        });

        ws.send(
          JSON.stringify({
            type: "PLAYER_JOINED",
            clientId,
            groupName,
            playerName,
            rdpName,
          }),
        );

        broadcastToMasters({
          type: "UPDATE_GROUPS",
          groups: Array.from(groups.values()),
        });
        break;
      }

      case "UPDATE_GROUP_CONTROL": {
        const { groupName, control } = msg;
        const group = groups.get(groupName);
        if (!group) return;

        if (control.isPlaying === true) {
          group.users.forEach((u) => (u.hasFinishedPlaying = false));
        }

        broadcastToGroup(groupName, {
          type: "GROUP_CONTROL_UPDATE",
          control,
        });
        break;
      }

      case "PLAYER_FINISHED_PLAYING": {
        console.log(`📩 Player finished playing message received`);
        const group = groups.get(ws.groupName);
        if (!group) {
          console.log(`⚠️ Group not found: ${ws.groupName}`);
          return;
        }

        const player = group.users.find((u) => u.id === clientId);
        if (player) {
          player.hasFinishedPlaying = true;
          console.log(`✅ Marked player ${player.name} as finished`);
        }

        const finishedCount = group.users.filter(
          (u) => u.hasFinishedPlaying,
        ).length;
        const totalCount = group.users.length;
        console.log(
          `📊 Group ${group.name}: ${finishedCount}/${totalCount} finished`,
        );

        const allFinished = group.users.every((u) => u.hasFinishedPlaying);

        if (allFinished) {
          console.log(
            `🎉 [Group Complete] ${group.name} - ALL PLAYERS FINISHED!`,
          );

          broadcastToMasters({
            type: "GROUP_PLAYBACK_COMPLETE",
            groupName: group.name,
          });

          console.log(`🚀 Triggering session cycle for ${group.name}...`);
          handleSessionComplete(group).catch((err) => {
            console.error(`❌ Session cycle failed:`, err);
          });
        }
        break;
      }

      // 🆕 Test endpoint to check audio balance
      case "CHECK_AUDIO_BALANCE": {
        const { groupName } = msg;
        const group = groups.get(groupName);

        if (!group) {
          ws.send(
            JSON.stringify({
              type: "ERROR",
              message: `Group not found: ${groupName}`,
            }),
          );
          return;
        }

        console.log(
          `\n🔍 Manual audio balance check requested for: ${groupName}`,
        );
        checkGroupAudioBalance(group)
          .then(async (result) => {
            // Send balance result to master
            ws.send(
              JSON.stringify({
                type: "AUDIO_BALANCE_RESULT",
                groupName,
                result,
              }),
            );

            // 🆕 Now assign audio to players for testing
            console.log(`\n📤 Assigning audio to players in ${groupName}...`);
            await assignAudioToGroup(group);
          })
          .catch((err) => {
            console.error(`❌ Error checking balance:`, err);
            ws.send(
              JSON.stringify({
                type: "ERROR",
                message: err.message,
              }),
            );
          });
        break;
      }

      case "PING":
        ws.send(JSON.stringify({ type: "PONG" }));
        break;

      case "ASSIGN_GROUP_AUDIO": {
        const { groupName } = msg;
        console.log(`\n🎵 Assigning audio for group: ${groupName}`);

        const group = groups.get(groupName);
        if (!group) {
          console.error(`❌ Group not found: ${groupName}`);
          return;
        }

        // Assign audio to each player in the group
        assignAudioToGroup(group).catch((err) => {
          console.error(`❌ Error assigning audio:`, err);
          ws.send(
            JSON.stringify({
              type: "ERROR",
              message: `Failed to assign audio: ${err.message}`,
            }),
          );
        });
        break;
      }

      case "READY_TO_PLAY": {
        const { playerName, groupName } = msg;
        console.log(`✅ Player ${playerName} is ready to play`);

        const group = groups.get(groupName);
        if (!group) return;

        // Mark player as ready
        const player = group.users.find((u) => u.name === playerName);
        if (player) {
          player.isReady = true;
        }

        // Check if all players are ready
        const allReady = group.users.every((u) => u.isReady);
        const readyCount = group.users.filter((u) => u.isReady).length;

        console.log(
          `📊 Group ${groupName}: ${readyCount}/${group.users.length} players ready`,
        );

        if (allReady) {
          console.log(`🎉 All players in ${groupName} are ready!`);

          // Notify master that all players are ready
          broadcastToMasters({
            type: "ALL_PLAYERS_READY",
            groupName: groupName,
          });

          // Reset ready states for next cycle
          setTimeout(() => {
            group.users.forEach((u) => (u.isReady = false));
          }, 1000);
        }
        break;
      }

      case "START_GROUP_PLAYBACK": {
        const { groupName } = msg;
        console.log(`\n▶️ START_GROUP_PLAYBACK request for: ${groupName}`);

        const group = groups.get(groupName);
        if (!group) {
          console.error(`❌ Group not found: ${groupName}`);
          return;
        }

        // Send play command to all players in the group
        broadcastToGroup(groupName, {
          type: "START_PLAYBACK",
        });

        console.log(`✅ Sent START_PLAYBACK to all players in ${groupName}`);
        break;
      }

      default:
        console.log("[Unknown message]", msg.type);
    }
  });

  ws.on("close", () => {
    const wsData = clients.get(clientId);
    if (!wsData) return;

    if (wsData.role === "player") {
      const group = groups.get(wsData.groupName);
      if (group) {
        group.users = group.users.filter((u) => u.id !== clientId);
        if (group.users.length === 0) groups.delete(wsData.groupName);
      }
    }

    clients.delete(clientId);
    broadcastToMasters({
      type: "UPDATE_GROUPS",
      groups: Array.from(groups.values()),
    });
    console.log(`[Disconnected] ${clientId}`);
  });
});

/* -------------------- AUDIO ASSIGNMENT -------------------- */

// Assign audio files from S3 to all players in a group
async function assignAudioToGroup(group) {
  console.log(`\n🔄 Starting audio assignment for group: ${group.name}`);

  try {
    // Get audio details for each player
    for (const user of group.users) {
      const audioDetails = await getS3AudioDetails(user.name);

      if (audioDetails.count === 0) {
        console.warn(`⚠️ No audio files found for ${user.name}`);
        continue;
      }

      console.log(`📤 Assigning ${audioDetails.count} files to ${user.name}`);

      // Find the player's WebSocket connection
      const playerWs = Array.from(wss.clients).find(
        (client) =>
          client.role === "player" &&
          client.playerName === user.name &&
          client.groupName === group.name,
      );

      if (!playerWs || playerWs.readyState !== WebSocket.OPEN) {
        console.warn(`⚠️ Player ${user.name} not connected`);
        continue;
      }

      // Send audio files to player
      playerWs.send(
        JSON.stringify({
          type: "ASSIGN_AUDIO",
          audioFiles: audioDetails.files,
        }),
      );

      console.log(`✅ Sent ${audioDetails.count} audio files to ${user.name}`);
    }

    console.log(`✅ Audio assignment complete for group: ${group.name}\n`);
  } catch (error) {
    console.error(`❌ Error in assignAudioToGroup:`, error);
    throw error;
  }
}

/* -------------------- AUDIO API -------------------- */
function getPlayerAudios(playerName) {
  const dir = path.join(AUDIO_BASE_PATH, playerName);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir).map((file) => ({
    id: file,
    name: file.replace(/\.[^/.]+$/, ""),
    url: `/audio/${playerName}/${file}`,
    duration: 180,
  }));
}

app.get("/api/audios/:playerName", (req, res) => {
  res.json({
    audios: getPlayerAudios(req.params.playerName),
  });
});

/* -------------------- ERROR HANDLING -------------------- */
wss.on("error", (error) => {
  console.error("❌ WebSocket Server Error:", error);
});

/* -------------------- START -------------------- */
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  console.log(`🔌 WebSocket server ready at ws://0.0.0.0:${PORT}/ws`);
});
