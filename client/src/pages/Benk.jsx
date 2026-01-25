import React, { useEffect, useRef, useState } from "react";
import Orbs from "../components/Orbs";
import { useCallback } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8080/ws";
const DEFAULT_PLAYER_NAME = "botfrag666";
const DEFAULT_GROUP_NAME = "Bonk";

function AudioPlayer({ audio, groupName, onLoaded, onAudioRefReady, onEnded }) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Notify parent when audio ref is ready
  useEffect(() => {
    if (typeof onAudioRefReady === "function") {
      onAudioRefReady(audioRef.current);
    }
  }, [onAudioRefReady]);

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  };

  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) setDuration(audioRef.current.duration);
    if (typeof onLoaded === "function") {
      onLoaded(audio.key || audio.path);
    }
  };

  const handleSliderChange = (e) => {
    const newTime = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (typeof onEnded === "function") {
      onEnded();
    }
  };

  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);

  return (
    <>
      <audio
        // UPDATED: This callback tells the parent the ref is ready immediately
        ref={(el) => {
          audioRef.current = el;
          if (onAudioRefReady) onAudioRefReady(el);
        }}
        src={audio.path}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPlay={handlePlay}
        onPause={handlePause}
      />

      <div className="px-4 py-3 hover:bg-white/[0.03] transition-colors">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlayPause}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 transition-colors"
            >
              {isPlaying ? (
                <span className="text-indigo-300 text-xs">⏸</span>
              ) : (
                <span className="text-indigo-300 text-xs">▶</span>
              )}
            </button>
            <div>
              <p className="text-sm font-medium text-white">{audio.name}</p>
              <p className="text-[11px] text-white/50">{groupName}</p>
            </div>
          </div>
          <span
            className={`text-[10px] uppercase font-bold tracking-wider px-3 py-1 rounded border ${
              audio.played
                ? "text-emerald-300 bg-emerald-500/10 border-emerald-500/30"
                : "text-amber-200 bg-amber-500/10 border-amber-500/30"
            }`}
          >
            {audio.played ? "Played" : "Pending"}
          </span>
        </div>

        <div className="flex items-center gap-3 mt-2">
          <span className="text-[10px] text-white/50 font-mono">
            {formatTime(currentTime)}
          </span>
          <div className="flex-1">
            <input
              type="range"
              min="0"
              max={duration || 0}
              value={currentTime}
              onChange={handleSliderChange}
              className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400"
            />
          </div>
          <span className="text-[10px] text-white/50 font-mono">
            {formatTime(duration)}
          </span>
        </div>
      </div>
    </>
  );
}

