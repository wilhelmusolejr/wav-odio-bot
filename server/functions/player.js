import { safeSend } from "./helper.js";

let accounts = [
  {
    username: "botfrag666",
    type: "initiator",
  },
  {
    username: "jeroam",
    type: "respondent",
  },
];

export function joinPlayer(wss, ws, msg, data) {
  let { playerName } = msg;
  let playerType;

  for (const account of accounts) {
    if (account.username === playerName) {
      playerType = account.type;
      break;
    }
  }

  // Player data
  let player = {
    name: playerName,
    type: playerType || "ERROR",
    isConnected: true,
    status: "waiting",
  };

  // Fetch user audios from DB (mocked here)
  let audios = [
    {
      name: "Sample Audio 1",
      url: "https://example.com/audio1.mp3",
      key: "audio1.mp3",
    },
    {
      name: "Sample Audio 2",
      url: "https://example.com/audio2.mp3",
      key: "audio2.mp3",
    },
  ];
  player.audios = audios;

  // Assign player to a group (mocked here)
  let assignedGroupId = null;

  for (const group of data.groups) {
    if (group.status === "waiting" && group.players.length < 2) {
      group.players.push(player);
      assignedGroupId = group.name;

      // Update group status if it's now full
      if (group.players.length === 2) {
        group.status = "occupied";

        group.players.forEach((p) => {
          p.status = "ready";
        });

        // --- NEW: TELL EVERYONE IN THIS GROUP THEY ARE READY ---
        wss.clients.forEach((client) => {
          // Find clients who belong to this specific group
          if (client.group === assignedGroupId && client.readyState === 1) {
            safeSend(client, {
              type: "UPDATE_PLAYERS", // Or "UPDATE_PLAYERS"
              players: group.players,
            });
          }
        });

        // assign bot to group if available
        for (const bot of data.bots) {
          if (bot.status === "available") {
            group.bot = bot;
            bot.status = "assigned";
            break;
          }
        }

        // if no bot available, set group back to waiting_for_bot
        if (!group.bot) {
          group.status = "waiting_for_bot";
        }

        group.players.forEach((p) => {
          p.status = "speaking";
        });

        // --- NEW: TELL EVERYONE IN THIS GROUP THEY ARE SPEAKING ---
        wss.clients.forEach((client) => {
          // Find clients who belong to this specific group
          if (client.group === assignedGroupId && client.readyState === 1) {
            safeSend(client, {
              type: "UPDATE_PLAYERS", // Or "UPDATE_PLAYERS"
              players: group.players,
            });
          }
        });

        console.log(`Group ${group.name} is now full. Players are ready.`);
      }

      break;
    }
  }
  player.groupName = assignedGroupId;

  ws.playerName = playerName;
  ws.group = assignedGroupId;
  ws.role = "player";

  console.log(`Player joined: ${msg.playerName} as ${playerType}`);

  safeSend(ws, {
    type: "JOIN_SUCCESS",
    player,
  });

  broadcastToMasters(wss, {
    type: "STATE_UPDATE",
    data: data,
  });
}

function broadcastToMasters(wss, data) {
  wss.clients.forEach((client) => {
    if (client.role === "master" && client.readyState === 1) {
      safeSend(client, data);
    }
  });
}
