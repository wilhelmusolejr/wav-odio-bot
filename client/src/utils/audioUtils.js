/**
 * Format seconds to MM:SS format
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
export function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/**
 * Unlock audio context by playing silent audio
 * @returns {Promise<void>}
 */
export function unlockAudioContext() {
  console.log("🔓 Unlocking Audio Engine...");

  // Create a silent audio buffer (data URI of silence)
  const silentAudio = new Audio(
    "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA",
  );

  return silentAudio
    .play()
    .then(() => {
      console.log("✅ Audio Engine Unlocked!");
    })
    .catch((err) => {
      console.error("❌ Unlock failed:", err);
      throw err;
    });
}
