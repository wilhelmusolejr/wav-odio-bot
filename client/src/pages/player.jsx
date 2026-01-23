import { useState, useEffect } from "react";
import AudioUnlockScreen from "../components/AudioUnlockScreen";
import PlayerInfo from "../components/PlayerInfo";
import PlayerJoinStatus from "../components/PlayerJoinStatus";
import AudioPlaylist from "../components/AudioPlaylist";
import PlayerSetupModal from "../components/PlayerSetupModal";
import { usePlayerWebSocket } from "../hooks/usePlayerWebSocket";
import { useAudioPlayer } from "../hooks/useAudioPlayer";
import { formatTime, unlockAudioContext } from "../utils/audioUtils";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8080/ws";

export default function Player() {
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [playerInfo, setPlayerInfo] = useState(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(true);
  const [playerName, setPlayerName] = useState("");
  const [groupName, setGroupName] = useState("");

  const handleSetupSubmit = ({ username, groupName: group }) => {
    setPlayerName(username);
    setGroupName(group);
    setShowSetupModal(false);
  };

  // 🔥 Only connect WebSocket after setup is complete
  const wsRef = usePlayerWebSocket({
    wsUrl: WS_URL,
    playerName: playerName,
    groupName: groupName,
    enabled: !showSetupModal && playerName && groupName, // 🆕 Add this
    onConnected: setConnected,
    onJoinSuccess: (data) => {
      setJoined(true);
      setPlayerInfo(data);
    },
    onLoadAudio: (audioFiles) => handleLoadAudio(audioFiles),
    onStartPlayback: () => handleStartPlayback(),
  });

  // Audio player controls
  const {
    audioRef,
    currentAudioIndex,
    isPlaying,
    currentTime,
    duration,
    audioList,
    handleLoadAudio,
    handleStartPlayback,
    togglePlayPause,
    handleTimeUpdate,
    handleLoadedMetadata,
    handleSeek,
    playNextAudio,
    cleanup,
  } = useAudioPlayer({
    wsRef,
    playerName: playerName,
    groupName: groupName,
  });

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, []);

  const handleUnlock = () => {
    unlockAudioContext()
      .then(() => {
        setIsUnlocked(true);
      })
      .catch((err) => {
        alert("Click again to unlock audio");
      });
  };

  if (!isUnlocked) {
    return <AudioUnlockScreen onUnlock={handleUnlock} />;
  }

  // Show setup modal if not configured
  if (showSetupModal) {
    return <PlayerSetupModal onSubmit={handleSetupSubmit} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white p-8">
      <div className="max-w-7xl mx-auto">
        <PlayerInfo connected={connected} playerInfo={playerInfo} />

        <div className="bg-gray-800 rounded-lg p-8">
          <PlayerJoinStatus
            joined={joined}
            playerInfo={playerInfo}
            testPlayerName={playerName}
            testGroupName={groupName}
          />
        </div>

        {joined && (
          <AudioPlaylist
            audioList={audioList}
            currentAudioIndex={currentAudioIndex}
            isPlaying={isPlaying}
            currentTime={currentTime}
            duration={duration}
            audioRef={audioRef}
            onPlayPause={togglePlayPause}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onSeek={handleSeek}
            onEnded={() => {
              console.log("🏁 Audio ended");
              playNextAudio();
            }}
            formatTime={formatTime}
          />
        )}
      </div>
    </div>
  );
}
