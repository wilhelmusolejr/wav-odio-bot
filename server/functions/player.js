import { isMaster } from "cluster";
import { getAudioFilesFromS3 } from "./audio.js";
import { safeSend } from "./helper.js";
import { Account } from "../models/Account.js";
import dotenv from "dotenv";
dotenv.config();

export async function joinPlayer(wss, ws, msg, data) {
  let { playerName } = msg;
  let voiceType;

  // Fetch user from database
  try {
    const account = await Account.findOne({ username: playerName });
    if (account) {
      voiceType = account.voiceType;
    } else {
      console.warn(`User '${playerName}' not found in database`);
      voiceType = "ERROR";
    }
  } catch (error) {
    console.error(`Error fetching user '${playerName}':`, error);
    voiceType = "ERROR";
  }

  // Player data
  let player = {
    name: playerName,
    voiceType: voiceType || "ERROR",
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
    if (group.status === "waiting" && group.players.length < 5) {
      group.players.push(player);
      assignedGroupId = group.name;

      // Update group status if it's now full
      if (group.players.length === 5) {
        group.status = "occupied";

        group.players.forEach((p) => {
          p.status = "ready";
        });

        // choose random player and set isMaster to true
        const isMasterIndex = Math.floor(Math.random() * group.players.length);
        group.players.forEach((p, i) => {
          p.isMaster = i === isMasterIndex;
        });

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

  // If no available group, assign to a random group as non-master
  if (!assignedGroupId) {
    const randomIndex = Math.floor(Math.random() * data.groups.length);
    const randomGroup = data.groups[randomIndex];
    randomGroup.players.push(player);
    assignedGroupId = randomGroup.name;
    player.isMaster = false;
    player.status = randomGroup.status === "waiting" ? "waiting" : "speaking";
    console.log(`No available group. Assigned ${playerName} to random group ${assignedGroupId}`);

    // Notify group members about the new player
    wss.clients.forEach((client) => {
      if (client.group === assignedGroupId && client.readyState === 1) {
        safeSend(client, {
          type: "UPDATE_PLAYERS",
          players: randomGroup.players,
        });
      }
    });
  }

  player.groupName = assignedGroupId;
  ws.group = assignedGroupId;
  data.players.push(player);

  console.log(`Player joined: ${msg.playerName} with voice ${voiceType}`);

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