export default function Benk() {
  const ws = useRef(null);
  const [isConnected, setIsConnected] = useState(false);
  const [playerAudios, setPlayerAudios] = useState([]);
  const [currentPlayingIndex, setCurrentPlayingIndex] = useState(-1);
  const [isPlayingSequence, setIsPlayingSequence] = useState(false);
  const loadedKeys = useRef(new Set());
  const readySent = useRef(false);
  const audioRefs = useRef([]); // Store all audio refs here

  const [isUnlocked, setIsUnlocked] = useState(false);

  // Add this function to prime the audio engine
  const unlockAudio = () => {
    setIsUnlocked(true);

    // Optional: Play a 0.1s silent beep to tell the browser "we are making noise now"
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    console.log("🔓 Audio Engine Unlocked via user interaction");
  };

  useEffect(() => {
    ws.current = new WebSocket(WS_URL);

    ws.current.onopen = () => {
      console.log("✅ Player WebSocket connected");
      setIsConnected(true);
      ws.current.send(
        JSON.stringify({
          type: "JOIN_PLAYER",
          playerName: DEFAULT_PLAYER_NAME,
          groupName: DEFAULT_GROUP_NAME,
        }),
      );
    };

    ws.current.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log("📨 Player received:", msg.type, msg);

        switch (msg.type) {
          case "LOAD_AUDIO":
            if (msg.playerName === DEFAULT_PLAYER_NAME) {
              setPlayerAudios(
                (msg.audioPath || []).map((file) => ({
                  name: file.name,
                  path: file.url,
                  key: file.key,
                  played: false,
                })),
              );
            }
            break;

          case "START_PLAYBACK":
            console.log("▶️ START_PLAYBACK received, playing first audio...");
            console.log("▶️ Server-triggered Playback");
            // Since isUnlocked is now true, this will work automatically
            setTimeout(() => {
              startPlayback();
              console.log("▶️ Playback started after 3s delay");
            }, 3000);

            break;

          default:
            break;
        }
      } catch (err) {
        console.error("❌ Error parsing message:", err);
      }
    };

    ws.current.onerror = (err) => {
      console.error("❌ Player WebSocket error:", err);
    };

    ws.current.onclose = () => {
      console.log("🔌 Player WebSocket disconnected");
      setIsConnected(false);
    };

    return () => {
      if (ws.current) ws.current.close();
    };
  }, []);

  useEffect(() => {
    loadedKeys.current = new Set();
    readySent.current = false;
    // REMOVED: audioRefs.current = [];
    // We don't want to wipe it here because it breaks the button click
  }, [playerAudios]);

  const handleAudioLoaded = (key) => {
    if (!key) return;
    loadedKeys.current.add(key);
    if (
      playerAudios.length > 0 &&
      loadedKeys.current.size === playerAudios.length &&
      ws.current?.readyState === WebSocket.OPEN &&
      !readySent.current
    ) {
      readySent.current = true;
      ws.current.send(
        JSON.stringify({
          type: "PLAYER_AUDIO_READY",
          playerName: DEFAULT_PLAYER_NAME,
          groupName: DEFAULT_GROUP_NAME,
        }),
      );
      console.log("✅ All audio loaded, notified server.");
    }
  };

  const handleAudioRefReady = useCallback((idx, ref) => {
    if (ref) {
      audioRefs.current[idx] = ref;
    }
  }, []);

  const playNextAudio = (nextIndex) => {
    // Filter out any null refs just in case
    const activeRefs = audioRefs.current.filter((ref) => ref !== null);

    if (nextIndex >= activeRefs.length) {
      // All audios played
      setCurrentPlayingIndex(-1);
      setIsPlayingSequence(false);
      console.log("✅ All audios finished playing");
      
      // Notify server that player has finished playing all audio
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(
          JSON.stringify({
            type: "PLAYER_FINISHED",
            playerName: DEFAULT_PLAYER_NAME,
            groupName: DEFAULT_GROUP_NAME,
          }),
        );
        console.log("📤 Sent PLAYER_FINISHED to server");
      }
      return;
    }

    const nextAudio = audioRefs.current[nextIndex];
    if (nextAudio) {
      setCurrentPlayingIndex(nextIndex);
      console.log(`▶️ Playing audio ${nextIndex + 1}/${activeRefs.length}`);

      // Reset and Play
      nextAudio.currentTime = 0;

      // Wrap in a timeout to ensure state updates don't block the browser's audio thread
      setTimeout(() => {
        nextAudio.play().catch((err) => {
          console.error("Autoplay blocked or error:", err);
          // If one fails, try to skip to the next
          playNextAudio(nextIndex + 1);
        });
      }, 50);
    }
  };

  // Change this function in your Benk component
  const handleAudioEnded = (index) => {
    if (isPlayingSequence) {
      // Mark the current one as played in the UI
      setPlayerAudios((prev) =>
        prev.map((audio, i) =>
          i === index ? { ...audio, played: true } : audio,
        ),
      );

      // Play the next one
      playNextAudio(index + 1);
    }
  };

  const startPlayback = () => {
    // Filter out any empty slots in the array
    const validRefs = audioRefs.current.filter((ref) => ref !== null);

    console.log(
      `📊 DEBUG: validRefs count = ${validRefs.length}, playerAudios = ${playerAudios.length}`,
    );

    if (validRefs.length === 0) {
      alert("Audio not ready yet. Please wait a second.");
      return;
    }

    setIsPlayingSequence(true);
    playNextAudio(0);
  };

  const stopPlayback = () => {
    setIsPlayingSequence(false);
    setCurrentPlayingIndex(-1);
    audioRefs.current.forEach((audio) => {
      if (audio) audio.pause();
    });
  };

  // Test function to load mock audio files without server trigger
  const loadTestAudios = () => {
    const testAudios = [
      {
        name: "Test Audio 1",
        path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
        key: "test-1",
        played: false,
      },
      {
        name: "Test Audio 2",
        path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
        key: "test-2",
        played: false,
      },
      {
        name: "Test Audio 3",
        path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
        key: "test-3",
        played: false,
      },
    ];
    setPlayerAudios(testAudios);
    console.log("📋 Test audios loaded");
  };

  const audios = playerAudios;
  const total = audios.length;
  const played = audios.filter((a) => a.played).length;

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-gradient-to-br from-black via-zinc-900 to-black text-white">
      {/* INITIAL INTERACTION OVERLAY */}
      {!isUnlocked && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/90 backdrop-blur-xl">
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-4">System Standby</h2>
            <button
              onClick={unlockAudio}
              className="px-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full font-bold shadow-lg shadow-indigo-500/20 transition-all animate-pulse"
            >
              INITIALIZE SYSTEM
            </button>
            <p className="text-white/40 text-xs mt-4 uppercase tracking-widest">
              Click to allow automated playback
            </p>
          </div>
        </div>
      )}

      <Orbs />

      <div className="max-w-6xl mx-auto pt-28 pb-16 px-4">
        <header className="text-center mb-10">
          <h1 className="text-5xl font-semibold">Player Dashboard</h1>
          <p className="text-white/60 mt-2 text-sm">Audio queue</p>
        </header>

        <div className="grid gap-4">
          <div className="bg-white/5 border border-white/10 rounded-xl p-5 shadow-xl backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div>
                <p className="text-[11px] uppercase text-white/40 tracking-[0.2em]">
                  Group
                </p>
                <h2 className="text-2xl font-bold">{DEFAULT_GROUP_NAME}</h2>
                <p className="text-xs text-blue-400 font-semibold mt-1">
                  #{DEFAULT_GROUP_NAME}
                </p>
              </div>
              <div className="flex items-center gap-3 text-sm flex-wrap">
                <span className="px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-200 border border-emerald-500/20">
                  {played} / {total} played
                </span>
                <span className="px-3 py-1 rounded-full bg-white/5 text-white/70 border border-white/10">
                  {total} audios
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={loadTestAudios}
                    className="px-4 py-1 rounded-full bg-purple-600 hover:bg-purple-500 text-white font-semibold text-sm transition-colors"
                  >
                    📋 Load Test
                  </button>
                  <button
                    onClick={startPlayback}
                    disabled={isPlayingSequence || total === 0}
                    className="px-4 py-1 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    ▶ Play All
                  </button>
                  {isPlayingSequence && (
                    <button
                      onClick={stopPlayback}
                      className="px-4 py-1 rounded-full bg-red-600 hover:bg-red-500 text-white font-semibold text-sm transition-colors"
                    >
                      ⏹ Stop
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="divide-y divide-white/5 border border-white/5 rounded-lg overflow-hidden">
              {/* Change the mapping inside your return statement */}
              {playerAudios.map((audio, idx) => (
                <AudioPlayer
                  key={audio.key || audio.path || idx}
                  audio={audio}
                  groupName={DEFAULT_GROUP_NAME}
                  onLoaded={handleAudioLoaded}
                  // Pass the idx so the handler knows where to put the ref
                  onAudioRefReady={(ref) => handleAudioRefReady(idx, ref)}
                  onEnded={() => handleAudioEnded(idx)}
                />
              ))}

              {!audios.length && (
                <div className="px-4 py-6 text-center text-sm text-white/50">
                  No audio files queued.
                </div>
              )}
            </div>
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
