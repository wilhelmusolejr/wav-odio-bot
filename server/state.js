// ===========================
// GLOBAL STATE
// ===========================

export const state = {
  groups: [
    { name: "Benk", status: "waiting", players: [], bot: null },
    { name: "Bonk", status: "waiting", players: [], bot: null },
  ],
  players: [],
  bots: [],
};

export const audioQueue = {
  queue: [],
  isProcessing: false,
};

// ===========================
// HELPER QUERIES
// ===========================

export function getData() {
  return {
    groups: state.groups,
    players: state.players,
    bots: state.bots,
  };
}

export function findGroup(groupName) {
  return state.groups.find((g) => g.name === groupName);
}

export function findBot(botName) {
  return state.bots.find((b) => b.name === botName);
}

export function findBotByGroup(groupName) {
  return state.bots.find((b) => b.assignedGroup === groupName);
}
