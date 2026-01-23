import { useEffect, useRef } from "react";

export function usePlayerWebSocket({
  wsUrl,
  playerName,
  groupName,
  enabled = true, // 🆕 Add enabled prop with default true
  onConnected,
  onJoinSuccess,
  onLoadAudio,
  onStartPlayback,
}) {
  const wsRef = useRef(null);
  const callbacksRef = useRef({
    onConnected,
    onJoinSuccess,
    onLoadAudio,
    onStartPlayback,
  });

  // Keep callbacks up to date
  useEffect(() => {
    callbacksRef.current = {
      onConnected,
      onJoinSuccess,
      onLoadAudio,
      onStartPlayback,
    };
  });

  useEffect(() => {
    // 🔥 Don't connect if not enabled or missing credentials
    if (!enabled || !playerName || !groupName) {
      console.log("⏸️ WebSocket connection disabled or missing credentials");
      return;
    }

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("✅ Player connected to WebSocket server");
      callbacksRef.current.onConnected?.(true);

      // Auto-join with provided credentials
      setTimeout(() => {
        ws.send(
          JSON.stringify({
            type: "JOIN_PLAYER",
            playerName: playerName,
            groupName: groupName,
          }),
        );
        console.log(`📤 Sent JOIN_PLAYER: ${playerName} → ${groupName}`);
      }, 500);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("📨 Message from server:", data.type);

        switch (data.type) {
          case "PONG":
            console.log("💓 Heartbeat");
            break;

          case "JOIN_SUCCESS":
            console.log("✅ Joined successfully:", data);
            callbacksRef.current.onJoinSuccess?.(data);
            break;

          case "LOAD_AUDIO":
            console.log(
              "🎵 Received audio files from server:",
              data.audioFiles,
            );
            callbacksRef.current.onLoadAudio?.(data.audioFiles);
            break;

          case "START_PLAYBACK":
            console.log("▶️ Master sent START_PLAYBACK command");
            callbacksRef.current.onStartPlayback?.();
            break;

          default:
            console.log("⚠️ Unknown message type:", data.type);
        }
      } catch (error) {
        console.error("❌ Error parsing message:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("❌ WebSocket error:", error);
      callbacksRef.current.onConnected?.(false);
    };

    ws.onclose = () => {
      console.log("🔌 Disconnected from server");
      callbacksRef.current.onConnected?.(false);
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
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [wsUrl, playerName, groupName, enabled]); // 🆕 Add enabled to dependencies

  return wsRef;
}
