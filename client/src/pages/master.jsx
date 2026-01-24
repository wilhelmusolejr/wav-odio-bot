import { useState, useRef, useEffect } from "react";
import NotificationList from "../components/NotificationList";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8080/ws";

export default function Master() {
  const [connected, setConnected] = useState(false);
  const [groups, setGroups] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [finishedPlayers, setFinishedPlayers] = useState({});
  const [groupSchedules, setGroupSchedules] = useState({}); // 🔥 UI state only, synced from server
  const [autoCycleEnabled, setAutoCycleEnabled] = useState(true);
  const [botStatus, setBotStatus] = useState({});

  // Scheduler control settings
  const [scheduleMode, setScheduleMode] = useState("randomize");
  const [scheduleTime, setScheduleTime] = useState("");
  const [selectedGroups, setSelectedGroups] = useState(new Set());

  const [bots, setBots] = useState([]);

  const wsRef = useRef(null);
  const groupsRef = useRef([]);

  console.log(bots);

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  // WebSocket setup
  useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("✅ Master connected");
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

            console.log("🤖 Initial bots:", data);

            setGroups(data.groups);
            if (data.bots) setBots(data.bots);

            // 🆕 Get initial schedules from server
            if (data.schedules) {
              console.log("📅 Initial schedules:", data.schedules);
              setGroupSchedules(data.schedules);
            }
            break;

          case "BOT_LIST_UPDATE": // 🆕 server broadcast of bots
            setBots(data.bots || []);
            break;

          case "PLAYER_FINISHED":
            handlePlayerFinished(data.playerName, data.groupName);
            break;

          case "REGENERATION_COMPLETE":
            handleRegenerationComplete(data.groupName);

            wsRef.current.send(
              JSON.stringify({
                type: "APPLY_SCHEDULE",
                mode: "randomize",
                time: scheduleTime,
                groupNames: Array.from(data.groupName),
              }),
            );
            break;

          case "BOT_STATUS_UPDATE":
            console.log(
              `🤖 Bot status update: ${data.groupName} → ${data.status}`,
            );
            setBotStatus((prev) => ({
              ...prev,
              [data.groupName]: data.status,
            }));
            break;

          case "SCHEDULES_UPDATE": // 🆕 Server broadcasts schedule updates
            console.log("📅 Schedules updated from server:", data.schedules);
            setGroupSchedules(data.schedules);
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
      console.log("🔌 Disconnected");
      setConnected(false);
    };

    wsRef.current = ws;

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

  const handlePlayerFinished = (playerName, groupName) => {
    console.log(`\n📥 Player finished: ${playerName} from group ${groupName}`);

    setNotifications((prev) => [
      {
        playerName,
        groupName,
        timestamp: new Date().toISOString(),
      },
      ...prev.slice(0, 4),
    ]);

    setFinishedPlayers((prev) => {
      const groupFinished = prev[groupName] || [];
      const updated = {
        ...prev,
        [groupName]: [...groupFinished, playerName],
      };

      const group = groupsRef.current.find((g) => g.name === groupName);

      if (group) {
        const allPlayerNames = group.players.map((p) => p.name);
        const finishedInGroup = updated[groupName];
        const allFinished = allPlayerNames.every((name) =>
          finishedInGroup.includes(name),
        );

        if (allFinished) {
          console.log(`\n🎉 ALL PLAYERS IN GROUP ${groupName} FINISHED!`);
          triggerRegeneration(groupName, allPlayerNames);

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: "RELEASE_BOT",
                groupName: groupName,
              }),
            );
            console.log(`🔓 Sent RELEASE_BOT for group ${groupName}`);
          }

          return {
            ...updated,
            [groupName]: [],
          };
        }
      }

      return updated;
    });
  };

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

  const handleRegenerationComplete = (groupName) => {
    console.log(`✅ Regeneration complete for group: ${groupName}`);

    setNotifications((prev) => [
      {
        playerName: "System",
        groupName: groupName,
        timestamp: new Date().toISOString(),
        message: "🔄 Regeneration complete - Ready for next cycle",
      },
      ...prev.slice(0, 4),
    ]);
  };

  const sendPlayCommand = (groupName) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
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

  // 🆕 Toggle group selection
  const toggleGroupSelection = (groupName) => {
    const newSelected = new Set(selectedGroups);
    if (newSelected.has(groupName)) {
      newSelected.delete(groupName);
    } else {
      newSelected.add(groupName);
    }
    setSelectedGroups(newSelected);
  };

  // 🆕 Apply schedule settings - SEND TO SERVER
  const applyScheduleSettings = () => {
    if (selectedGroups.size === 0) {
      alert("Please select at least one group");
      return;
    }

    if (scheduleMode === "time" && !scheduleTime) {
      alert("Please set a time");
      return;
    }

    // 🆕 Send to server instead of local state
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "APPLY_SCHEDULE",
          mode: scheduleMode,
          time: scheduleTime,
          groupNames: Array.from(selectedGroups),
        }),
      );
      console.log(
        `📤 Sent APPLY_SCHEDULE to server for ${selectedGroups.size} group(s)`,
      );
    }

    // Reset selections
    setSelectedGroups(new Set());
  };

  // 🆕 Format countdown
  const formatCountdown = (seconds) => {
    if (!seconds || seconds < 0) return "—";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  };

  // 🆕 Get status badge
  const getStatusBadge = (status, countdown) => {
    switch (status) {
      case "waiting":
        return (
          <span className="px-3 py-1 bg-blue-500 text-white text-xs font-semibold rounded-full">
            ⏳ {formatCountdown(countdown)} left
          </span>
        );
      case "speaking":
        return (
          <span className="px-3 py-1 bg-yellow-500 text-white text-xs font-semibold rounded-full animate-pulse">
            🎙️ Speaking
          </span>
        );
      case "done":
        return (
          <span className="px-3 py-1 bg-green-500 text-white text-xs font-semibold rounded-full">
            ✅ Done
          </span>
        );
      default:
        return (
          <span className="px-3 py-1 bg-gray-500 text-white text-xs font-semibold rounded-full">
            —
          </span>
        );
    }
  };

  const assignBotToGroup = (groupName) => {
    // Find available bot
    const availableBot = bots.find(
      (bot) => bot.status === "available" && !bot.hasGroup,
    );

    if (!availableBot) {
      alert("No available bots!");
      return;
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "ASSIGN_BOT",
          botName: availableBot.botName,
          groupName: groupName,
        }),
      );
      console.log(
        `📤 Assigning bot ${availableBot.botName} to group ${groupName}`,
      );
    }
  };

  const handlePlayButton = (groupName) => {
    sendPlayCommand(groupName);
    assignBotToGroup(groupName);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <h1 className="text-5xl font-bold">🎛️ Master Control</h1>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoCycleEnabled}
                  onChange={(e) => {
                    setAutoCycleEnabled(e.target.checked);
                    // 🆕 Send toggle to server
                    if (
                      wsRef.current &&
                      wsRef.current.readyState === WebSocket.OPEN
                    ) {
                      wsRef.current.send(
                        JSON.stringify({
                          type: "TOGGLE_AUTO_CYCLE",
                          enabled: e.target.checked,
                        }),
                      );
                    }
                  }}
                  className="w-4 h-4"
                />
                <span>🔄 Auto-Cycle</span>
              </label>

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
        </div>

        {/* 🆕 Bots list */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-bold mb-4">🤖 Bots ({bots.length})</h2>
          {bots.length === 0 ? (
            <p className="text-gray-400 text-sm">No bots connected.</p>
          ) : (
            <div className="space-y-2">
              {bots.map((bot, i) => (
                <div
                  key={bot.id || bot.botName || i}
                  className="flex items-center justify-between bg-gray-750 rounded-lg px-4 py-2"
                >
                  <span className="text-sm font-semibold">
                    {bot.botName || bot.name || "bot"}
                  </span>
                  <span className="text-xs text-gray-400">
                    {bot.status || "available"}
                    {bot.groupName ? ` · ${bot.groupName}` : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 🆕 SCHEDULER CONTROL PANEL */}
        <div className="bg-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-bold mb-4">🎚️ Schedule Control</h2>

          <div className="space-y-4">
            {/* Mode Selection */}
            <div>
              <label className="block text-sm font-semibold mb-3">
                Schedule Mode
              </label>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="mode"
                    value="randomize"
                    checked={scheduleMode === "randomize"}
                    onChange={(e) => setScheduleMode(e.target.value)}
                    className="w-4 h-4"
                  />
                  <span>🎲 Randomize (1-3hr)</span>
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="mode"
                    value="time"
                    checked={scheduleMode === "time"}
                    onChange={(e) => setScheduleMode(e.target.value)}
                    className="w-4 h-4"
                  />
                  <span>⏰ Set Time</span>
                </label>
              </div>
            </div>

            {/* Time Input (conditional) */}
            {scheduleMode === "time" && (
              <div>
                <label className="block text-sm font-semibold mb-2">
                  Time (HH:MM)
                </label>
                <input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                  className="bg-gray-700 px-3 py-2 rounded text-white"
                />
              </div>
            )}

            {/* Groups Selection List */}
            <div>
              <label className="block text-sm font-semibold mb-3">
                Apply to Groups
              </label>
              <div className="bg-gray-900 rounded-lg p-4 max-h-64 overflow-y-auto space-y-2">
                {groups.length === 0 ? (
                  <p className="text-gray-400 text-sm">
                    No groups available yet...
                  </p>
                ) : (
                  groups.map((group) => (
                    <label
                      key={group.name}
                      className="flex items-center gap-3 p-2 hover:bg-gray-800 rounded cursor-pointer transition"
                    >
                      <input
                        type="checkbox"
                        checked={selectedGroups.has(group.name)}
                        onChange={() => toggleGroupSelection(group.name)}
                        className="w-4 h-4"
                      />
                      <div className="flex-1">
                        <span className="text-sm font-medium">
                          {group.name}
                        </span>
                        <span className="text-xs text-gray-400 ml-2">
                          ({group.players.length} players)
                        </span>
                      </div>
                      {/* Show current status */}
                      <div className="text-xs">
                        {groupSchedules[group.name] && (
                          <span className="text-gray-400">
                            {groupSchedules[group.name].status === "waiting"
                              ? `⏳ ${formatCountdown(groupSchedules[group.name].countdown)}`
                              : groupSchedules[group.name].status === "speaking"
                                ? "🎙️ Speaking"
                                : "✅ Done"}
                          </span>
                        )}
                      </div>
                    </label>
                  ))
                )}
              </div>

              {/* Selected Count */}
              <p className="text-sm text-gray-400 mt-2">
                {selectedGroups.size > 0
                  ? `✅ ${selectedGroups.size} group(s) selected`
                  : "⚪ No groups selected"}
              </p>
            </div>

            {/* Submit Button */}
            <button
              onClick={applyScheduleSettings}
              className="w-full px-4 py-3 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={selectedGroups.size === 0}
            >
              ✅ Apply Schedule to Selected Groups
            </button>
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
            groups.map((group) => {
              const schedule = groupSchedules[group.name];
              const status = botStatus[group.name] || "no bot";

              return (
                <div
                  key={group.name}
                  className="bg-gray-800 rounded-lg p-6 transition hover:bg-gray-750"
                >
                  <div className="flex items-center justify-between mb-4">
                    {/* Group Info */}
                    <div className="flex-1">
                      <h3 className="text-xl font-bold">🌐 {group.name}</h3>
                      <p className="text-gray-400 text-sm">
                        👥 {group.players.length} player(s)
                        {finishedPlayers[group.name]?.length > 0 && (
                          <span className="text-green-400 ml-2">
                            ({finishedPlayers[group.name].length}/
                            {group.players.length} finished)
                          </span>
                        )}
                      </p>
                      {/* Bot Status */}
                      <p className="text-xs text-blue-400 mt-1">
                        {status === "acquired" && "🤖 Bot Acquired"}
                        {status === "running" && "▶️ Bot Running"}
                        {status === "idle" && "⏸️ Bot Idle"}
                        {status === "no bot" && "🔴 No Bot"}
                      </p>
                    </div>

                    {/* Status Badge & Controls */}
                    <div className="flex items-center gap-4">
                      {/* Status Badge */}
                      {schedule && autoCycleEnabled && (
                        <div>
                          {getStatusBadge(schedule.status, schedule.countdown)}
                        </div>
                      )}

                      {/* Play Button */}
                      <button
                        onClick={() => handlePlayButton(group.name)}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition disabled:opacity-50"
                        disabled={schedule?.isPlaying}
                      >
                        ▶️ Play Now
                      </button>
                    </div>
                  </div>

                  {/* Players List */}
                  <div className="space-y-2">
                    {group.players.map((player, idx) => (
                      <div
                        key={idx}
                        className="bg-gray-700 rounded-lg px-4 py-2 flex items-center justify-between"
                      >
                        <span className="text-gray-300">👤 {player.name}</span>
                        <span className="text-xs text-gray-500">
                          {player.clientId}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Notifications */}
        <NotificationList notifications={notifications} />
      </div>
    </div>
  );
}
