// ===========================
// HELPER FUNCTIONS
// ===========================

export function safeSend(ws, data) {
  try {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(data));
    }
  } catch (error) {
    console.error("Error sending message:", error.message);
  }
}

export function parseMessage(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ===========================
// BROADCAST FUNCTIONS
// ===========================

export function broadcastToGroup(wss, groupName, message) {
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

export function broadcastToMasters(wss, message) {
  wss.clients.forEach((client) => {
    if (client.role === "master" && client.readyState === 1) {
      safeSend(client, message);
    }
  });
}

export function sendToBot(wss, botName, message) {
  wss.clients.forEach((client) => {
    if (
      client.role === "bot" &&
      client.botName === botName &&
      client.readyState === 1
    ) {
      safeSend(client, message);
    }
  });
}
