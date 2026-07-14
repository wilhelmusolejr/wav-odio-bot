# CLAUDE.md

Guidance for working in this repository.

## What this project is

`wav-odio-bot` is a real-time system for **grouping players, generating synthetic voice audio, and streaming it back to them over WebSockets**. It coordinates "players" into fixed groups, assigns a bot to a full group, plays audio, and (on completion) regenerates per-player audio and pushes it to AWS S3.

It has three independent parts:

| Part | Stack | Role |
|------|-------|------|
| `server/` | Node.js (Express + `ws` WebSocket + Mongoose/MongoDB + AWS S3) | Central coordinator. Manages group/player/bot state, serves REST APIs, drives audio generation. |
| `client/` | React 18 + Vite + Tailwind + React Router + Framer Motion | Browser UI for players, master (control panel), and bots (`hidemium`). |
| `audio/` | Python 3.12 (numpy, librosa, soundfile, requests + FFmpeg) | Generates long-form `.ogg` voice audio from clip banks, spawned as a child process by the server. |

`new_audio/` is an unfinished/experimental Python rewrite of the audio pipeline — not wired into the server. `test.js` and `server/_old/` are scratch files.

## Architecture / data flow

```
Player (browser) ──JOIN_PLAYER──▶ WebSocket server ──assigns──▶ Group (Benk/Bonk/Wonk/Ponk)
                                        │
                                        ├─ fetch this player's audio from S3 (random subset) AT JOIN TIME
                                        │
                                        ├─ group full (group.capacity) ──▶ pick random master, assign available bot
                                        │                                    statuses go waiting → ready → speaking
                                        │
Master (browser) ──JOIN_MASTER──▶ receives INITIAL_STATE + STATE_UPDATE broadcasts
Bot   (browser) ──JOIN_BOT─────▶ receives session start commands
                                        │
                        all players PLAYER_FINISHED
                                        │
                                        ▼
                            group resets to "waiting", bot released,
                            audio regeneration queued (processAudioGeneration — currently stubbed/TODO)
```

- **State is in-memory** (`server/state.js`) — 4 hardcoded groups (`Benk`, `Bonk`, `Wonk`, `Ponk`), plus `players` and `bots` arrays. Restarting the server wipes all state.
- **WebSocket roles** (`ws.role`): `player`, `master`, `bot`. Messages are routed by `type` in `server/handlers.js`.
- **Audio generation** is triggered two ways: (1) on-demand via `POST /api/generate-audio` (fully implemented, spawns Python then uploads to S3), and (2) automatically when a group completes (`server/services.js` → `processAudioGeneration`, which is currently a **TODO stub** — the real steps are commented out).
- The Python generator fetches per-user config (`voiceType`, `backgroundNoise`) from `POST /api/accounts`, falling back to `audio/profiles.json` if the API is unreachable.

## Player join lifecycle (how a player gets a group + audio)

Handled entirely by `joinPlayer` in `server/functions/player.js`. The player pages (`Benk.jsx`, `player.jsx`) are thin: they send `JOIN_PLAYER` and render whatever the server returns.

1. Player page sends `{ type: "JOIN_PLAYER", playerName }` over WebSocket (`Benk.jsx:83`).
2. Server looks up the account in MongoDB to get `voiceType` (`player.js:17`).
3. **Server fetches this player's audio from S3 right here, at join time** — `getRandomAudioFiles(playerName, NO_AUDIO)` (`player.js:39`). This is independent of group/status; it happens even while the player is still `waiting`.
4. Server auto-assigns the player to the first `waiting` group with room (`group.players.length < group.capacity`).
5. When a group hits `group.capacity`, the server auto-elects a **random master**, flips statuses `waiting → ready → speaking`, and assigns an available **bot** (or sets `waiting_for_bot` if none). All group members are notified via `UPDATE_PLAYERS`.
6. Server replies to the joining player with `JOIN_SUCCESS` containing the full `player` object (including its `audios` array).

Important: the `speaking` status does **not** trigger any audio fetch — the S3 lookup already happened in step 3. On the client, the `UPDATE_PLAYERS` handler only updates the status/role badge, it does not re-fetch (`Benk.jsx:42-52`).

