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
  const [isReady, setIsReady] = useState(false); // Track if player is ready
  const [loadingAudio, setLoadingAudio] = useState(false); // Track audio loading state
  const wsRef = useRef(null);
  const audioRefs = useRef({});
  const autoPlayTimeoutRef = useRef(null);
  const [rdpName, setRdpName] = useState("");

  // Initialize audio controls when audioList changes
  useEffect(() => {
    const controls = {};
    audioList.forEach((audio) => {
      controls[audio.id] = { isPlaying: false, currentTime: 0, duration: 0 };
    });
    console.log(
      "🎛️ Initialized audio controls for",
      audioList.length,
      "tracks",
    );
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
        console.log("📨 Message from server:", data.type);

        switch (data.type) {
          case "PLAYER_JOINED":
            handlePlayerJoined(data);
            break;

          case "ASSIGN_AUDIO":
            console.log("🎵 Received assigned audio from master");
            handleAssignedAudio(data);
            break;

          case "START_PLAYBACK":
            console.log("▶️ Received START_PLAYBACK command");
            handleStartPlayback();
            break;

          case "GROUP_CONTROL_UPDATE":
            console.log("🎮 Handling GROUP_CONTROL_UPDATE");
            handleGroupControlUpdate(data);
            break;

          case "ERROR":
            setError(data.message);
            console.error("Server error:", data.message);
            break;

          case "PONG":
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
    console.log("✅ Player joined successfully:", data);
    setJoined(true);

    // ✅ Set player name and RDP name from server response
    const joinedPlayerName = data.playerName || playerName;
    const joinedRdpName = data.groupName || rdpName;

    setPlayerName(joinedPlayerName);
    setRdpName(joinedRdpName);

    setGroupInfo({
      clientId: data.clientId,
      groupName: data.groupName,
      rdpName: data.rdpName,
    });

    setError("");
    setIsReady(false); // Reset ready state

    console.log("✅ Player state updated:", {
      playerName: joinedPlayerName,
      rdpName: joinedRdpName,
      groupName: data.groupName,
    });
  };

  // 🆕 Handle assigned audio from master
  const handleAssignedAudio = (data) => {
    const { audioFiles } = data;

    if (!audioFiles || audioFiles.length === 0) {
      console.warn("⚠️ No audio files assigned");
      setAudioList([]);
      return;
    }

    console.log("\n📥 ===== RECEIVED AUDIO ASSIGNMENT =====");
    console.log(`🎵 Total files: ${audioFiles.length}`);
    audioFiles.forEach((file, idx) => {
      console.log(`   ${idx + 1}. ${file.filename}`);
      console.log(`      URL: ${file.s3Url}`);
    });
    console.log("====================================\n");
    setLoadingAudio(true);
    setIsReady(false);

    // Transform assigned audio URLs to local state format
    const audios = audioFiles.map((audio, index) => ({
      id: audio.id || `audio-${index}`,
      name: audio.filename || audio.name || `Track ${index + 1}`,
      filename: audio.filename,
      duration: 0,
      currentTime: 0,
      url: audio.s3Url, // 🔥 Use S3 URL directly from master
    }));

    console.log(
      "🎵 Audio URLs:",
      audios.map((a) => ({ name: a.name, url: a.url })),
    );

    // ✅ Set audio list BEFORE initializing controls
    setAudioList(audios);

    // Wait a bit before initializing controls to ensure state updates
    setTimeout(() => {
      // Initialize audio controls (preserve existing durations if already loaded)
      setAudioControls((prev) => {
        const controls = {};
        audios.forEach((audio) => {
          controls[audio.id] = {
            isPlaying: false,
            currentTime: 0,
            duration: prev[audio.id]?.duration || 0, // Preserve existing duration
          };
        });
        return controls;
      });

      // Wait for all audio elements to be ready
      setTimeout(() => {
        checkAudioReadiness(audios);
      }, 1000);
    }, 100);
  };

  // 🆕 Check if all audio files are loaded and ready
  const checkAudioReadiness = (audios) => {
    const allAudioElements = audios.map((audio) => audioRefs.current[audio.id]);
    const readyCount = allAudioElements.filter(
      (audio) => audio && audio.readyState >= 2,
    ).length;
    const allReady = allAudioElements.every(
      (audio) => audio && audio.readyState >= 2,
    ); // HAVE_CURRENT_DATA

    console.log(`🔄 Audio ready status: ${readyCount}/${audios.length} loaded`);

    if (allReady) {
      console.log("\n✅ ===== ALL AUDIO FILES READY =====");
      console.log(`Player: ${playerName}`);
      console.log(`Group: ${groupInfo?.groupName || rdpName}`);
      console.log(`Total files loaded: ${audios.length}`);
      console.log("==================================\n");

      setLoadingAudio(false);
      setIsReady(true);

      // Send ready signal to master
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        // ✅ Use the most recent values from state
        const currentPlayerName = playerName || groupInfo?.clientId;
        const currentGroupName = groupInfo?.groupName || rdpName;

        console.log("📤 Preparing to send READY_TO_PLAY:", {
          playerName: "botfrag666",
          groupName: "a",
        });

        wsRef.current.send(
          JSON.stringify({
            type: "READY_TO_PLAY",
            playerName: currentPlayerName,
            groupName: currentGroupName,
          }),
        );
        console.log("📤 Sent READY_TO_PLAY message to server");
      }
    } else {
      // Check again in 500ms
      setTimeout(() => checkAudioReadiness(audios), 500);
    }
  };

  // 🆕 Handle start playback command from master
  const handleStartPlayback = () => {
    console.log("🎵 handleStartPlayback called");
    console.log("   Audio list length:", audioList.length);
    console.log("   Is ready:", isReady);

    if (audioList.length === 0) {
      console.warn("⚠️ No audio to play - audio list is empty");
      return;
    }

    if (!isReady) {
      console.warn("⚠️ Player not ready yet - audio still loading");
      return;
    }

    const firstAudioId = audioList[0].id;
    console.log(
      `▶️ Starting playback with: ${audioList[0].name} (ID: ${firstAudioId})`,
    );

    setCurrentPlayingId(firstAudioId);
    setAudioControls((prev) => ({
      ...prev,
      [firstAudioId]: { ...prev[firstAudioId], isPlaying: true },
    }));
  };

  const handleGroupControlUpdate = (data) => {
    const { control } = data;
    console.log("🎮 Group control update:", control);

    if (control && control.isPlaying !== undefined) {
      if (control.isPlaying) {
        // Use the START_PLAYBACK handler
        handleStartPlayback();
      } else {
        console.log("⏸️ Master triggered pause for group");
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

    const currentIndex = audioList.findIndex((a) => a.id === currentPlayingId);
    const nextIndex = currentIndex + 1;

    if (nextIndex < audioList.length) {
      const nextAudioId = audioList[nextIndex].id;

      setAudioControls((prev) => ({
        ...prev,
        [currentPlayingId]: { ...prev[currentPlayingId], isPlaying: false },
      }));

      const pauseDuration = Math.random() * 5000 + 5000;
      console.log(
        `⏸️ Pausing for ${(pauseDuration / 1000).toFixed(1)} seconds before next track`,
      );

      if (autoPlayTimeoutRef.current) {
        clearTimeout(autoPlayTimeoutRef.current);
      }

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

    if (!audio) {
      console.warn("⚠️ Audio element not found for:", audioId);
      return;
    }

    const newIsPlaying = !audioControls[audioId]?.isPlaying;
    console.log("🎚️ New playing state:", newIsPlaying);

    if (newIsPlaying) {
      setCurrentPlayingId(audioId);
    }

    setAudioControls((prev) => ({
      ...prev,
      [audioId]: { ...prev[audioId], isPlaying: newIsPlaying },
    }));
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
              <div className="flex items-center gap-4">
                {/* Connection Status */}
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

                {/* Ready Status */}
                {joined && (
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-3 h-3 rounded-full ${
                        isReady
                          ? "bg-green-400"
                          : loadingAudio
                            ? "bg-yellow-400"
                            : "bg-gray-400"
                      }`}
                    ></div>
                    <span className="text-sm font-semibold text-gray-300">
                      {isReady
                        ? "Ready"
                        : loadingAudio
                          ? "Loading..."
                          : "Waiting"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Join Form - Show if not joined */}
          {!joined ? (
            <div className="fixed inset-0 flex items-center justify-center mb-8">
              <div className="bg-gray-900 border-2 border-gray-700 rounded-xl p-8">
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
                <div className="border-t border-gray-700 pt-4 flex items-center justify-between">
                  <p className="text-sm text-gray-400">
                    Status:{" "}
                    <span
                      className={`font-semibold ${isReady ? "text-green-400" : loadingAudio ? "text-yellow-400" : "text-gray-400"}`}
                    >
                      {isReady
                        ? "Ready to Play"
                        : loadingAudio
                          ? "Loading Audio..."
                          : "Waiting for Audio Assignment"}
                    </span>
                  </p>
                  {audioList.length > 0 && (
                    <p className="text-sm text-gray-400">
                      🎵 {audioList.length} tracks assigned
                    </p>
                  )}
                </div>
              </div>

              {/* Audio List - Show if audio assigned */}
              {audioList.length > 0 ? (
                <div>
                  <h2 className="text-2xl font-bold text-white mb-4">
                    🎧 Assigned Audio Tracks
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
                          preload="auto"
                          onLoadStart={() => {
                            console.log(`📥 Loading: ${audio.name}`);
                          }}
                          onCanPlay={() => {
                            console.log(`✅ Can play: ${audio.name}`);
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
                            if (isFinite(duration) && duration > 0) {
                              console.log(
                                `⏱️ Audio ${audio.name} duration: ${duration.toFixed(2)}s`,
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
                          onDurationChange={(e) => {
                            const duration = e.target.duration;
                            if (isFinite(duration) && duration > 0) {
                              console.log(
                                `🕐 Duration changed for ${audio.name}: ${duration.toFixed(2)}s`,
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
                              [audio.id]: {
                                ...prev[audio.id],
                                isPlaying: false,
                              },
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
                          {formatTime(
                            audioControls[audio.id]?.currentTime || 0,
                          )}{" "}
                          /{" "}
                          {audioControls[audio.id]?.duration > 0
                            ? formatTime(audioControls[audio.id]?.duration)
                            : "--:--"}
                        </p>

                        {/* Audio Slider */}
                        <div className="w-full mb-4 flex-grow">
                          <input
                            type="range"
                            min="0"
                            max={
                              audioControls[audio.id]?.duration > 0
                                ? audioControls[audio.id]?.duration
                                : 100
                            }
                            value={audioControls[audio.id]?.currentTime || 0}
                            onChange={(e) =>
                              updateAudioTime(
                                audio.id,
                                parseFloat(e.target.value),
                              )
                            }
                            disabled={!audioControls[audio.id]?.duration}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-white hover:accent-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        </div>

                        {/* Play/Pause Button */}
                        <button
                          onClick={() => togglePlayPause(audio.id)}
                          disabled={!isReady}
                          className={`w-full font-semibold py-2 px-4 rounded-lg transition border ${
                            !isReady
                              ? "bg-gray-700 text-gray-500 border-gray-600 cursor-not-allowed"
                              : audioControls[audio.id]?.isPlaying
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
              ) : (
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-12 text-center">
                  <p className="text-gray-400 text-lg mb-2">
                    ⏳ Waiting for audio assignment from master...
                  </p>
                  <p className="text-gray-500 text-sm">
                    Master will assign audio tracks when ready
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
