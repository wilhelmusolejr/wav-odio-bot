import { useState, useRef } from "react";

export function useAudioPlayer({ wsRef, playerName, groupName }) {
  const [currentAudioIndex, setCurrentAudioIndex] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [audioList, setAudioList] = useState([]);
  const audioRef = useRef(null);
  const pauseTimeoutRef = useRef(null);
  const audioListRef = useRef([]);

  const handleLoadAudio = (audioFiles) => {
    console.log(`📥 Step 3: Loading ${audioFiles.length} audio files...`);
    setAudioList(audioFiles);
    audioListRef.current = audioFiles;
    setCurrentAudioIndex(null);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    console.log("✅ Step 3: Audio files loaded into player, ready to play");
  };

  const handleStartPlayback = () => {
    console.log("▶️ Step 4: Starting playback...");
    console.log(`📊 Current audioList length: ${audioListRef.current.length}`);

    if (audioListRef.current.length === 0) {
      console.error("⚠️ No audio loaded yet! Cannot start playback.");
      return;
    }

    const firstTrack = audioListRef.current[0];
    console.log(`🎵 Playing first track: ${firstTrack.name}`);

    setCurrentAudioIndex(0);
    setCurrentTime(0);
    setIsPlaying(true);

    setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.src = firstTrack.url;
        audioRef.current.load();
        audioRef.current.play().catch((err) => {
          console.error("❌ Play failed:", err);
          setIsPlaying(false);
        });
        console.log("✅ Step 4: Started playing first track");
      } else {
        console.error("❌ audioRef.current is null!");
      }
    }, 100);
  };

  const togglePlayPause = (index) => {
    if (index !== undefined && index !== currentAudioIndex) {
      setCurrentAudioIndex(index);
      setCurrentTime(0);
      setIsPlaying(true);
      console.log(`▶️ Switching to: ${audioList[index].name}`);

      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.src = audioList[index].url;
          audioRef.current.load();
          audioRef.current.play().catch((err) => {
            console.error("❌ Play failed:", err);
            setIsPlaying(false);
          });
        }
      }, 0);
      return;
    }

    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      console.log("⏸️ Audio paused");
    } else {
      audioRef.current.play().catch((err) => {
        console.error("❌ Play failed:", err);
      });
      console.log("▶️ Audio playing");
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      console.log(
        `⏱️ Audio duration: ${audioRef.current.duration.toFixed(2)}s`,
      );
    }
  };

  const handleSeek = (e) => {
    const newTime = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
      setCurrentTime(newTime);
    }
  };

  const playNextAudio = () => {
    if (currentAudioIndex === null) return;

    const nextIndex = currentAudioIndex + 1;

    if (nextIndex < audioList.length) {
      const pauseDuration = Math.random() * 5000 + 10000;
      console.log(
        `⏸️ Pausing for ${(pauseDuration / 1000).toFixed(1)} seconds before next track`,
      );

      setIsPlaying(false);

      pauseTimeoutRef.current = setTimeout(() => {
        console.log(`▶️ Auto-playing next: ${audioList[nextIndex].name}`);
        setCurrentAudioIndex(nextIndex);
        setCurrentTime(0);

        if (audioRef.current) {
          audioRef.current.src = audioList[nextIndex].url;
          audioRef.current.load();

          audioRef.current.oncanplay = () => {
            audioRef.current.play().catch((err) => {
              console.error("❌ Auto-play failed:", err);
              setIsPlaying(false);
            });
            setIsPlaying(true);
            audioRef.current.oncanplay = null;
          };
        }
      }, pauseDuration);
    } else {
      console.log("\n🏁 ===== PLAYLIST FINISHED =====");
      console.log(`All ${audioListRef.current.length} tracks completed`);
      console.log("================================\n");

      setIsPlaying(false);
      setCurrentAudioIndex(null);

      // 🆕 Notify master that this player finished
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "PLAYER_FINISHED",
            playerName: playerName,
            groupName: groupName,
          }),
        );
        console.log("📤 Sent PLAYER_FINISHED notification to master");
      }
    }
  };

  // Cleanup on unmount
  const cleanup = () => {
    if (pauseTimeoutRef.current) {
      clearTimeout(pauseTimeoutRef.current);
    }
  };

  return {
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
  };
}