## How audio reaches a player (S3 URL flow)

**The server only provides links, not audio bytes.** The browser downloads the actual audio directly from S3.

```
S3 bucket ──ListObjectsV2 (keys only)──▶ Server builds public URLs ──WS──▶ Browser ──plays URL──▶ downloads bytes from S3
```

- `getAudioFilesFromS3` (`functions/audio.js:29`) lists objects under `audios/current/<username>/` and maps each to `{ id, name, url }`, where `url` is a public `https://<bucket>.s3.<region>.amazonaws.com/<key>` link (`audio.js:52-58`). It never downloads the audio.
- `getRandomAudioFiles` (`audio.js:80`) Fisher-Yates shuffles that list and returns `NO_AUDIO` of them.
- The browser fetches the bytes itself when playing, so **objects must be publicly readable** — no auth sits between the browser and S3.
- The server only handles real audio **bytes** in the other direction — generation/upload: `uploadNewAudios` (`audio.js:141`) `PutObject`s local `.ogg` files into S3; `deletePlayerAudios` (`audio.js:99`) removes them.

## Group capacity

Each group has a `capacity` field in `server/state.js` — how many players fill it before it becomes `occupied` and a master is elected. **Currently set to `2`** for every group. To change one group, edit its `capacity` in `state.js`; groups can differ. If a group has no `capacity`, it falls back to the `NO_PLAYER` env var. The comparison lives in `server/functions/player.js` (`const capacity = group.capacity ?? NO_PLAYER`).

## Key files

**Server**
- `server/index.js` — entry point. Express app, REST routes, WebSocket server (`/ws`), and the `/api/generate-audio` pipeline. (Run via `npm run dev` from root, or `node index.js` from `server/`.)
- `server/handlers.js` — WebSocket message router + disconnect handling.
- `server/services.js` — group lifecycle (player finished → group completion → bot release → audio queue).
- `server/functions/player.js` — `joinPlayer`: group assignment, master election, bot assignment, S3 audio fetch.
- `server/functions/audio.js` — all S3 operations (list/get random/delete/upload) via `@aws-sdk/client-s3`.
- `server/state.js` — in-memory state + audio queue + lookup helpers.
- `server/models/Account.js` — Mongoose schema: `username`, `password`, `discordName`, `voiceType`, `backgroundNoise`, `playerType`.
- `server/addAccount.js` — standalone script to seed accounts into MongoDB (edit the array at the bottom, then `node addAccount.js`).

**Client** (`client/src/`)
- `App.jsx` — routes: `/` → `Bonk`, `/benk` → `Benk`, `/master`, `/player`, `/hidemium/:botName` (bot).
- `hooks/usePlayerWebSocket.js` — player WS connection + auto-join + heartbeat.
- `pages/` — one file per role/view. `hooks/useAudioPlayer.js`, `utils/audioUtils.js` handle playback.

**Audio**
- `audio/audio_generator_improved.py` — the generator invoked by the server. CLI: `python audio_generator_improved.py <username> [count]`. Reads clips from `agent_voices/profile/<voice_type>/<round>/`, sequences "rounds" with probabilistic pacing, normalizes, exports WAV → OGG/Opus via FFmpeg into `audio/output/<username>/`.
- `audio/profiles.json` — fallback voice/noise config keyed by username.

## Running the project

The root `package.json` runs the **server + client together** with one command (via `concurrently`). This is the normal way to run everything.

```bash
npm run install:all   # first time only: installs root + server + client deps
npm run dev           # starts server (nodemon) AND client (Vite) together
```

- `[server]` logs (cyan): `http://localhost:8080`, WebSocket `ws://localhost:8080/ws`
- `[client]` logs (magenta): `http://localhost:5173` ← open this in the browser
- `Ctrl+C` once stops **both** (concurrently runs with `-k`).

Root scripts:

| Command | Does |
|---------|------|
| `npm run dev` | Server (nodemon) + client (Vite) together — use for development |
| `npm start` | Production: `node index.js` + Vite `preview` |
| `npm run install:all` | Install root + server + client deps in one shot |
| `npm run server` / `npm run client` | Run just one side |

