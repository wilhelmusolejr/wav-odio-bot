import React, { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom"; // 🆕 add

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8080/ws";

export default function Hidemium() {
  const { botName } = useParams(); // 🆕 read param

  const [connected, setConnected] = useState(false);
  const [botStatus, setBotStatus] = useState("available"); // 🆕 available | working
  const [groupName, setGroupName] = useState(null); // 🆕 assigned by master
  const [sessionStatus, setSessionStatus] = useState("idle"); // 🆕 speaking | idle | done
  const wsRef = useRef(null);

  // WebSocket connection
  useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("✅ Bot connected to WebSocket server");
      setConnected(true);
      ws.send(
        JSON.stringify({
          type: "JOIN_BOT",
          botName: botName || "anonymous-bot",
        }),
      );
      console.log("📤 Sent JOIN_BOT");
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("📨 Message from server:", data.type);

        switch (data.type) {
          case "PONG":
            console.log("💓 Heartbeat");
            break;

          case "BOT_ASSIGNED": // Master assigns bot to group
            console.log(`🤖 Assigned to group: ${data.groupName}`);
            setGroupName(data.groupName);
            setBotStatus("occupied");
            setSessionStatus(data.sessionStatus);
            break;

          case "BOT_RELEASED": // Master releases bot
            console.log("🔓 Bot released from group");
            setGroupName(null);
            setBotStatus("available");
            setSessionStatus("idle");
            break;

          case "SESSION_STATUS_UPDATE": // Update session status
            console.log(`📊 Session status: ${data.status}`);
            setSessionStatus(data.status); // speaking | idle | done
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

  const getSessionStatusColor = () => {
    switch (sessionStatus) {
      case "speaking":
        return "bg-yellow-500";
      case "idle":
        return "bg-gray-500";
      case "done":
        return "bg-green-500";
      default:
        return "bg-gray-500";
    }
  };

  const getBotStatusColor = () => {
    // 🆕 add this function
    return botStatus === "available" ? "bg-green-500" : "bg-blue-500";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <h1 className="text-5xl font-bold">🤖 Bot Control Panel</h1>
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
          <p className="text-gray-400 mt-2">
            Bot Name: {botName || "anonymous-bot"}
          </p>
        </div>

        {/* Bot Status Card */}
        <div className="bg-gray-800 rounded-lg p-8">
          {/* Bot Status */}
          <div className="mb-6 flex items-center justify-between">
            <span className="text-lg text-gray-300">Bot Status</span>
            <span className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${getBotStatusColor()}`}
              ></div>
              <span id="botStatus" className="text-lg font-bold capitalize">
                {botStatus}
              </span>
            </span>
          </div>

          {/* Group Name - show only if assigned */}
          <div className="mb-6 flex items-center justify-between">
            <span className="text-lg text-gray-300">Assigned Group</span>
            <span className="text-lg font-bold" id="groupName">
              {groupName ? `${groupName}` : "Not assigned"}
            </span>
          </div>

          {/* Session Status - show only if bot is working */}
          <div className="flex items-center justify-between">
            <span className="text-lg text-gray-300">Session Status</span>
            <span className="flex items-center gap-2">
              <div className={` ${getSessionStatusColor()}`}></div>
              <span className="text-lg font-bold capitalize" id="sessionStatus">
                {sessionStatus}
              </span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
