import React, { useState, useEffect, useRef } from "react";
import Orbs from "../components/Orbs";
import GroupCard from "../components/master/GroupCard";
import SchedulePanel from "../components/master/SchedulePanel";

export default function Bonk() {
  // State management
  const [groups, setGroups] = useState([]);
  const [bots, setBots] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const playTriggeredRef = useRef(new Set());

  // Audio generation state
  const [allAccounts, setAllAccounts] = useState([]);
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [numAudioFiles, setNumAudioFiles] = useState(5);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStatus, setGenerationStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // WebSocket reference
  const ws = useRef(null);

  // WebSocket connection
  // WebSocket connection
  useEffect(() => {
    // Connect to WebSocket server
    const wsUrl = "ws://localhost:8080/ws";
    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      console.log("✅ WebSocket connected");
      setIsConnected(true);

      // Join as master
      ws.current.send(
        JSON.stringify({
          type: "JOIN_MASTER",
        }),
      );
    };

    ws.current.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log("📨 Received:", msg.type, msg);

        // Handle different message types
        switch (msg.type) {
          case "INITIAL_STATE":
          case "STATE_UPDATE":
            setGroups(msg.data.groups || []);
            setBots(msg.data.bots || []);
            checkAllPlayersReady(msg.groups || []);
            break;

          case "CONNECTED":
            console.log("🎉 Connected:", msg.clientId);
            break;

          case "PONG":
            console.log("🏓 Pong received");
            break;

          default:
            console.log("⚠️ Unknown message type:", msg.type);
        }
      } catch (error) {
        console.error("❌ Error parsing message:", error);
      }
    };

    ws.current.onerror = (error) => {
      console.error("❌ WebSocket error:", error);
    };

    ws.current.onclose = () => {
      console.log("🔌 WebSocket disconnected");
      setIsConnected(false);
    };

    // Cleanup on unmount
    return () => {
      if (ws.current) {
        ws.current.close();
      }
    };
  }, []);

  // Fetch all accounts for audio generation
  useEffect(() => {
    fetch("http://localhost:8080/api/accounts/all")
      .then((res) => res.json())
      .then((data) => {
        setAllAccounts(data.accounts || []);
      })
      .catch((err) => console.error("Failed to fetch accounts:", err));
  }, []);

  // Audio generation handlers
  const handleUserToggle = (username) => {
    setSelectedUsers((prev) =>
      prev.includes(username)
        ? prev.filter((u) => u !== username)
        : [...prev, username],
    );
  };

  const handleSelectAll = () => {
    if (selectedUsers.length === allAccounts.length) {
      setSelectedUsers([]);
    } else {
      setSelectedUsers(allAccounts.map((a) => a.username));
    }
  };

  const handleGenerateAudio = async () => {
    if (selectedUsers.length === 0) {
      setGenerationStatus("Please select at least one user");
      return;
    }

    setIsGenerating(true);
    setGenerationStatus(
      `Starting audio generation for ${selectedUsers.length} user(s)...`,
    );

    try {
      const response = await fetch("http://localhost:8080/api/generate-audio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          usernames: selectedUsers,
          numFiles: numAudioFiles,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setGenerationStatus(
          `Audio generation started for: ${selectedUsers.join(", ")}. Check server console for progress.`,
        );
      } else {
        setGenerationStatus(`Error: ${data.error}`);
      }
    } catch (error) {
      setGenerationStatus(`Failed to start generation: ${error.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUpdateSchedule = (mode, selectedGroups, config) => {
    // Send to server via WebSocket
    ws.current.send(
      JSON.stringify({
        type: "APPLY_SCHEDULE",
        mode: mode, // "right_now" | "randomize" | "set_time"
        config: {
          randomMin: config.randomMin,
          randomMax: config.randomMax,
          timeValue: config.timeValue,
        },
        groupNames: selectedGroups,
      }),
    );
  };

  const handleAutoPlayTrigger = (group) => {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) return;
    ws.current.send(
      JSON.stringify({
        type: "AUTO_PLAY_TRIGGERED",
        groupId: group.id,
        groupName: group.groupName,
      }),
    );

    console.log("🚀 Auto-play triggered for group:", group.groupName);
  };

  const checkAllPlayersReady = (updatedGroups) => {
    updatedGroups.forEach((group) => {
      // Skip if already triggered
      if (playTriggeredRef.current.has(group.id)) return;

      // Check if group has players and all are ready
      if (
        group.players &&
        group.players.length > 0 &&
        group.players.every((p) => p.status === "ready")
      ) {
        console.log(
          `✅ All players ready in ${group.groupName}, triggering play...`,
        );
        playTriggeredRef.current.add(group.id);

        // Send PLAY_AUDIO to server
        if (ws.current && ws.current.readyState === WebSocket.OPEN) {
          ws.current.send(
            JSON.stringify({
              type: "PLAY_AUDIO",
              groupId: group.id,
              groupName: group.groupName,
            }),
          );
        }
      }
    });
  };

  console.log("👥 Groups:", groups);
  console.log("🤖 Bots:", bots);

  return (
    <>
      <div className="relative min-h-screen w-full overflow-hidden bg-gradient-to-br from-black via-zinc-900 to-black text-white">
        {/* FLOATING */}
        <Orbs />

        {/* WRAPPER */}
        <div className="max-w-7xl mx-auto pb-40">
          {/* heading */}
          <div className="text-white text-center text-7xl font-semibold pt-32 pb-24">
            <h1>Master Control</h1>
          </div>

          {/* content */}
          <div className="grid grid-cols-[70%_1fr] gap-5">
            {/* side 1 */}
            <div className="border bg-black/10 border-white/10 rounded-lg grid grid-cols-3 gap-5 p-5 items-start">
              {groups.map((group, index) => (
                <GroupCard
                  key={index}
                  data={group}
                  onCountdownZero={(group) => handleAutoPlayTrigger(group)}
                />
              ))}
            </div>
            {/* side 2 */}
            <div className="bg-black/10 border border-white/10 rounded-lg p-5 flex flex-col gap-5">
              {/* schedule */}
              <SchedulePanel
                groups={groups}
                onUpdateSchedule={handleUpdateSchedule}
              />

              {/* bots */}
              <div className="w-full">
                {/* header */}
                <div className="flex items-center justify-between mb-5 border-b border-white/10 pb-2">
                  <h2 className="text-2xl capitalize font-semibold text-white/90 group-hover:text-white transition-colors">
                    Bot
                  </h2>
                  <div className="text-[10px] text-white/40 font-mono flex gap-3">
                    <span>● REC: 3</span>
                    <span>○ IDLE: 5</span>
                  </div>
                </div>

                {/* Table Headers */}
                <div className="grid grid-cols-2  py-1 text-[9px] uppercase font-bold tracking-[0.15em] text-white/20">
                  <div>Identifier</div>
                  <div className="text-right">Activity State</div>
                </div>

                {/* Streamlined List */}
                <div className="divide-y divide-white/5 border-t border-white/5">
                  {bots.map((bot, index) => (
                    <div
                      key={index}
                      className="grid grid-cols-2 items-center  py-2.5 hover:bg-white/[0.02] transition-colors group"
                    >
                      {/* Bot Name */}
                      <div className="text-sm font-medium text-white/70 group-hover:text-white transition-colors">
                        {bot.name}
                      </div>

                      {/* State Indicator */}
                      <div className="text-right">
                        <span
                          className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded ${
                            bot.state === "recording"
                              ? "text-rose-500 bg-rose-500/5 border border-rose-500/10"
                              : bot.state === "break time"
                                ? "text-amber-500 bg-amber-500/5 border border-amber-500/10"
                                : "text-emerald-500 bg-emerald-500/5 border border-emerald-500/10"
                          }`}
                        >
                          {bot.state === "recording" && (
                            <span className="inline-block w-1 h-1 rounded-full bg-rose-500 animate-pulse mr-1.5 mb-0.5"></span>
                          )}
                          {bot.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Audio Generation */}
              <div className="w-full border-t border-white/10 pt-5 flex-1 flex flex-col min-h-0">
                {/* header */}
                <div className="flex items-center justify-between mb-5 border-b border-white/10 pb-2">
                  <h2 className="text-2xl capitalize font-semibold text-white/90">
                    Generate Audio
                  </h2>
                </div>

                {/* Number of files input */}
                <div className="mb-4">
                  <label className="text-xs uppercase font-bold tracking-wider text-white/40 mb-2 block">
                    Files per user
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={numAudioFiles}
                    onChange={(e) => setNumAudioFiles(parseInt(e.target.value))}
                    className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-white/30"
                  />
                </div>

                {/* Search input */}
                <div className="mb-3">
                  <input
                    type="text"
                    placeholder="Search users..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-white/30 placeholder-white/30"
                  />
                </div>

                {/* Select all button */}
                <div className="mb-3">
                  <button
                    onClick={handleSelectAll}
                    className="text-xs text-white/50 hover:text-white/80 transition-colors"
                  >
                    {selectedUsers.length === allAccounts.length
                      ? "Deselect All"
                      : "Select All"}
                  </button>
                </div>

                {/* User checkboxes */}
                <div className="flex-1 overflow-y-auto mb-4 space-y-2">
                  {allAccounts
                    .filter((account) => {
                      const q = searchQuery.toLowerCase();
                      return (
                        account.username.toLowerCase().includes(q) ||
                        (account.discordName &&
                          account.discordName.toLowerCase().includes(q))
                      );
                    })
                    .map((account) => (
                      <label
                        key={account.username}
                        className="flex items-center gap-3 cursor-pointer hover:bg-white/5 p-2 rounded transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedUsers.includes(account.username)}
                          onChange={() => handleUserToggle(account.username)}
                          className="w-4 h-4 rounded border-white/20 bg-white/5 text-emerald-500 focus:ring-0 focus:ring-offset-0"
                        />
                        <span className="text-sm text-white/70">
                          {account.username}
                          {account.discordName && (
                            <span className="text-white/30 ml-2">
                              ({account.discordName})
                            </span>
                          )}
                        </span>
                      </label>
                    ))}
                </div>

                {/* Generate button */}
                <button
                  onClick={handleGenerateAudio}
                  disabled={isGenerating || selectedUsers.length === 0}
                  className={`w-full py-3 rounded font-semibold text-sm uppercase tracking-wider transition-all ${
                    isGenerating || selectedUsers.length === 0
                      ? "bg-white/10 text-white/30 cursor-not-allowed"
                      : "bg-emerald-600 hover:bg-emerald-500 text-white"
                  }`}
                >
                  {isGenerating ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Generating...
                    </span>
                  ) : (
                    `Generate Audio (${selectedUsers.length} selected)`
                  )}
                </button>

                {/* Status message */}
                {generationStatus && (
                  <p className="mt-3 text-xs text-white/50 text-center">
                    {generationStatus}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Connection Status */}
        <div className="absolute top-6 right-6">
          <div className="flex items-center gap-3">
            <div
              className={`h-3 w-3 rounded-full ${isConnected ? "bg-green-400" : "bg-red-400"}`}
            ></div>
            <p className="uppercase font-medium text-sm">
              {isConnected ? "Connected" : "Disconnected"}
            </p>
          </div>
        </div>

        {/* Debug Info */}
        <div className="absolute top-6 left-6 text-xs text-white/50">
          <p>Groups: {groups.length}</p>
          <p>Bots: {bots.length}</p>
        </div>
      </div>
    </>
  );
}