To run a part on its own instead: `cd server && npm run dev` or `cd client && npm run dev`.

## Setup

Prerequisites: **Node.js**, a **MongoDB** instance (on Windows this repo uses the local `MongoDB` service on `127.0.0.1:27017`), and — only for the audio pipeline — **Python 3.12+**, **FFmpeg** on PATH, and an **AWS S3** bucket.

**Environment files** (both git-ignored; already created in this working copy):

`server/.env`:
```
PORT=8080
MONGODB_URI=mongodb://127.0.0.1:27017/wavodio   # or an Atlas mongodb+srv URI
AWS_REGION=ap-southeast-2
AWS_BUCKET_NAME=<bucket>          # blank = run without S3 (players get 0 audios)
AWS_ACCESS_KEY_ID=<key>
AWS_SECRET_ACCESS_KEY=<secret>
NO_PLAYER=2        # fallback group capacity (per-group capacity lives in state.js)
NO_AUDIO=5         # random audio files fetched per player
```
Group size is set per-group via `capacity` in `server/state.js` (currently `2`); `NO_PLAYER` is only the fallback. See **Group capacity** above.
The server calls `process.exit(1)` if it can't reach MongoDB, so `MONGODB_URI` must be valid before it will boot. AWS keys may be left blank — the app still runs, players just receive 0 audio files.

`client/.env` (template in `client/.env copy`):
```
VITE_WS_URL=ws://localhost:8080/ws
VITE_API_URL=http://localhost:8080
```

**Audio pipeline** (optional — only needed to actually generate/upload audio):
```bash
cd audio
pip install -r requirements.txt   # numpy, librosa, soundfile, requests
```
Also requires FFmpeg installed separately and populated voice clip banks under `audio/agent_voices/profile/<voice_type>/<round>/` (rounds: `greetings`, `round_start`, `strategy`, `enemy_info`, `random`, `round_result`). The server spawns Python automatically; to run standalone: `python audio_generator_improved.py <username> 3`.

**Seed accounts** — the DB starts empty and players look up their `voiceType` by username. Edit the array at the bottom of `server/addAccount.js`, then run `node addAccount.js` from `server/`.

## REST API (server)

- `GET /` — health check (`OK`).
- `POST /api/accounts` — `{ usernames: [...] }` → account docs (password excluded). Used by the Python generator.
- `GET /api/accounts/all` — usernames + discord names (for the generation UI).
- `POST /api/generate-audio` — `{ usernames: [...], numFiles: 1-100 }`. Returns immediately, then per user: delete local → spawn Python → upload to S3 → clean up local.

## WebSocket messages

Client → server `type`s: `PING`, `ECHO`, `JOIN_PLAYER`, `PLAYER_FINISHED`, `JOIN_BOT`, `JOIN_MASTER`.
Server → client `type`s: `CONNECTED`, `PONG`, `JOIN_SUCCESS`, `INITIAL_STATE`, `STATE_UPDATE`, `UPDATE_PLAYERS`, `LOAD_AUDIO`, `START_PLAYBACK`, `ERROR`.

(Note: `server/README.md` documents an older message protocol — `handlers.js` is the source of truth.)

## Gotchas

- The server entry point is `index.js` (not `server.js` — that file doesn't exist). The npm scripts have been fixed to point at `index.js`.
- In-memory state (`server/state.js`) means a server restart drops all groups/players/bots.
- Automatic post-game audio regeneration (`processAudioGeneration` in `services.js`) is a **stub** — only the manual `/api/generate-audio` path actually generates audio.
- `client/vite.config.js` uses `host: true` (binds all interfaces). It still lists a specific ngrok host in `allowedHosts` — harmless locally, update if you use a different tunnel.
- Several client pages (e.g. `Bonk.jsx`) hardcode `http://localhost:8080` instead of using `VITE_API_URL`.
- Audio files (`*.mp3/*.wav/*.ogg`), `.env`, and `node_modules` are git-ignored.
- CORS on the server is locked to `http://localhost:5173`.
