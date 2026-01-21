import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
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

// Middleware
app.use(
  cors({
    origin: "*",
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  }),
);
app.use(express.json());

// Serve audio files statically with CORS headers
app.use(
  "/audio",
  (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.header("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  express.static(path.join(__dirname, "../audio/output")),
);

// Create HTTP server
const server = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Store active clients and groups
const clients = new Map(); // Map of client ID to client data
const groups = new Map(); // Map of group name to group data
let clientIdCounter = 0;

/**
 * Group Structure:
 * {
 *   name: "Group A",
 *   rdpName: "RDP-001",
 *   users: [
 *     { id: "user-1", name: "User 1", isPlaying: false, time: "08:00" },
 *     { id: "user-2", name: "User 2", isPlaying: false, time: "08:00" }
 *   ],
 *   createdAt: Date
 * }
 */

// Groups are created dynamically when players join
// No default groups are initialized

/**
 * Broadcast groups to all connected masters
 */
function broadcastGroupsToMasters() {
  const groupsArray = Array.from(groups.values()).map((group) => ({
    name: group.name,
    rdpName: group.rdpName,
    users: group.users,
    userCount: group.users.length,
  }));

  const message = JSON.stringify({
    type: "UPDATE_GROUPS",
    groups: groupsArray,
  });

  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.role === "master") {
      client.send(message);
    }
  });
}

/**
 * Broadcast to players in a specific group
 */
function broadcastToGroup(groupName, message) {
  const groupData = groups.get(groupName);
  if (!groupData) {
    console.warn(`[Broadcast] Group not found: ${groupName}`);
    return;
  }

  let playerCount = 0;
  wss.clients.forEach((client) => {
    if (
      client.readyState === 1 &&
      client.role === "player" &&
      client.groupName === groupName
    ) {
      playerCount++;
      console.log(
        `[Broadcast] Sending to player ${client.playerName} in group ${groupName}`,
      );
      client.send(JSON.stringify(message));
    }
  });

  console.log(
    `[Broadcast] Sent message to ${playerCount} players in group ${groupName}`,
  );
}

// WebSocket Connection Handler
wss.on("connection", (ws) => {
  const clientId = `client-${++clientIdCounter}`;
  console.log(`[Connected] ${clientId}`);

  ws.clientId = clientId;
  ws.role = null; // "master" or "player"
  ws.groupName = null;
  ws.playerName = null;

  clients.set(clientId, {
    id: clientId,
    ws,
    role: null,
    groupName: null,
    playerName: null,
  });

  // Handle incoming messages
  ws.on("message", (data) => {
    try {
      const message = JSON.parse(data);

      switch (message.type) {
        // Master connects
        case "MASTER_JOIN":
          handleMasterJoin(ws, clientId, message);
          break;

        // Player connects
        case "PLAYER_JOIN":
          handlePlayerJoin(ws, clientId, message);
          break;

        // Group control updates (from master)
        case "UPDATE_GROUP_CONTROL":
          handleGroupControlUpdate(message);
          break;

        // Player control updates
        case "UPDATE_PLAYER_CONTROL":
          handlePlayerControlUpdate(ws, clientId, message);
          break;

        // Heartbeat/ping
        case "PING":
          ws.send(JSON.stringify({ type: "PONG" }));
          break;

        default:
          console.log(`[Unknown message type] ${message.type}`);
      }
    } catch (error) {
      console.error("[Message Error]", error);
    }
  });

  // Handle client disconnect
  ws.on("close", () => {
    handleClientDisconnect(clientId);
  });

  // Handle errors
  ws.on("error", (error) => {
    console.error(`[WebSocket Error] ${clientId}:`, error.message);
  });
});

/**
 * Master joins the connection
 */
function handleMasterJoin(ws, clientId, message) {
  ws.role = "master";
  clients.get(clientId).role = "master";

  console.log(`[Master Joined] ${clientId}`);

  // Send current groups to master
  const groupsArray = Array.from(groups.values()).map((group) => ({
    name: group.name,
    rdpName: group.rdpName,
    users: group.users,
    userCount: group.users.length,
  }));

  ws.send(
    JSON.stringify({
      type: "INITIAL_GROUPS",
      groups: groupsArray,
    }),
  );
}

/**
 * Player joins the connection
 */
function handlePlayerJoin(ws, clientId, message) {
  const { playerName, groupName, rdpName } = message;

  if (!playerName || !groupName) {
    ws.send(
      JSON.stringify({
        type: "ERROR",
        message: "Player name and group name required",
      }),
    );
    return;
  }

  ws.role = "player";
  ws.playerName = playerName;
  ws.groupName = groupName;

  const clientData = clients.get(clientId);
  clientData.role = "player";
  clientData.playerName = playerName;
  clientData.groupName = groupName;

  // Get or create group
  let group = groups.get(groupName);
  if (!group) {
    group = {
      name: groupName,
      rdpName: rdpName || `RDP-${groupName}`,
      users: [],
      createdAt: new Date(),
    };
    groups.set(groupName, group);
  }

  // Add player to group
  const playerInGroup = group.users.find((u) => u.id === clientId);
  if (!playerInGroup) {
    group.users.push({
      id: clientId,
      name: playerName,
      isPlaying: false,
      time: "08:00",
    });
  }

  console.log(
    `[Player Joined] ${playerName} joined ${groupName} (${clientId})`,
  );

  // Send confirmation to player
  ws.send(
    JSON.stringify({
      type: "PLAYER_JOINED",
      clientId,
      groupName,
      rdpName: group.rdpName,
    }),
  );

  // Broadcast updated groups to all masters
  broadcastGroupsToMasters();

  // Broadcast to group
  broadcastToGroup(groupName, {
    type: "PLAYER_JOINED_GROUP",
    playerName,
    userCount: group.users.length,
  });
}

