import { useState, useRef, useEffect } from "react";
import GroupCard from "../components/GroupCard";
import NotificationList from "../components/NotificationList";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8080/ws";

export default function Master() {
  const [connected, setConnected] = useState(false);
  const [groups, setGroups] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [finishedPlayers, setFinishedPlayers] = useState({}); // Track finished players per group
  const wsRef = useRef(null);
  const groupsRef = useRef([]); // 🆕 Add ref to track latest groups

  // 🆕 Keep groupsRef in sync with groups state
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  // Initialize WebSocket connection
  useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("✅ Master connected to WebSocket server");
      setConnected(true);

      ws.send(JSON.stringify({ type: "JOIN_MASTER" }));
      console.log("📤 Sent JOIN_MASTER");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("📨 Message from server:", data.type);

        switch (data.type) {
          case "PONG":
            console.log("💓 Heartbeat");
            break;

          case "GROUPS_UPDATE":
            console.log("📊 Groups updated:", data.groups);
            setGroups(data.groups);
            break;

          case "INITIAL_GROUPS":
            console.log("📋 Initial groups:", data.groups);
            setGroups(data.groups);
            break;

          case "PLAYER_FINISHED":
            handlePlayerFinished(data.playerName, data.groupName);
            break;

          case "REGENERATION_COMPLETE":
            console.log(
              `✅ Regeneration complete for group: ${data.groupName}`,
            );
            handleRegenerationComplete(data.groupName);
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
      setConnected(false);
    };

    ws.onclose = () => {
      console.log("🔌 Disconnected from server");
      setConnected(false);
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
  }, []);

  // 🆕 Handle player finished notification
  const handlePlayerFinished = (playerName, groupName) => {
    console.log(`\n📥 Player finished: ${playerName} from group ${groupName}`);

    // Add notification
    setNotifications((prev) => [
      {
        playerName,
        groupName,
        timestamp: new Date().toISOString(),
      },
      ...prev.slice(0, 4), // Keep last 5
    ]);

    // Track finished player
    setFinishedPlayers((prev) => {
      const groupFinished = prev[groupName] || [];
      const updated = {
        ...prev,
        [groupName]: [...groupFinished, playerName],
      };

      // 🔥 Use groupsRef instead of groups (latest value)
      const group = groupsRef.current.find((g) => g.name === groupName);

      console.log(`🔍 Looking for group: ${groupName}`);
      console.log(
        `   Available groups:`,
        groupsRef.current.map((g) => g.name),
      );
      console.log(`   Found group:`, group ? "Yes" : "No");

      if (group) {
        const allPlayerNames = group.players.map((p) => p.name);
        const finishedInGroup = updated[groupName];

        const allFinished = allPlayerNames.every((name) =>
          finishedInGroup.includes(name),
        );

        console.log(`📊 Group ${groupName} progress:`);
        console.log(
          `   Total players: ${allPlayerNames.length} (${allPlayerNames.join(
            ", ",
          )})`,
        );
        console.log(
          `   Finished: ${finishedInGroup.length}/${allPlayerNames.length}`,
        );
        console.log(`   Players finished: ${finishedInGroup.join(", ")}`);
        console.log(`   All finished? ${allFinished ? "YES ✅" : "NO ❌"}`);

        if (allFinished) {
          console.log(`\n🎉 ALL PLAYERS IN GROUP ${groupName} FINISHED!`);
          console.log(`🔄 Triggering audio regeneration workflow...\n`);

          // Trigger regeneration on server
          triggerRegeneration(groupName, allPlayerNames);

          // Reset tracking for this group
          return {
            ...updated,
            [groupName]: [],
          };
        }
      } else {
        console.warn(`⚠️ Group ${groupName} not found in current groups list`);
      }

      return updated;
    });
  };

  // 🆕 Trigger regeneration workflow on server
  const triggerRegeneration = (groupName, playerNames) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "TRIGGER_REGENERATION",
          groupName: groupName,
          playerNames: playerNames,
        }),
      );
      console.log(`📤 Sent TRIGGER_REGENERATION for group: ${groupName}`);
    }
  };

  // 🆕 Handle regeneration complete
  const handleRegenerationComplete = (groupName) => {
    console.log(`\n✅ ===== REGENERATION COMPLETE =====`);
    console.log(`   Group: ${groupName}`);
    console.log(`   Ready for next cycle!`);
    console.log(`===================================\n`);

    // Add success notification
    setNotifications((prev) => [
      {
        playerName: "System",
        groupName: groupName,
        timestamp: new Date().toISOString(),
        message: "🔄 Audio regeneration complete - Ready for next cycle",
      },
      ...prev.slice(0, 4),
    ]);

    // 🆕 Auto-start next cycle (optional)
    // setTimeout(() => {
    //   console.log(`▶️ Auto-starting next cycle for ${groupName}...`);
    //   sendPlayCommand(groupName);
    // }, 5000); // Wait 5 seconds before starting next cycle
  };

  const sendPlayCommand = (groupName) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      // Reset finished players tracking for this group
      setFinishedPlayers((prev) => ({
        ...prev,
        [groupName]: [],
      }));

      wsRef.current.send(
        JSON.stringify({
          type: "PLAY_AUDIO",
          groupName: groupName,
        }),
      );
      console.log(`🎵 Sent PLAY_AUDIO command to group: ${groupName}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <h1 className="text-5xl font-bold">🎛️ Master Control</h1>

            {/* Connection Status */}
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  connected ? "bg-green-400" : "bg-red-400"
                }`}
              ></div>
              <span className="text-sm font-semibold">
                {connected ? "Connected" : "Disconnected"}
              </span>
            </div>
          </div>
        </div>

        {/* Groups Display */}
        <div className="space-y-4">
          <h2 className="text-2xl font-bold">
            📊 Active Groups ({groups.length})
          </h2>

          {groups.length === 0 ? (
            <div className="bg-gray-800 rounded-lg p-8 text-center">
              <p className="text-gray-400 text-lg">
                ⏳ Waiting for players to join...
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <GroupCard
                key={group.name}
                group={group}
                onPlayAudio={sendPlayCommand}
                finishedCount={finishedPlayers[group.name]?.length || 0}
              />
            ))
          )}
        </div>

        <NotificationList notifications={notifications} />
      </div>
    </div>
  );
}
