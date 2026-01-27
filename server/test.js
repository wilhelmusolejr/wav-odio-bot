let group = [
  {
    name: "bonk",
    player: [],
    bot: bot,
    isOccupied: false, // true or false
    status: "available", //  "available", "waiting", "in-progress", "breaktime"
  },
  {
    name: "benk",
    player: [],
    bot: bot,
    isOccupied: false, // true or false
    status: "available", //  "available", "waiting", "in-progress", "breaktime"
  },
];

let players = [];

let player = {
  name: "player1",
  isConnected: undefined, // true or false
  status: undefined, // "waiting", "speaking", "finished"
};

let bot = {
  name: "bot1",
  isConnected: undefined, // true or false
};

let data = {
  groups: group,
  players: player,
  bots: bot,
};

let dataBonk = {
  groupId: "group_001",
  status: "waiting" | "waiting_for_bot" | "occupied" | "completed",
  members: {
    initiator: {
      socketId: "socket_abc",
      playerId: "player_123",
      name: "Alice",
      type: "initiator",
      status: "connected" | "ready" | "speaking" | "completed",
      files: ["file1.pdf", "file2.txt"], // from S3
    },
    respondent: {
      socketId: "socket_def",
      playerId: "player_456",
      name: "Bob",
      type: "respondent",
      status: "connected" | "ready" | "speaking" | "completed",
      files: ["file3.pdf"],
    },
    bot:
      null |
      {
        botId: "bot_789",
        status: "assigned" | "working" | "completed",
      },
  },
  createdAt: "2026-01-28T10:00:00Z",
  startedAt: null | "2026-01-28T10:05:00Z",
};