/**
 * Handle group control updates from master
 */
function handleGroupControlUpdate(message) {
  const { groupName, control } = message;
  const group = groups.get(groupName);

  console.log(
    `[Group Control Update] Received from master for group: ${groupName}`,
    control,
  );

  if (group) {
    console.log(`[Group Control] ${groupName}:`, control);

    // Broadcast to all players in the group
    broadcastToGroup(groupName, {
      type: "GROUP_CONTROL_UPDATE",
      control,
    });
  } else {
    console.warn(`[Group Control] Group not found: ${groupName}`);
  }
}

/**
 * Handle player control updates
 */
function handlePlayerControlUpdate(ws, clientId, message) {
  const { isPlaying, time } = message;
  const clientData = clients.get(clientId);

  if (!clientData) return;

  const group = groups.get(clientData.groupName);
  if (!group) return;

  // Update player in group
  const player = group.users.find((u) => u.id === clientId);
  if (player) {
    player.isPlaying = isPlaying;
    if (time) player.time = time;
  }

  console.log(
    `[Player Control] ${clientData.playerName}: isPlaying=${isPlaying}`,
  );

  // Broadcast updated groups to masters
  broadcastGroupsToMasters();
}

/**
 * Handle client disconnect
 */
function handleClientDisconnect(clientId) {
  const clientData = clients.get(clientId);

  if (!clientData) return;

  console.log(
    `[Disconnected] ${clientId} (${clientData.playerName || clientData.role})`,
  );

  // Remove player from group
  if (clientData.role === "player" && clientData.groupName) {
    const group = groups.get(clientData.groupName);
    if (group) {
      group.users = group.users.filter((u) => u.id !== clientId);
      console.log(
        `[Removed] ${clientData.playerName} from ${clientData.groupName}`,
      );

      // Remove empty group
      if (group.users.length === 0) {
        groups.delete(clientData.groupName);
        console.log(`[Group Deleted] ${clientData.groupName} (no players)`);
      }
    }
  }

  clients.delete(clientId);

  // Broadcast updated groups to all masters
  broadcastGroupsToMasters();
}

/**
 * Get audio files for a player
 */
function getPlayerAudios(playerName) {
  try {
    const playerAudioPath = path.join(AUDIO_BASE_PATH, playerName);
    console.log(`[Audio Debug] Looking for audios in: ${playerAudioPath}`);

    // Check if directory exists
    if (!fs.existsSync(playerAudioPath)) {
      console.warn(
        `[Audio Debug] Directory does not exist: ${playerAudioPath}`,
      );
      return [];
    }

    console.log(`[Audio Debug] Directory exists, reading files...`);

    // Read files from directory
    const files = fs.readdirSync(playerAudioPath);
    console.log(`[Audio Debug] Found files: ${files.join(", ")}`);

    // Filter audio files and get their duration
    const audioFiles = files
      .filter((file) => {
        const ext = path.extname(file).toLowerCase();
        const isAudio = [".mp3", ".wav", ".m4a", ".ogg", ".aac"].includes(ext);
        if (!isAudio)
          console.log(`[Audio Debug] Skipping non-audio file: ${file}`);
        return isAudio;
      })
      .map((file) => {
        const filePath = path.join(playerAudioPath, file);
        const stat = fs.statSync(filePath);
        const audioUrl = `/audio/${playerName}/${file}`;
        console.log(
          `[Audio Debug] Mapped file - name: ${file}, url: ${audioUrl}, size: ${stat.size}`,
        );
        return {
          id: file,
          name: file.replace(/\.[^/.]+$/, ""), // Remove extension
          filename: file,
          duration: 180, // Default duration - would need audio library to get actual duration
          size: stat.size,
          url: audioUrl,
        };
      });

    console.log(
      `[Audio Files] Found ${audioFiles.length} audio files for ${playerName}`,
    );
    return audioFiles;
  } catch (error) {
    console.error(
      `[Audio Error] Error reading audios for ${playerName}:`,
      error,
    );
    return [];
  }
}

// HTTP Routes
app.get("/", (req, res) => {
  res.json({
    message: "MERN Stack Server with WebSocket",
    status: "running",
    clients: clients.size,
    groups: groups.size,
  });
});

app.get("/api/groups", (req, res) => {
  const groupsArray = Array.from(groups.values()).map((group) => ({
    name: group.name,
    rdpName: group.rdpName,
    users: group.users,
    userCount: group.users.length,
  }));

  res.json({
    groups: groupsArray,
    totalGroups: groupsArray.length,
  });
});

app.get("/api/audios/:playerName", (req, res) => {
  const { playerName } = req.params;

  // Validate player name
  if (!playerName || playerName.trim() === "") {
    return res.status(400).json({
      error: "Player name is required",
      audios: [],
    });
  }

  const audios = getPlayerAudios(playerName);

  res.json({
    playerName,
    audios,
    count: audios.length,
  });
});

app.get("/api/status", (req, res) => {
  res.json({
    status: "running",
    connectedClients: clients.size,
    groups: groups.size,
    timestamp: new Date(),
  });
});

// Start server
server.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Server running on http://192.168.177.251:${PORT}`);
  console.log(`WebSocket: ws://192.168.177.251:${PORT}`);
  console.log("Ready to accept connections...\n");
});
