import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
        const group = groups.get(ws.groupName);
        if (!group) return;

        const player = group.users.find((u) => u.id === clientId);
        if (player) player.hasFinishedPlaying = true;

        const allFinished = group.users.every((u) => u.hasFinishedPlaying);

        if (allFinished) {
          console.log(`[Group Complete] ${group.name}`);

          broadcastToMasters({
            type: "GROUP_PLAYBACK_COMPLETE",
            groupName: group.name,
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
