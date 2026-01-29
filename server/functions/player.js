import { isMaster } from "cluster";
import { getAudioFilesFromS3 } from "./audio.js";
import { safeSend } from "./helper.js";
import dotenv from "dotenv";
dotenv.config();

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

export async function joinPlayer(wss, ws, msg, data) {
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
    isMaster: false,
  };

  // Fetch user audios from DB (mocked here)
  let audiosFromS3 = await getAudioFilesFromS3(playerName);
  player.audios = audiosFromS3;

  // Assign player to a group (mocked here)
  let assignedGroupId = null;

  for (const group of data.groups) {
    if (group.status === "waiting" && group.players.length < 2) {
      // Check if this group already has a player of the same type
      const hasSameType = group.players.some((p) => p.type === player.type);

      // Skip this group if it already has a player of the same type
      if (hasSameType) {
        continue;
      }

      group.players.push(player);
      assignedGroupId = group.name;

      // Update group status if it's now full
      if (group.players.length === 2) {
        group.status = "occupied";

        group.players.forEach((p) => {
          p.status = "ready";
        });

        // choose random player and set isMaster to true
        const randomIndex = Math.floor(Math.random() * group.players.length);
        group.players[randomIndex].isMaster = true;

        // --- TELL EVERYONE IN THIS GROUP THEY ARE READY ---
        wss.clients.forEach((client) => {
          if (client.group === assignedGroupId && client.readyState === 1) {
            safeSend(client, {
              type: "UPDATE_PLAYERS",
              players: group.players,
            });
          }
        });

        // assign bot to group if available
        for (const bot of data.bots) {
          if (bot.status === "available") {
            group.bot = bot;
            bot.status = "assigned";
            bot.assignedGroup = group.name;
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

        // --- TELL EVERYONE IN THIS GROUP THEY ARE SPEAKING ---
        wss.clients.forEach((client) => {
          if (client.group === assignedGroupId && client.readyState === 1) {
            safeSend(client, {
              type: "UPDATE_PLAYERS",
              players: group.players,
            });
          }
        });

        // tell bot to start session
        wss.clients.forEach((client) => {
          if (
            client.role === "bot" &&
            group.bot &&
            client.botName === group.bot.name &&
            client.readyState === 1
          ) {
            safeSend(client, {
              type: "STATE_UPDATE",
              bot: group.bot,
            });
          }
        });

        console.log(`Group ${group.name} is now full. Players are ready.`);
      }

      break;
    }
  }

  player.groupName = assignedGroupId;
  ws.group = assignedGroupId;
  data.players.push(player);

  console.log(`Player joined: ${msg.playerName} as ${playerType}`);

  // BROADCAST UPDATED STATE TO MASTERS
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
