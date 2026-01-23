import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";

const WS_URL = import.meta.env.VITE_WS_URL || "ws://localhost:8080/ws";
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080";

export default function Master() {
  const [groups, setGroups] = useState([]);
  const [groupControls, setGroupControls] = useState({});
  const [userControls, setUserControls] = useState({});
  const [connected, setConnected] = useState(false);
  const [countdowns, setCountdowns] = useState({}); // Track countdown for each group
  const wsRef = useRef(null);
  const triggeredTimesRef = useRef(new Set()); // Track triggered times to avoid duplicate triggers
  const previousCountdownsRef = useRef({}); // Track previous countdown values

  // Calculate and update countdown for each group
  useEffect(() => {
    const countdownInterval = setInterval(() => {
      const now = new Date();
      const currentHours = now.getHours();
      const currentMinutes = now.getMinutes();
      const currentSeconds = now.getSeconds();

      const newCountdowns = {};

      groups.forEach((group) => {
        const scheduledTime = groupControls[group.name]?.time;
        if (scheduledTime) {
          const [hours, minutes] = scheduledTime.split(":").map(Number);

          // Calculate seconds until scheduled time
          let targetSeconds = hours * 3600 + minutes * 60;
          let currentTotalSeconds =
            currentHours * 3600 + currentMinutes * 60 + currentSeconds;

          let secondsUntil = targetSeconds - currentTotalSeconds;

          // If time has passed today, calculate for tomorrow
          if (secondsUntil <= 0) {
            secondsUntil += 86400; // 24 hours in seconds
          }

          // Convert to hh:mm:ss format
          const hoursLeft = Math.floor(secondsUntil / 3600);
          const minutesLeft = Math.floor((secondsUntil % 3600) / 60);
          const secondsLeft = secondsUntil % 60;

          newCountdowns[group.name] = {
            hours: hoursLeft,
            minutes: minutesLeft,
            seconds: secondsLeft,
            formatted: `${String(hoursLeft).padStart(2, "0")}:${String(minutesLeft).padStart(2, "0")}:${String(secondsLeft).padStart(2, "0")}`,
          };

          // Initialize previous countdown if not set
          if (previousCountdownsRef.current[group.name] === undefined) {
            previousCountdownsRef.current[group.name] = secondsUntil;
          }
        }
      });

      setCountdowns(newCountdowns);
    }, 1000); // Update every second

    return () => clearInterval(countdownInterval);
  }, [groups, groupControls]);

  // Monitor time and auto-trigger play when scheduled time is reached
  useEffect(() => {
    const timeCheckInterval = setInterval(() => {
      const now = new Date();
      const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      groups.forEach((group) => {
        const scheduledTime = groupControls[group.name]?.time;
        const countdown = countdowns[group.name];

        if (scheduledTime && countdown) {
          const totalSeconds =
            countdown.hours * 3600 + countdown.minutes * 60 + countdown.seconds;
          const previousSeconds =
            previousCountdownsRef.current[group.name] || totalSeconds;

          console.log(
            `⏱️ [${group.name}] Countdown check - Previous: ${previousSeconds}, Current: ${totalSeconds}`,
          );

          let triggerSecond = 16; // Default trigger second

          // Trigger when countdown transitions to 0-5 seconds (natural trigger)
          // OR when seconds go from positive to small number (within 5 seconds of target)
          if (
            (previousSeconds > triggerSecond &&
              totalSeconds <= triggerSecond &&
              totalSeconds >= 0) ||
            (previousSeconds > 0 && totalSeconds === 0)
          ) {
            // Check if we've already triggered this time
            const triggerKey = `${group.name}-${scheduledTime}`;
            if (!triggeredTimesRef.current.has(triggerKey)) {
              // Mark as triggered
              triggeredTimesRef.current.add(triggerKey);

              console.log(
                `🚀 Auto-trigger time reached! Assigning audio for group: ${group.name}`,
              );

              // 🆕 1️⃣ Send request to server to assign audio to all players
              if (
                wsRef.current &&
                wsRef.current.readyState === WebSocket.OPEN
              ) {
                wsRef.current.send(
                  JSON.stringify({
                    type: "ASSIGN_GROUP_AUDIO",
                    groupName: group.name,
                  }),
                );
                console.log(
                  `📤 Sent ASSIGN_GROUP_AUDIO request for ${group.name}`,
                );
              }

              // 3️⃣ Clear trigger after 1 minute (prevents duplicate triggers)
              setTimeout(() => {
                triggeredTimesRef.current.delete(triggerKey);
              }, 60000);
            }
          }

          // Update previous countdown value
          previousCountdownsRef.current[group.name] = totalSeconds;
        }
      });
    }, 1000); // Check every second (more responsive)

    return () => clearInterval(timeCheckInterval);
  }, [groups, groupControls, countdowns]);

  // Initialize WebSocket connection
  useEffect(() => {
    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("✅ Connected to WebSocket server");
      setConnected(true);

      // Send master join message
      ws.send(
        JSON.stringify({
          type: "MASTER_JOIN",
        }),
      );

      // Send ping every 30 seconds to keep connection alive
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "PING" }));
        }
      }, 30000);

      return () => clearInterval(pingInterval);
    };

    // 🆕 Add handler for when all players are ready
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("📨 Message from server:", data.type);

        switch (data.type) {
          case "INITIAL_GROUPS":
            handleInitialGroups(data.groups);
            break;

          case "UPDATE_GROUPS":
            handleGroupsUpdate(data.groups);
            break;

          case "GROUP_PLAYBACK_COMPLETE":
            handleGroupPlaybackComplete(data.groupName);
            break;

          case "SESSION_CYCLE_COMPLETE":
            handleSessionCycleComplete(data.groupName, data.newScheduledTime);
            break;

          case "SESSION_CYCLE_ERROR":
            console.error(
              `❌ Session cycle error: ${data.groupName}`,
              data.error,
            );
            break;

          case "GROUP_PLAYBACK_STATUS":
            handleGroupPlaybackStatus(
              data.groupName,
              data.finishedCount,
              data.totalCount,
            );
            break;

          case "AUDIO_BALANCE_RESULT":
            handleAudioBalanceResult(data.groupName, data.result);
            break;

          case "ALL_PLAYERS_READY":
            handleAllPlayersReady(data.groupName);
            break;

          case "ERROR":
            console.error("Server error:", data.message);
            break;

          default:
            console.log("Unknown message type:", data.type);
        }
      } catch (error) {
        console.error("Error parsing WebSocket message:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("❌ WebSocket error:", error);
      setConnected(false);
    };

    ws.onclose = () => {
      console.log("🔌 Disconnected from WebSocket server");
      setConnected(false);
    };

    wsRef.current = ws;

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, []);

  function handleAudioBalanceResult(groupName, result) {
    console.log(`\n📊 Audio Balance Result for ${groupName}:`);
    console.log(`   Max count: ${result.maxCount}`);
    console.log(
      `   Players needing audio: ${result.playersNeedingAudio.length}`,
    );

    result.audioCounts.forEach(({ username, count, files }) => {
      const status = count < result.maxCount ? "⚠️ NEEDS AUDIO" : "✅ OK";
      console.log(`\n   ${status} ${username}: ${count} files`);

      // ✅ Log file details
      if (files && files.length > 0) {
        console.log(`   Files:`);
        files.forEach((file, index) => {
          console.log(`     ${index + 1}. ${file.filename}`);
          console.log(`        URL: ${file.s3Url}`);
          console.log(`        Size: ${(file.size / 1024).toFixed(2)} KB`);
        });
      }
    });

    if (result.playersNeedingAudio.length > 0) {
      const playerNames = result.playersNeedingAudio
        .map((p) => p.username)
        .join(", ");
      console.log(`\n⚠️ Players needing audio generation: ${playerNames}`);
    } else {
      console.log(`\n✅ All players have balanced audio counts`);
    }
  }

  function handleInitialGroups(serverGroups) {
    setGroups(serverGroups);

    // Initialize controls state
    const groupControlsInit = {};
    const userControlsInit = {};

    serverGroups.forEach((group) => {
      groupControlsInit[group.name] = { isPlaying: false, time: "08:00" };

      if (group.users && group.users.length > 0) {
        group.users.forEach((user) => {
          userControlsInit[user.id] = { isPlaying: user.isPlaying || false };
        });
      }
    });

    setGroupControls(groupControlsInit);
    setUserControls(userControlsInit);
  }

  function handleGroupsUpdate(serverGroups) {
    setGroups(serverGroups);

    // Update user controls with server state
    const userControlsUpdate = {};
    serverGroups.forEach((group) => {
      if (group.users && group.users.length > 0) {
        group.users.forEach((user) => {
          userControlsUpdate[user.id] = {
            isPlaying: user.isPlaying || false,
          };
        });
      }
    });

    setUserControls(userControlsUpdate);
  }

  function handleGroupPlaybackComplete(groupName) {
    console.log(
      `✅ [${groupName}] All players finished playing! Auto-pausing...`,
    );

    // Auto-pause the group
    setGroupControls((prev) => ({
      ...prev,
      [groupName]: { ...prev[groupName], isPlaying: false },
    }));

    // Send pause command to all players
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "UPDATE_GROUP_CONTROL",
          groupName,
          control: {
            isPlaying: false,
            time: groupControls[groupName]?.time || "08:00",
          },
        }),
      );
    }
  }

  function handleSessionCycleComplete(groupName, newScheduledTime) {
    console.log(
      `🔄 [${groupName}] Session cycle complete! New time: ${newScheduledTime}`,
    );

    // Update scheduled time
    setGroupControls((prev) => ({
      ...prev,
      [groupName]: {
        ...prev[groupName],
        time: newScheduledTime,
        isPlaying: false,
      },
    }));

    // Clear old trigger
    const oldTrigger = `${groupName}-${groupControls[groupName]?.time}`;
    triggeredTimesRef.current.delete(oldTrigger);

    // Reset countdown tracking
    delete previousCountdownsRef.current[groupName];

    console.log(`✅ Updated ${groupName} schedule to ${newScheduledTime}`);
  }

  function handleGroupPlaybackStatus(groupName, finishedCount, totalCount) {
    console.log(
      `📊 [${groupName}] Playback status: ${finishedCount}/${totalCount} players finished`,
    );
  }

  // 🆕 Handle when all players in group are ready
  function handleAllPlayersReady(groupName) {
    console.log("\n🎉 ===== ALL PLAYERS READY =====");
    console.log(`Group: ${groupName}`);
    console.log(`All players have loaded their audio files!`);
    console.log("================================\n");

    // 🎵 Auto-start playback when all players are ready
    console.log(`▶️ Starting playback for ${groupName}...`);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "UPDATE_GROUP_CONTROL",
          groupName: groupName,
          control: {
            isPlaying: true,
            currentAudioIndex: 0,
          },
        }),
      );
      console.log(`✅ Sent START_PLAYBACK command to ${groupName}`);
    }

    // Update local state to playing
    setGroupControls((prev) => ({
      ...prev,
      [groupName]: { ...prev[groupName], isPlaying: true },
    }));
  }

  const toggleGroupPlayPause = (groupName) => {
    const newState = !groupControls[groupName]?.isPlaying;
    const time = groupControls[groupName]?.time || "08:00";

    // If playing (turning on), first assign audio to players
    if (newState === true) {
      console.log(
        `🎵 Play button pressed for ${groupName} - Assigning audio first...`,
      );

      // Send ASSIGN_GROUP_AUDIO request to server
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "ASSIGN_GROUP_AUDIO",
            groupName: groupName,
          }),
        );
        console.log(`📤 Sent ASSIGN_GROUP_AUDIO for ${groupName}`);
        console.log(`⏳ Waiting for all players to be ready...`);
      }

      // Don't update state yet - wait for ALL_PLAYERS_READY event
      return;
    }

    // If pausing, just send the control update
    setGroupControls((prev) => ({
      ...prev,
      [groupName]: { ...prev[groupName], isPlaying: newState },
    }));

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "UPDATE_GROUP_CONTROL",
          groupName,
          control: {
            isPlaying: newState,
            time,
          },
        }),
      );
    }
  };

  const toggleUserPlayPause = (userId) => {
    setUserControls((prev) => ({
      ...prev,
      [userId]: { ...prev[userId], isPlaying: !prev[userId].isPlaying },
    }));
  };

  const randomizeTime = (groupName) => {
    const randomHour = String(Math.floor(Math.random() * 24)).padStart(2, "0");
    const randomMinute = String(Math.floor(Math.random() * 60)).padStart(
      2,
      "0",
    );
    const time = `${randomHour}:${randomMinute}`;

    setGroupControls((prev) => ({
      ...prev,
      [groupName]: { ...prev[groupName], time },
    }));

    // Send to server
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const isPlaying = groupControls[groupName]?.isPlaying || false;
      wsRef.current.send(
        JSON.stringify({
          type: "UPDATE_GROUP_CONTROL",
          groupName,
          control: {
            isPlaying,
            time,
          },
        }),
      );
    }
  };

  const updateTime = (groupName, value) => {
    setGroupControls((prev) => ({
      ...prev,
      [groupName]: { ...prev[groupName], time: value || "" },
    }));
  };

  const formatTime = (timeString) => {
    if (!timeString) return "Not set";
    const [hours, minutes] = timeString.split(":");
    const hour = parseInt(hours);
    const minute = parseInt(minutes);
    const period = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${String(minute).padStart(2, "0")} ${period}`;
  };

  const checkAudioBalance = (groupName) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      console.log(`🔍 Checking audio balance for group: ${groupName}`);
      wsRef.current.send(
        JSON.stringify({
          type: "CHECK_AUDIO_BALANCE",
          groupName: groupName,
        }),
      );
    } else {
      console.error("WebSocket not connected");
    }
  };

  const handlePlayGroup = (groupName) => {
    console.log(`▶️ Play button clicked for: ${groupName}`);

    // Simply tell players to start playing whatever audio they have loaded
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "START_GROUP_PLAYBACK",
          groupName,
        }),
      );
      console.log(`📤 Sent START_GROUP_PLAYBACK to ${groupName}`);
    }

    setGroupControls((prev) => ({
      ...prev,
      [groupName]: { ...prev[groupName], isPlaying: true },
    }));
  };

  const handlePauseGroup = (groupName) => {
    console.log(`⏸️ Pausing group: ${groupName}`);

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: "UPDATE_GROUP_CONTROL",
          groupName,
          control: {
            isPlaying: false,
            time: groupControls[groupName]?.time,
          },
        }),
      );
    }

    setGroupControls((prev) => ({
      ...prev,
      [groupName]: { ...prev[groupName], isPlaying: false },
    }));
  };

  return (
    <div className="min-h-screen bg-black relative overflow-hidden py-16">
      {/* Floating gradient background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          animate={{
            x: [0, 50, -50, 0],
            y: [0, -50, 50, 0],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute -top-40 -left-40 w-80 h-80 bg-gradient-to-br from-white via-gray-400 to-gray-300 rounded-full blur-3xl opacity-20"
        />
        <motion.div
          animate={{
            x: [0, -50, 50, 0],
            y: [0, 50, -50, 0],
          }}
          transition={{
            duration: 10,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute -bottom-40 -right-40 w-80 h-80 bg-gradient-to-tl from-white via-gray-300 to-gray-400 rounded-full blur-3xl opacity-20"
        />
        <motion.div
          animate={{
            x: [0, 40, -40, 0],
            y: [0, -40, 40, 0],
          }}
          transition={{
            duration: 12,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute top-1/2 left-1/2 w-60 h-60 bg-gradient-to-r from-white via-gray-300 to-gray-200 rounded-full blur-3xl opacity-15"
        />
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-7xl mx-auto py-16">
        {/* Heading with Connection Status */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-5xl font-bold text-white">⚙️ Master Control</h1>
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  connected ? "bg-green-400" : "bg-red-400"
                }`}
              ></div>
              <span className="text-sm font-semibold text-gray-300">
                {connected ? "Connected" : "Disconnected"}
              </span>
            </div>
          </div>
          <p className="text-gray-400">
            {groups.length === 0
              ? "Waiting for server..."
              : `${groups.length} group${groups.length !== 1 ? "s" : ""} • ${groups.reduce((sum, g) => sum + (g.users?.length || 0), 0)} player${groups.reduce((sum, g) => sum + (g.users?.length || 0), 0) !== 1 ? "s" : ""}`}
          </p>
        </div>

        {/* Groups Grid */}
        {groups.length === 0 ? (
          <div className="max-w-md mx-auto">
            <div className="bg-gray-900 border-2 border-gray-700 rounded-xl p-8 text-center">
              <div className="text-4xl mb-4">📭</div>
              <h2 className="text-2xl font-bold text-white mb-2">
                No Groups Available
              </h2>
              <p className="text-gray-400 mb-2">
                {connected
                  ? "Waiting for player connections..."
                  : "Connecting to server..."}
              </p>
              <p className="text-sm text-gray-500">
                {connected
                  ? "Players will appear here when they join"
                  : "Please wait while we establish a connection"}
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6 mb-8">
            {groups.map((group) => (
              <div
                key={group.name}
                className="bg-gray-900 border border-gray-700 rounded-xl shadow-lg p-6 flex flex-col hover:border-gray-500 transition"
              >
                {/* Group Header */}
                <h2 className="text-xl font-bold text-white mb-2">
                  📁 {group.name}
                </h2>
                <p className="text-xs text-gray-500 mb-4">
                  RDP: {group.rdpName}
                </p>

                {/* Group Controls Form */}
                <div className="bg-gray-800 p-4 rounded-lg mb-4 border border-gray-700 flex-grow">
                  <div className="mb-4">
                    <label className="block text-xs font-semibold text-gray-300 mb-2 uppercase tracking-wider">
                      ⏰ Time
                    </label>
                    <input
                      type="time"
                      value={groupControls[group.name]?.time || ""}
                      onChange={(e) => updateTime(group.name, e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-gray-600 rounded-lg focus:border-gray-400 focus:outline-none bg-gray-700 text-white"
                    />
                    <p className="text-xs text-gray-400 mt-2 font-medium">
                      {formatTime(groupControls[group.name]?.time)}
                    </p>
                    {countdowns[group.name] && (
                      <p className="text-xs text-blue-400 mt-1 font-semibold">
                        ⏳ Countdown: {countdowns[group.name].formatted}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => randomizeTime(group.name)}
                    className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-2 rounded-lg transition text-sm mb-3 border border-gray-600"
                  >
                    🎲 Randomize
                  </button>

                  {/* Group Play/Pause Button */}
                  <button
                    onClick={() => {
                      const isCurrentlyPlaying =
                        groupControls[group.name]?.isPlaying;
                      if (isCurrentlyPlaying) {
                        handlePauseGroup(group.name);
                      } else {
                        handlePlayGroup(group.name);
                      }
                    }}
                    className={`px-4 py-2 rounded-lg font-semibold transition ${
                      groupControls[group.name]?.isPlaying
                        ? "bg-gray-600 hover:bg-gray-700 text-white"
                        : "bg-green-600 hover:bg-green-700 text-white"
                    }`}
                  >
                    {groupControls[group.name]?.isPlaying
                      ? "⏸ Pause Group"
                      : "▶ Play Group"}
                  </button>

                  {/* 🆕 Add this test button */}
                  <button
                    onClick={() => checkAudioBalance(group.name)}
                    className="px-3 py-1 bg-purple-600 hover:bg-purple-700 rounded text-sm"
                  >
                    🔍 Check Audio Balance
                  </button>
                </div>

                {/* Users List */}
                <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
                  <h3 className="text-sm font-semibold text-gray-200 mb-3 uppercase tracking-wider">
                    👥 Users ({group.users?.length || 0})
                  </h3>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {group.users && group.users.length > 0 ? (
                      group.users.map((user) => (
                        <div
                          key={user.id}
                          className="flex items-center justify-between bg-gray-700 p-2 rounded border border-gray-600 hover:border-gray-500 transition"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-100 text-xs truncate">
                              {user.name}
                            </p>
                          </div>
                          <button
                            onClick={() => toggleUserPlayPause(user.id)}
                            className={`font-semibold py-1 px-3 rounded transition text-xs ml-2 flex-shrink-0 border ${
                              userControls[user.id]?.isPlaying
                                ? "bg-gray-600 text-white border-gray-500 hover:bg-gray-500"
                                : "bg-gray-700 text-gray-300 border-gray-600 hover:border-gray-500"
                            }`}
                          >
                            {userControls[user.id]?.isPlaying ? "⏸" : "▶"}
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="text-xs text-gray-500 text-center py-2">
                        No players connected
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
