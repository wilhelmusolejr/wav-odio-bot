import React, { useState, useEffect, useRef } from "react";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8080/ws";

export default function Hidemium() {
  const [connected, setConnected] = useState(false);
  const [groups, setGroups] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState(new Set());
  const [botStatus, setBotStatus] = useState({});
  const wsRef = useRef(null);

  // WebSocket connection
  useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("✅ Hidemium connected to WebSocket server");
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
            if (data.botStatus) {
              setBotStatus(data.botStatus);
            }
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

  const handleCheckboxChange = (groupName) => {
    const isCurrentlySelected = selectedGroups.has(groupName);

    setSelectedGroups((prev) => {
      const newSelected = new Set(prev);
      if (newSelected.has(groupName)) {
        newSelected.delete(groupName);
      } else {
        newSelected.add(groupName);
      }
      return newSelected;
    });

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      if (isCurrentlySelected) {
        wsRef.current.send(
          JSON.stringify({
            type: "BOT_RELEASED",
            groupName: groupName,
          }),
        );
        console.log(`🔓 Released bot for: ${groupName}`);
      } else {
        wsRef.current.send(
          JSON.stringify({
            type: "BOT_ACQUIRED",
            groupName: groupName,
          }),
        );
        console.log(`🤖 Acquired bot for: ${groupName}`);
      }
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "no bot":
        return "bg-gray-500";
      case "acquired":
        return "bg-blue-500";
      case "running":
        return "bg-green-500";
      case "idle":
        return "bg-yellow-500";
      default:
        return "bg-gray-500";
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case "no bot":
        return "No Bot";
      case "acquired":
        return "Acquired";
      case "running":
        return "Running";
      case "idle":
        return "Idle";
      default:
        return "Unknown";
    }
  };

  const getSessionStatus = (group) => {
    return group.players.length > 0 ? "Active" : "Inactive";
  };

  const getSessionColor = (group) => {
    return group.players.length > 0 ? "bg-green-500" : "bg-gray-500";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <h1 className="text-5xl font-bold">🖥️ Hidemium Control</h1>

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

        {/* Groups Grid */}
        {groups.length === 0 ? (
          <div className="bg-gray-800 rounded-lg p-8 text-center">
            <p className="text-gray-400 text-lg">
              ⏳ Waiting for groups to load...
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {groups.map((group) => {
              const status = botStatus[group.name] || "no bot";
              const isSelected = selectedGroups.has(group.name);

              return (
                <div
                  key={group.name}
                  className={`bg-gray-800 rounded-lg p-6 hover:bg-gray-750 transition ${
                    isSelected ? "ring-2 ring-blue-500" : ""
                  }`}
                >
                  {/* 1. Group Name */}
                  <h3 className="text-2xl font-bold mb-6 text-blue-400">
                    🌐 {group.name}
                  </h3>

                  {/* 2. Session Status */}
                  <div className="mb-4 flex items-center justify-between">
                    <span className="text-sm text-gray-400">
                      Session Status
                    </span>
                    <span className="flex items-center gap-2">
                      <div
                        className={`w-2 h-2 rounded-full ${getSessionColor(group)}`}
                      ></div>
                      <span className="text-sm font-medium">
                        {getSessionStatus(group)} ({group.players.length}{" "}
                        players)
                      </span>
                    </span>
                  </div>

                  {/* 3. Bot Status */}
                  <div className="mb-6 flex items-center justify-between">
                    <span className="text-sm text-gray-400">Bot Status</span>
                    <span className="flex items-center gap-2">
                      <div
                        className={`w-2 h-2 rounded-full ${getStatusColor(status)}`}
                      ></div>
                      <span className="text-sm font-medium">
                        {getStatusText(status)}
                      </span>
                    </span>
                  </div>

                  {/* Checkbox - Acquire Bot */}
                  <label className="flex items-center gap-3 cursor-pointer p-3 bg-gray-700 rounded-lg hover:bg-gray-650 transition">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => handleCheckboxChange(group.name)}
                      className="w-5 h-5 accent-blue-500"
                    />
                    <span className="text-sm font-medium">
                      {isSelected ? "🔓 Release Bot" : "🤖 Acquire Bot"}
                    </span>
                  </label>
                </div>
              );
            })}
          </div>
        )}

        {/* Selected Groups Summary */}
        {selectedGroups.size > 0 && (
          <div className="mt-8 bg-gray-800 rounded-lg p-6">
            <h3 className="text-xl font-bold mb-4">
              🤖 Active Bots ({selectedGroups.size})
            </h3>
            <div className="flex flex-wrap gap-2">
              {Array.from(selectedGroups).map((groupName) => (
                <span
                  key={groupName}
                  className="px-3 py-1 bg-blue-600 rounded-full text-sm"
                >
                  {groupName}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
