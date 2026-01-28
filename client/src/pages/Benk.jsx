import React, { useEffect, useRef, useState } from "react";
import Orbs from "../components/Orbs";
import { use } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8080/ws";
const DEFAULT_GROUP_NAME = "Bonk";

export default function Benk() {
  const ws = useRef(null);

  const [isConnected, setIsConnected] = useState(false);
  const [playerAudios, setPlayerAudios] = useState([]);
  const [selectedAudios, setSelectedAudios] = useState(new Set());
  const [playerName, setPlayerName] = useState("");
  const [showModal, setShowModal] = useState(!playerName);
  const [playerData, setPlayerData] = useState(null);
  const [groupName, setGroupName] = useState("");

  useEffect(() => {
    ws.current = new WebSocket(WS_URL);

    ws.current.onopen = () => {
      setIsConnected(true);
    };

    ws.current.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);

        switch (msg.type) {
          case "CONNECTED":
            console.log("🎉 Connected as player:", msg.message);
            break;

          case "JOIN_SUCCESS":
            setShowModal(false);
            setPlayerData(msg.player);
            setPlayerAudios(msg.player.audios || []);
            setGroupName(msg.player.groupName || DEFAULT_GROUP_NAME);
            break;

          case "UPDATE_PLAYERS":
            console.log("🔄 Player data updated");
            for (const player of msg.players) {
              console.log(player.name, playerName);
              if (player.name === playerName) {
                console.log(player);
                setPlayerData(player);
                break;
              }
            }
            break;

          default:
            console.log("⚠️ Unknown message type:", msg.type);
            break;
        }
      } catch (error) {
        console.error("❌ Failed to parse WebSocket message:", error);
      }
    };

    ws.current.onerror = (err) => console.error("Player WebSocket error:", err);
    ws.current.onclose = () => setIsConnected(false);

    return () => {
      ws.current?.close();
    };
  }, [playerName]);

  const handleCheckboxChange = (key) => {
    const newSelected = new Set(selectedAudios);
    if (newSelected.has(key)) {
      newSelected.delete(key);
    } else {
      newSelected.add(key);
    }
    setSelectedAudios(newSelected);
  };

  const handleSubmitPlayerName = (e) => {
    e.preventDefault();
    ws.current.send(
      JSON.stringify({
        type: "JOIN_PLAYER",
        playerName: playerName,
      }),
    );
  };

  useEffect(() => {
    if (
      ws.current?.readyState !== WebSocket.OPEN ||
      playerAudios.length === 0
    ) {
      return;
    }

    if (selectedAudios.size === playerAudios.length) {
      console.log("All audios selected");

      const allSelected =
        selectedAudios.size > 0 && selectedAudios.size === playerAudios.length;

      if (allSelected) {
        console.log("All audios selected");
        ws.current.send(
          JSON.stringify({
            type: "PLAYER_FINISHED",
            playerName,
            groupName: groupName,
          }),
        );
      }
    }
  }, [selectedAudios, playerAudios, playerName]);

  const getAudioKey = (audio, idx) =>
    audio.key || audio.id || audio.path || `audio-${idx}`;

  const selectedCount = selectedAudios.size;
  const totalCount = playerAudios.length;

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-gradient-to-br from-black via-zinc-900 to-black text-white">
      <Orbs />

      {/* Player Name Modal */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50 backdrop-blur-sm bg-black/50">
          <div className="bg-white/10 border border-white/20 rounded-2xl p-8 shadow-2xl max-w-md w-full mx-4 backdrop-blur-md">
            <h2 className="text-3xl font-bold text-white mb-2">
              Enter Player Name
            </h2>
            <p className="text-white/60 text-sm mb-6">
              Please enter your player name to continue
            </p>

            <form onSubmit={handleSubmitPlayerName} className="space-y-4">
              <input
                type="text"
                id="username"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="e.g., botfrag666"
                list="playerList"
                className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:border-indigo-500 focus:bg-white/10 transition-colors"
                autoFocus
              />
              <datalist id="playerList">
                <option value="botfrag666" />
                <option value="jeroam" />
              </datalist>

              <button
                type="submit"
                disabled={!playerName.trim()}
                className="w-full px-4 py-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-white/20 disabled:cursor-not-allowed text-white font-semibold transition-colors"
              >
                Continue
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto pt-28 pb-16 px-4">
        <header className="text-center mb-10">
          <h1 className="text-5xl font-semibold">Player Dashboard</h1>
          <p className="text-white/60 mt-2 text-sm">Audio list</p>
        </header>

        <div className="bg-white/5 border border-white/10 rounded-xl p-5 shadow-xl backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-[11px] uppercase text-white/40 tracking-[0.2em]">
                Group
              </p>
              <h2 id="groupName" className="text-2xl font-bold">
                {groupName}
              </h2>
              <p
                id="playerStatus"
                className="text-xs text-blue-400 font-semibold mt-1"
              >
                {playerData?.status}
              </p>
              <p>{playerName}</p>
              <p>
                Is master?{" "}
                <span className="" id="initiator">
                  {playerData?.isMaster ? "true" : "false"}
                </span>
              </p>
            </div>
            <span className="px-3 py-1 rounded-full bg-white/5 text-white/70 border border-white/10 text-sm">
              {selectedCount} / {playerAudios.length} audios
            </span>
          </div>

          <div className="divide-y divide-white/5 border border-white/5 rounded-lg overflow-hidden">
            {playerAudios.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-white/50">
                No audio files queued.
              </div>
            )}

            {playerAudios.map((audio, idx) => {
              const audioKey = getAudioKey(audio, idx);

              return (
                <div
                  key={audioKey}
                  className="px-4 audio-item py-3 hover:bg-white/[0.03] transition-colors flex items-start gap-3"
                >
                  <input
                    type="checkbox"
                    checked={selectedAudios.has(audioKey)}
                    onChange={() => handleCheckboxChange(audioKey)}
                    className="w-5 h-5 rounded border border-white/30 cursor-pointer accent-indigo-500 mt-0.5"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">
                      {audio.name}
                    </p>
                    <p className="text-[11px] text-white/40 break-all url">
                      {audio.url}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="absolute top-6 right-6">
        <div className="flex items-center gap-3">
          <div
            className={`h-3 w-3 rounded-full ${
              isConnected ? "bg-green-400" : "bg-red-400"
            }`}
          />
          <p className="uppercase font-medium text-sm">
            {isConnected ? "Connected" : "Disconnected"}
          </p>
        </div>
      </div>
    </div>
  );
}
