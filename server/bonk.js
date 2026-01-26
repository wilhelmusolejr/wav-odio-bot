// 1. Define the 'Pipe' and 'Player' globally so they persist
window.audioContext = window.audioContext || new AudioContext();
window.audioDestination =
  window.audioDestination || window.audioContext.createMediaStreamDestination();
window.audioBot = window.audioBot || new Audio();
window.audioBot.crossOrigin = "anonymous";

// Connect the source only once to prevent "already connected" errors
if (!window.audioSource) {
  window.audioSource = window.audioContext.createMediaElementSource(
    window.audioBot,
  );
  window.audioSource.connect(window.audioDestination);
}

// 2. Define a reusable function to change and play audio
window.playTrack = async function (url, loop = false) {
  console.log(`🎵 Switching track to: ${url}`);
  window.audioBot.src = url;
  window.audioBot.loop = loop;
  try {
    await window.audioBot.play();
    console.log("✅ Playback started successfully");
  } catch (e) {
    console.error("❌ Playback failed:", e);
  }
};

// 3. The Interceptor (Run this ONCE when the page loads)
if (!window.micIntercepted) {
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(
    navigator.mediaDevices,
  );
  navigator.mediaDevices.getUserMedia = async function (constraints) {
    if (constraints && constraints.audio) {
      console.log("🎤 Discord requested mic -> Sending injected stream");
      return window.audioDestination.stream;
    }
    return originalGetUserMedia(constraints);
  };
  window.micIntercepted = true;
  console.log("📡 Stream Injector Initialized.");
}
