// ===========================
// GLOBAL STATE
// ===========================

export const state = {
  // `capacity` = how many players fill this group before it becomes "occupied"
  // and a master is elected. Set per-group here (falls back to NO_PLAYER env).
  groups: [
    { name: "Benk", status: "waiting", players: [], bot: null, capacity: 2 },
    { name: "Bonk", status: "waiting", players: [], bot: null, capacity: 2 },
    { name: "Wonk", status: "waiting", players: [], bot: null, capacity: 2 },
    { name: "Ponk", status: "waiting", players: [], bot: null, capacity: 2 },
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
