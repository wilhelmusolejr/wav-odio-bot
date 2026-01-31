import path from "path";
import { spawn } from "child_process";
import { state, audioQueue, findGroup, findBotByGroup, getData } from "./state.js";
import { broadcastToGroup, broadcastToMasters, sendToBot } from "./utils.js";
import { archivePlayerAudios, uploadNewAudios } from "./functions/audio.js";

// ===========================
// BOT SERVICES
// ===========================

export function releaseBot(wss, group) {
  if (!group.bot) return;

  const bot = findBotByGroup(group.name);
  if (!bot) return;

  bot.status = "available";
  bot.sessionStatus = "done";
  bot.assignedGroup = null;

  console.log(`Bot ${bot.name} released from group ${group.name}`);

  sendToBot(wss, bot.name, { type: "STATE_UPDATE", bot });
}

// ===========================
// GROUP SERVICES
// ===========================

export async function handlePlayerFinished(wss, playerName, groupName) {
  const group = findGroup(groupName);
  if (!group) return console.error(`Group ${groupName} not found`);

  const player = group.players.find((p) => p.name === playerName);
  if (!player) return console.error(`Player ${playerName} not found`);

  player.status = "done";
  console.log(`Player ${playerName} finished in group ${groupName}`);

  broadcastToGroup(wss, groupName, { type: "UPDATE_PLAYERS", players: group.players });

  // Check if ALL players done
  if (group.players.every((p) => p.status === "done")) {
    console.log(`All players in group ${groupName} done`);
    await handleGroupCompletion(wss, group);
  }

  broadcastToMasters(wss, { type: "STATE_UPDATE", data: getData() });
}

async function handleGroupCompletion(wss, group) {
  // Mark all as finished
  group.players.forEach((p) => (p.status = "finished"));
  broadcastToGroup(wss, group.name, { type: "UPDATE_PLAYERS", players: group.players });

  // Save players for audio processing
  const playersCopy = [...group.players];

  // Release bot and reset group
  releaseBot(wss, group);
  group.status = "waiting";
  group.bot = null;
  group.players = [];

  console.log(`Group ${group.name} reset to waiting`);

  // Queue audio generation
  addToAudioQueue(playersCopy, group.name);
}

export function removePlayerFromGroup(wss, playerName, groupName) {
  const group = findGroup(groupName);
  if (!group) return;

  group.players = group.players.filter((p) => p.name !== playerName);
  state.players = state.players.filter((p) => p.name !== playerName);

  if (group.players.length === 0) {
    group.status = "waiting";
    if (group.bot) {
      releaseBot(wss, group);
      group.bot = null;
    }
  }

  broadcastToGroup(wss, groupName, { type: "UPDATE_PLAYERS", players: group.players });
  broadcastToMasters(wss, { type: "STATE_UPDATE", data: getData() });
}

// ===========================
// AUDIO SERVICES
// ===========================

const PYTHON_SCRIPT = path.join(process.cwd(), "..", "new_audio", "conversation.py");
const NUM_FILES = 5;

export function addToAudioQueue(players, groupName) {
  audioQueue.queue.push({ players, groupName, timestamp: new Date() });
  console.log(`📝 Queued audio for ${groupName} (${audioQueue.queue.length} in queue)`);

  if (!audioQueue.isProcessing) {
    processAudioQueue();
  }
}

async function processAudioQueue() {
  if (audioQueue.isProcessing || audioQueue.queue.length === 0) return;

  audioQueue.isProcessing = true;

  while (audioQueue.queue.length > 0) {
    const { players, groupName } = audioQueue.queue.shift();
    console.log(`\n🎵 Processing audio for ${groupName}`);

    try {
      await processAudioGeneration(players);
      console.log(`✅ Audio done for ${groupName}`);
    } catch (error) {
      console.error(`❌ Audio failed for ${groupName}:`, error);
    }
  }

  audioQueue.isProcessing = false;
  console.log(`\n✅ Audio queue empty`);
}

async function processAudioGeneration(players) {
  // 1. Archive old audios
  for (const player of players) {
    await archivePlayerAudios(player.name);
  }

  // 2. Generate new audios
  const playerNames = players.map((p) => p.name);
  await generateLocalAudio(playerNames, NUM_FILES);

  // 3. Upload to S3
  for (const name of playerNames) {
    await uploadNewAudios(name);
  }

  console.log(`Audio done for: ${playerNames.join(", ")}`);
}

function generateLocalAudio(playerNames, numFiles) {
  return new Promise((resolve, reject) => {
    console.log(`Running: python ${PYTHON_SCRIPT} --usernames ${playerNames.join(" ")}`);

    const python = spawn("python", [
      PYTHON_SCRIPT,
      "--usernames", ...playerNames,
      "--num-files", numFiles.toString(),
    ], { env: { ...process.env, PYTHONIOENCODING: "utf-8" } });

    python.stdout.on("data", (d) => console.log(`[Python]: ${d}`));
    python.stderr.on("data", (d) => console.error(`[Python Error]: ${d}`));

    python.on("close", (code) => {
      code === 0 ? resolve() : reject(new Error(`Python exited with ${code}`));
    });

    python.on("error", reject);
  });
}
