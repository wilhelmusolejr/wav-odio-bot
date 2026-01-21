# MERN Stack Server - WebSocket Backend

## Features

- **WebSocket Server** - Real-time communication between master and players
- **Group Management** - Organize players into RDP groups
- **Player Management** - Track player connections and status
- **Broadcasting** - Send updates to specific groups or all masters
- **REST API** - Get groups and server status via HTTP

## Installation

```bash
npm install
```

## Running the Server

**Development** (with auto-reload):

```bash
npm run dev
```

**Production**:

```bash
npm start
```

Server will run on `http://localhost:8080`

## WebSocket Message Types

### Master Messages

**Join as Master:**

```json
{
  "type": "MASTER_JOIN"
}
```

Response receives current groups:

```json
{
  "type": "INITIAL_GROUPS",
  "groups": [
    {
      "name": "Group A",
      "rdpName": "RDP-Session-001",
      "users": [...],
      "userCount": 0
    }
  ]
}
```

**Update Group Control:**

```json
{
  "type": "UPDATE_GROUP_CONTROL",
  "groupName": "Group A",
  "control": {
    "isPlaying": true,
    "time": "08:30"
  }
}
```

### Player Messages

**Join as Player:**

```json
{
  "type": "PLAYER_JOIN",
  "playerName": "User Alpha",
  "groupName": "Group A",
  "rdpName": "RDP-Session-001"
}
```

**Update Player Control:**

```json
{
  "type": "UPDATE_PLAYER_CONTROL",
  "isPlaying": true,
  "time": "08:30"
}
```

## REST API Endpoints

- `GET /` - Server status
- `GET /api/groups` - Get all groups
- `GET /api/status` - Get connection status

## Architecture

```
Master (WebSocket) → Server → Broadcasting to Players
                            → Broadcasting to all Masters
```

- Master connects and receives all groups
- Players connect with name and group
- Server groups players by group name
- Updates broadcast in real-time
- Disconnections automatically handled
