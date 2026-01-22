import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

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
    // Allow all origins for WebSocket connections
    return true;
  },
});

/* -------------------- STATE -------------------- */
const clients = new Map(); // clientId → ws meta
const groups = new Map(); // groupName → { users: [] }
let clientIdCounter = 0;

/* -------------------- HELPERS -------------------- */
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

// Delete audio folder for a player
function deleteAudioFolder(playerName) {
  const folderPath = path.join(AUDIO_BASE_PATH, playerName);

  console.log(`🔍 Attempting to delete: ${folderPath}`);

  return new Promise((resolve, reject) => {
    try {
      if (fs.existsSync(folderPath)) {
        console.log(`✅ Folder exists, deleting...`);
        fs.rmSync(folderPath, { recursive: true, force: true });
        console.log(`🗑️ Successfully deleted: ${folderPath}`);
        resolve();
      } else {
        console.log(`⚠️ Folder does not exist: ${folderPath}`);
        resolve();
      }
    } catch (error) {
      console.error(`❌ Error deleting ${folderPath}:`, error);
      reject(error);
    }
  });
}

// Run Python audio generator script
function runPythonScript() {
  return new Promise((resolve, reject) => {
    const pythonScript = path.join(__dirname, "../audio/main.py");
    const audioDir = path.join(__dirname, "../audio");

    console.log(`🐍 Running: ${pythonScript}`);

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
        console.log(`✅ Python script completed`);
        resolve();
      } else {
        console.error(`❌ Python script failed with code ${code}`);
        reject(new Error(`Python failed: code ${code}`));
      }
    });

    pythonProcess.on("error", (error) => {
      console.error(`❌ Failed to start Python:`, error);
      reject(error);
    });
  });
}

// Generate random time 3-6 hours from now
function generateRandomTime(minHours = 3, maxHours = 6) {
  const now = new Date();
  const randomHours = Math.random() * (maxHours - minHours) + minHours;
  const futureTime = new Date(now.getTime() + randomHours * 60 * 60 * 1000);

  const hours = String(futureTime.getHours()).padStart(2, "0");
  const minutes = String(futureTime.getMinutes()).padStart(2, "0");

  return `${hours}:${minutes}`;
}

// Handle complete session cycle
async function handleSessionComplete(group) {
  console.log(`\n🔄 SESSION CYCLE START: ${group.name}`);

  try {
    // Step 1: Delete audio folders
    console.log(`📁 Step 1/3: Deleting audio folders...`);
    const deletePromises = group.users.map((user) =>
      deleteAudioFolder(user.name),
    );
    await Promise.all(deletePromises);

    // Step 2: Run Python script (fire-and-forget, don't wait)
    console.log(`🐍 Step 2/3: Starting Python audio generator (background)...`);
    runPythonScript().catch((err) => console.error("Python error:", err)); // ✅ No await

    // Step 3: Generate random time immediately
    console.log(`⏰ Step 3/3: Generating new schedule...`);
    const newTime = generateRandomTime(3, 6);
    console.log(`✅ New time: ${newTime}`);

    // Reset and notify
    group.users.forEach((user) => (user.hasFinishedPlaying = false));

    broadcastToMasters({
      type: "SESSION_CYCLE_COMPLETE",
      groupName: group.name,
      newScheduledTime: newTime,
    });

    console.log(`✅ SESSION CYCLE COMPLETE: ${group.name}\n`);
  } catch (error) {
    console.error(`❌ SESSION CYCLE ERROR:`, error);
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

      /* 🔥 FIXED MESSAGE TYPE */
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

          // Start session cycle (delete → regenerate → reschedule)
          console.log(`🚀 Triggering session cycle for ${group.name}...`);
          handleSessionComplete(group).catch((err) => {
            console.error(`❌ Session cycle failed:`, err);
          });
        }
        break;
      }

      case "PING":
        ws.send(JSON.stringify({ type: "PONG" }));
        break;

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
