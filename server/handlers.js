import { state, getData } from "./state.js";
import { safeSend, parseMessage, broadcastToMasters } from "./utils.js";
import { handlePlayerFinished, removePlayerFromGroup } from "./services.js";
import { joinPlayer } from "./functions/player.js";

// ===========================
// MESSAGE ROUTER
// ===========================

export function handleMessage(wss, ws, raw) {
  const msg = parseMessage(raw);
  if (!msg) {
    safeSend(ws, { type: "ERROR", message: "Invalid JSON" });
    return;
  }

  switch (msg.type) {
    // UTILITY
    case "PING":
      safeSend(ws, { type: "PONG" });
      break;

    case "ECHO":
      safeSend(ws, { type: "ECHO", data: msg.data ?? null });
      break;

    // PLAYER
    case "JOIN_PLAYER":
      ws.role = "player";
      ws.playerName = msg.playerName;
      joinPlayer(wss, ws, msg, getData());
      break;

    case "PLAYER_FINISHED":
      console.log(`Player finished: ${msg.playerName} in ${msg.groupName}`);
      handlePlayerFinished(wss, msg.playerName, msg.groupName);
      break;

    // BOT
    case "JOIN_BOT":
      ws.role = "bot";
      ws.botName = msg.botName || "anonymous-bot";

      const bot = {
        name: msg.botName,
        status: "available",
        sessionStatus: "idle",
        assignedGroup: null,
        isConnected: true,
      };
      state.bots.push(bot);

      safeSend(ws, { type: "JOIN_SUCCESS", bot });
      broadcastToMasters(wss, { type: "STATE_UPDATE", data: getData() });
      break;

    // MASTER
    case "JOIN_MASTER":
      ws.role = "master";
      safeSend(ws, { type: "INITIAL_STATE", data: getData() });
      break;

    // UNKNOWN
    default:
      safeSend(ws, { type: "ERROR", message: `Unknown type: ${msg.type}` });
  }
}

// ===========================
// DISCONNECT HANDLER
// ===========================

export function handleDisconnect(wss, ws) {
  if (ws.role === "player" && ws.group) {
    removePlayerFromGroup(wss, ws.playerName, ws.group);
  }

  if (ws.role === "bot") {
    const bot = state.bots.find((b) => b.name === ws.botName);
    if (bot) {
      bot.isConnected = false;
      bot.status = "disconnected";
      broadcastToMasters(wss, { type: "STATE_UPDATE", data: getData() });
    }
  }
}
