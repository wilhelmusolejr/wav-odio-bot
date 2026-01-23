import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import accounts from "../config/account.json";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8080/ws";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080";

export default function Player() {
  const [playerName, setPlayerName] = useState("");
  const [audioList, setAudioList] = useState([]);
  const [audioControls, setAudioControls] = useState({});
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [groupInfo, setGroupInfo] = useState(null);
  const [error, setError] = useState("");
  const [currentPlayingId, setCurrentPlayingId] = useState(null);
  const wsRef = useRef(null);
  const audioRefs = useRef({});
  const autoPlayTimeoutRef = useRef(null);
  const [rdpName, setRdpName] = useState("");

  // Initialize audio controls
  useEffect(() => {
    const controls = {};
    audioList.forEach((audio) => {
      controls[audio.id] = { isPlaying: false, currentTime: 0, duration: 0 };
    });
    console.log("Initialized", audioList);
    setAudioControls(controls);
  }, [audioList]);

  // Sync audio elements with controls
  useEffect(() => {
    Object.keys(audioRefs.current).forEach((audioId) => {
      const audio = audioRefs.current[audioId];
      const control = audioControls[audioId];

      if (audio && control) {
        if (control.isPlaying) {
          audio.play().catch((err) => console.error("Play error:", err));
        } else {
          audio.pause();
        }
      }
    });
  }, [audioControls]);

  // Handle player join
  const handleJoinGroup = (e) => {
    e.preventDefault();

    if (!playerName.trim()) {
      setError("Please enter your name");
      return;
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError("Not connected to server");
      return;
    }

    // Send player join message
    wsRef.current.send(
      JSON.stringify({
        type: "PLAYER_JOIN",
        playerName: playerName.trim(),
        groupName: rdpName,
        rdpName: rdpName,
      }),
    );
  };

  // Initialize WebSocket connection
  useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("✅ Player connected to WebSocket server");
      setConnected(true);
      setError("");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("📨 RAW Message from server:", event.data);
        console.log("📨 Message type:", data.type);
        console.log("📦 Full message data:", data);

        switch (data.type) {
          case "PLAYER_JOINED":
            console.log("✅ Handling PLAYER_JOINED");
            handlePlayerJoined(data);
            break;

          case "GROUP_CONTROL_UPDATE":
            console.log("🎮 Handling GROUP_CONTROL_UPDATE");
            handleGroupControlUpdate(data);
            break;

          case "REFRESH_AUDIO_LIST":
            console.log(
              "🔄 Handling REFRESH_AUDIO_LIST - Refreshing audio files...",
            );
            // Wait a bit for S3 to finalize uploads
            setTimeout(() => {
              if (playerName) {
                console.log(`🎵 Re-fetching audio for: ${playerName}`);
                fetchAudiosForPlayer(playerName);
              }
            }, 2000); // 2 second delay
            break;

          case "PLAYER_JOINED_GROUP":
            console.log("Player joined group:", data.playerName);
            break;

          case "ERROR":
            setError(data.message);
            console.error("Server error:", data.message);
            break;

          case "PONG":
            // Heartbeat response
            console.log("💓 Received PONG heartbeat");
            break;

          default:
            console.warn("⚠️ Unknown message type:", data.type);
        }
      } catch (error) {
        console.error("Error parsing WebSocket message:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("❌ WebSocket error:", error);
      setConnected(false);
      setError("Connection error");
    };

    ws.onclose = () => {
      console.log("🔌 Disconnected from WebSocket server");
      setConnected(false);
      setJoined(false);
    };

    wsRef.current = ws;

    // Heartbeat
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "PING" }));
      }
    }, 30000);

    return () => {
      clearInterval(pingInterval);
      if (autoPlayTimeoutRef.current) {
        clearTimeout(autoPlayTimeoutRef.current);
      }
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, []);

  const handlePlayerJoined = (data) => {
    setJoined(true);
    setGroupInfo({
      clientId: data.clientId,
      groupName: data.groupName,
      rdpName: data.rdpName,
    });

    // 🔥 TRUST THE SERVER
    setPlayerName(data.playerName ?? data.clientId);

    setError("");

    fetchAudiosForPlayer(data.playerName);
  };

  const fetchAudiosForPlayer = async (name) => {
    console.log(`📥 Fetching audio files for player: ${name}`);

    try {
      const response = await fetch(
        `${API_URL}/api/audios/${encodeURIComponent(name)}`,
      );
      if (response.ok) {
        const data = await response.json();
        console.log("📁 Loaded audio files:", data.audios);

        if (data.audios && data.audios.length > 0) {
          // Transform server response to local state format
          const audios = data.audios.map((audio) => ({
            id: audio.id,
            name: audio.name,
            filename: audio.filename,
            duration: audio.duration,
            currentTime: 0,
            url: `${API_URL}${audio.url}`,
          }));

          console.log(
            "🎵 Audio URLs:",
            audios.map((a) => ({ name: a.name, url: a.url })),
          );
          setAudioList(audios);

          // Initialize audio controls
          const controls = {};
          audios.forEach((audio) => {
            controls[audio.id] = {
              isPlaying: false,
              currentTime: 0,
              duration: 0,
            };
          });
          setAudioControls(controls);
        } else {
          console.warn("No audio files found for player:", name);
          setAudioList([]);
          setAudioControls({});
        }
      } else {
        console.warn("Failed to fetch audio files");
        setAudioList([]);
      }
    } catch (error) {
      console.error("Error fetching audio files:", error);
      setError("Failed to load audio files");
      setAudioList([]);
    }
  };

  const handleGroupControlUpdate = (data) => {
    // Handle group control updates from master
    const { control } = data;
    console.log("🎮 Group control update:", control);
    console.log("📋 Current audioList:", audioList);
    console.log("📋 Current audioRefs:", Object.keys(audioRefs.current));

    if (control && control.isPlaying !== undefined) {
      // Start playing all audios if isPlaying is true
      if (control.isPlaying) {
        console.log("▶️ Master triggered play for group");
        console.log("🎵 Audio list length:", audioList.length);
        console.log(
          "🎵 AudioRefs available:",
          Object.keys(audioRefs.current).length,
        );

        // Use audioList if available, otherwise try to use audioRefs
        const audioIds =
          audioList.length > 0
            ? audioList.map((a) => a.id)
            : Object.keys(audioRefs.current);

        if (audioIds.length > 0) {
          const firstAudioId = audioIds[0];
          console.log("🎵 Starting first audio:", firstAudioId);
          setCurrentPlayingId(firstAudioId);

          setAudioControls((prev) => {
            console.log("🎚️ Setting audio controls for:", firstAudioId);
            return {
              ...prev,
              [firstAudioId]: { ...prev[firstAudioId], isPlaying: true },
            };
          });
        } else {
          console.warn("⚠️ No audio files available to play");
        }
      } else {
        // Stop playing
        console.log("⏸️ Master triggered pause for group");
        // Pause all audios
        setAudioControls((prev) => {
          const newControls = { ...prev };
          Object.keys(newControls).forEach((audioId) => {
            newControls[audioId] = {
              ...newControls[audioId],
              isPlaying: false,
            };
          });
          return newControls;
        });
        setCurrentPlayingId(null);
      }
    }
  };

  const playNextAudio = () => {
    if (audioList.length === 0) return;

    // Find current playing audio index
    const currentIndex = audioList.findIndex((a) => a.id === currentPlayingId);
    const nextIndex = currentIndex + 1;

    if (nextIndex < audioList.length) {
      const nextAudioId = audioList[nextIndex].id;

      // Pause current
      setAudioControls((prev) => ({
        ...prev,
        [currentPlayingId]: { ...prev[currentPlayingId], isPlaying: false },
      }));

      // Random pause between 5-10 seconds
      const pauseDuration = Math.random() * 5000 + 5000; // 5000-10000ms
      console.log(
        `⏸️ Pausing for ${(pauseDuration / 1000).toFixed(1)} seconds before next track`,
      );

      // Clear any existing timeout
      if (autoPlayTimeoutRef.current) {
        clearTimeout(autoPlayTimeoutRef.current);
      }

      // Set timeout to play next audio
      autoPlayTimeoutRef.current = setTimeout(() => {
        console.log(`▶️ Auto-playing next audio: ${audioList[nextIndex].name}`);
        setCurrentPlayingId(nextAudioId);
        setAudioControls((prev) => ({
          ...prev,
          [nextAudioId]: { ...prev[nextAudioId], isPlaying: true },
        }));
      }, pauseDuration);
    } else {
      console.log("✅ Playlist finished - all tracks played");

      // Send message to master that player finished playing
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "PLAYER_FINISHED_PLAYING",
            playerName: playerName,
            groupName: rdpName,
          }),
        );
        console.log("📤 Sent PLAYER_FINISHED_PLAYING to master");
      }
      setCurrentPlayingId(null);
    }
  };

  const togglePlayPause = (audioId) => {
    const audio = audioRefs.current[audioId];
    console.log("🔘 Toggle clicked for audio:", audioId);
    console.log("📻 Audio element exists:", !!audio);

    if (!audio) {
      console.warn("⚠️ Audio element not found for:", audioId);
      return;
    }

    const newIsPlaying = !audioControls[audioId]?.isPlaying;
    console.log("🎚️ New playing state:", newIsPlaying);

    // If playing, update current playing ID
    if (newIsPlaying) {
      setCurrentPlayingId(audioId);
    }

    setAudioControls((prev) => ({
      ...prev,
      [audioId]: { ...prev[audioId], isPlaying: newIsPlaying },
    }));

    // Send player control update to server
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "UPDATE_PLAYER_CONTROL",
          isPlaying: newIsPlaying,
        }),
      );
    }
  };

  const updateAudioTime = (audioId, value) => {
    const audio = audioRefs.current[audioId];
    if (audio) {
      audio.currentTime = value;
    }
    setAudioControls((prev) => ({
      ...prev,
      [audioId]: { ...prev[audioId], currentTime: value },
    }));
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  return (
    <>
      <div className="min-h-screen bg-black relative overflow-hidden py-16">
        {/* Floating gradient background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <motion.div
            animate={{
              x: [0, 50, -50, 0],
              y: [0, -50, 50, 0],
            }}
            transition={{
              duration: 8,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="absolute -top-40 -left-40 w-80 h-80 bg-gradient-to-br from-white via-gray-400 to-gray-300 rounded-full blur-3xl opacity-20"
          />
          <motion.div
            animate={{
              x: [0, -50, 50, 0],
              y: [0, 50, -50, 0],
            }}
            transition={{
              duration: 10,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="absolute -bottom-40 -right-40 w-80 h-80 bg-gradient-to-tl from-white via-gray-300 to-gray-400 rounded-full blur-3xl opacity-20"
          />
          <motion.div
            animate={{
              x: [0, 40, -40, 0],
              y: [0, -40, 40, 0],
            }}
            transition={{
              duration: 12,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="absolute top-1/2 left-1/2 w-60 h-60 bg-gradient-to-r from-white via-gray-300 to-gray-200 rounded-full blur-3xl opacity-15"
          />
        </div>

        {/* Content */}
        <div className="relative z-10 w-full max-w-7xl mx-auto py-16">
          {/* Header */}
          <div className="mb-8">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-5xl font-bold text-white">🎵 Player</h1>
              <div className="flex items-center gap-2">
                <div
                  className={`w-3 h-3 rounded-full ${
                    connected ? "bg-green-400" : "bg-red-400"
                  }`}
                ></div>
                <span className="text-sm font-semibold text-gray-300">
                  {connected ? "Connected" : "Disconnected"}
                </span>
              </div>
            </div>
          </div>

          {/* Join Form - Show if not joined */}
          {!joined ? (
            <>
              <div className="fixed inset-0 flex items-center justify-center mb-8">
                <div className="bg-gray-900 border-2  border-gray-700 rounded-xl p-8">
                  <h2 className="text-2xl font-bold text-white mb-2">
                    Join Group
                  </h2>
                  <p className="text-gray-400 mb-6">
                    Enter your name to join {rdpName}
                  </p>

                  <form onSubmit={handleJoinGroup} className="space-y-4">
                    <div>
                      <label className="block text-sm font-semibold text-gray-300 mb-2">
                        👤 Your Name
                      </label>
                      <input
                        list="player-names"
                        type="text"
                        value={playerName}
                        onChange={(e) => {
                          setPlayerName(e.target.value);
                          setError("");
                        }}
                        placeholder="Enter or select your name"
                        className="w-full px-4 py-2 border border-gray-600 rounded-lg focus:border-gray-400 focus:outline-none bg-gray-800 text-white placeholder-gray-500"
                      />

                      <datalist id="player-names">
                        {accounts.map((account) => (
                          <option
                            key={account.username}
                            value={account.username}
                          />
                        ))}
                      </datalist>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-gray-300 mb-2">
                        🌐 Group (RDP)
                      </label>
                      <input
                        type="text"
                        value={rdpName}
                        onChange={(e) => setRdpName(e.target.value)}
                        placeholder="Enter RDP name"
                        className="w-full px-4 py-2 border border-gray-600 rounded-lg focus:border-gray-400 focus:outline-none bg-gray-800 text-white placeholder-gray-500"
                      />
                    </div>

                    {error && (
                      <div className="p-3 bg-red-900/30 border border-red-700 rounded-lg">
                        <p className="text-sm text-red-300">❌ {error}</p>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={!connected}
                      className={`w-full font-semibold py-2 px-4 rounded-lg transition border ${
                        connected
                          ? "bg-green-600 hover:bg-green-700 text-white border-green-700 cursor-pointer"
                          : "bg-gray-700 text-gray-500 border-gray-600 cursor-not-allowed"
                      }`}
                    >
                      {connected ? "Join Group" : "Connecting..."}
                    </button>
                  </form>

                  {!connected && (
                    <p className="text-xs text-gray-500 text-center mt-4">
                      Connecting to server...
                    </p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Player Info - Show after joined */}
              <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 mb-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      👤 Player Name
                    </p>
                    <p className="text-2xl font-bold text-white">
                      {playerName}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      🌐 Group RDP Name
                    </p>
                    <p className="text-2xl font-bold text-white">
                      {groupInfo?.rdpName}
                    </p>
                  </div>
                </div>
                <div className="border-t border-gray-700 pt-4">
                  <p className="text-sm text-gray-400">
                    Status:{" "}
                    <span className="text-green-400 font-semibold">
                      Connected
                    </span>
                  </p>
                </div>
              </div>

              {/* Audio List - Show after joined */}
              <div>
                <h2 className="text-2xl font-bold text-white mb-4">
                  🎧 Audio Tracks
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                  {audioList.map((audio) => (
                    <div
                      key={audio.id}
                      className="bg-gray-900 border border-gray-700 rounded-xl shadow-lg p-6 flex flex-col hover:border-gray-500 transition"
                    >
                      {/* Hidden Audio Element */}
                      <audio
                        ref={(el) => {
                          if (el) audioRefs.current[audio.id] = el;
                        }}
                        src={audio.url}
                        crossOrigin="anonymous"
                        onLoadStart={() => {
                          console.log(`Loading: ${audio.url}`);
                        }}
                        onCanPlay={() => {
                          console.log(`Can play: ${audio.name}`);
                        }}
                        onError={(e) => {
                          console.error(
                            `❌ Error loading audio ${audio.name}:`,
                            {
                              url: audio.url,
                              error: e.target.error?.message,
                              code: e.target.error?.code,
                            },
                          );
                        }}
                        onTimeUpdate={(e) => {
                          setAudioControls((prev) => ({
                            ...prev,
                            [audio.id]: {
                              ...prev[audio.id],
                              currentTime: e.target.currentTime,
                            },
                          }));
                        }}
                        onLoadedMetadata={(e) => {
                          const duration = e.target.duration;
                          if (isFinite(duration)) {
                            console.log(
                              `Audio ${audio.id} duration: ${duration}s`,
                            );
                            setAudioControls((prev) => ({
                              ...prev,
                              [audio.id]: {
                                ...prev[audio.id],
                                duration: duration,
                              },
                            }));
                          }
                        }}
                        onEnded={() => {
                          console.log(`🏁 Audio ended: ${audio.name}`);
                          setAudioControls((prev) => ({
                            ...prev,
                            [audio.id]: { ...prev[audio.id], isPlaying: false },
                          }));
                          playNextAudio();
                        }}
                      />

                      {/* Audio Name */}
                      <h3 className="text-lg font-bold text-white mb-4">
                        🎵 {audio.name}
                      </h3>

                      {/* Time Display */}
                      <p className="text-xs text-gray-400 mb-4">
                        {formatTime(audioControls[audio.id]?.currentTime || 0)}{" "}
                        / {formatTime(audioControls[audio.id]?.duration || 0)}
                      </p>

                      {/* Audio Slider */}
                      <div className="w-full mb-4 flex-grow">
                        <input
                          type="range"
                          min="0"
                          max={audioControls[audio.id]?.duration || 0}
                          value={audioControls[audio.id]?.currentTime || 0}
                          onChange={(e) =>
                            updateAudioTime(audio.id, parseInt(e.target.value))
                          }
                          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-white hover:accent-gray-300"
                        />
                      </div>

                      {/* Play/Pause Button */}
                      <button
                        onClick={() => togglePlayPause(audio.id)}
                        className={`w-full font-semibold py-2 px-4 rounded-lg transition border ${
                          audioControls[audio.id]?.isPlaying
                            ? "bg-gray-700 text-white border-gray-600 hover:bg-gray-600"
                            : "bg-gray-800 text-gray-300 border-gray-600 hover:border-gray-500"
                        }`}
                      >
                        {audioControls[audio.id]?.isPlaying
                          ? "⏸ Pause"
                          : "▶ Play"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
