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
    <div className="relative min-h-screen w-full overflow-hidden bg-gradient-to-br from-black via-zinc-900 to-black text-white font-sans">
      <Orbs />

      {/* Player Name Modal */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50 backdrop-blur-md bg-black/60 transition-all">
          <div className="bg-zinc-900/80 border border-white/10 rounded-3xl p-10 shadow-2xl max-w-md w-full mx-4">
            <div className="mb-8">
              <h2 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-500">
                Welcome
              </h2>
              <p className="text-zinc-400 mt-2">
                Identify yourself to join the session.
              </p>
            </div>

            <form onSubmit={handleSubmitPlayerName} className="space-y-6">
              <div className="relative">
                <input
                  type="text"
                  id="username"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Enter your handle..."
                  list="playerList"
                  className="w-full px-5 py-4 rounded-xl bg-white/5 border border-white/10 text-white placeholder-white/20 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-lg"
                  autoFocus
                />
                <datalist id="playerList">
                  <option value="botfrag666" />
                  <option value="jeroam" />
                </datalist>
              </div>

              <button
                type="submit"
                disabled={!playerName.trim()}
                className="w-full py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed font-bold text-lg transition-all shadow-lg shadow-indigo-500/20"
              >
                Enter Dashboard
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="max-w-4xl mx-auto pt-20 pb-16 px-6">
        {/* Header Section */}
        <header className="flex items-end justify-between mb-12">
          <div>
            <h1 className="text-4xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-zinc-500 font-medium">Session Management</p>
          </div>
          <div className="flex items-center gap-3 bg-white/5 px-4 py-2 rounded-full border border-white/10">
            <div
              className={`h-2 w-2 rounded-full ${isConnected ? "bg-green-400 animate-pulse" : "bg-red-400"}`}
            />
            <span className="text-xs font-bold uppercase tracking-widest text-zinc-300">
              {isConnected ? "Live" : "Offline"}
            </span>
          </div>
        </header>

        {/* Info Card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl">
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
              Current Group
            </p>
            <p className="text-xl font-bold truncate">
              {groupName || "Assigning..."}
            </p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl">
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
              Status
            </p>
            <div className="flex items-center gap-2">
              <span
                className={`text-xl font-bold ${playerData?.status === "ready" ? "text-green-400" : "text-indigo-400"}`}
              >
                {playerData?.status || "Waiting"}
              </span>
              {playerData?.status !== "ready" && (
                <div className="h-1 w-1 bg-indigo-400 rounded-full animate-ping" />
              )}
            </div>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-xl">
            <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
              Role
            </p>
            <p className="text-xl font-bold">
              {playerData?.isMaster ? "👑 Master" : "👤 Player"}
            </p>
          </div>
        </div>

        {/* Audio List Container */}
        <div className="bg-zinc-900/50 border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
          <div className="px-8 py-6 border-b border-white/10 flex justify-between items-center bg-white/5">
            <h3 className="font-bold text-lg">Audio Library</h3>
            <span className="text-sm font-medium bg-indigo-500/20 text-indigo-300 px-3 py-1 rounded-lg border border-indigo-500/30">
              {selectedCount} Selected
            </span>
          </div>

          <div className="max-h-[500px] overflow-y-auto custom-scrollbar">
            {playerAudios.length === 0 ? (
              <div className="py-20 text-center">
                <p className="text-zinc-500 italic">
                  No audio files found in your bucket.
                </p>
              </div>
            ) : (
              playerAudios.map((audio, idx) => {
                const audioKey = getAudioKey(audio, idx);
                const isSelected = selectedAudios.has(audioKey);

                return (
                  <label
                    key={audioKey}
                    className={`group flex items-center gap-4 px-8 py-4 cursor-pointer transition-all border-b border-white/5 last:border-0 ${
                      isSelected ? "bg-indigo-500/10" : "hover:bg-white/5"
                    }`}
                  >
                    <div className="relative flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleCheckboxChange(audioKey)}
                        className="peer sr-only"
                      />
                      <div className="h-6 w-6 rounded-md border-2 border-white/20 peer-checked:bg-indigo-500 peer-checked:border-indigo-500 transition-all flex items-center justify-center">
                        <svg
                          className={`w-4 h-4 text-white ${isSelected ? "block" : "hidden"}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="3"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                      </div>
                    </div>

                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-sm font-semibold truncate transition-colors ${isSelected ? "text-indigo-300" : "text-zinc-200"}`}
                      >
                        {audio.name}
                      </p>
                      <p className="text-[10px] text-zinc-500 truncate mt-0.5 group-hover:text-zinc-400 transition-colors">
                        {audio.url}
                      </p>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
