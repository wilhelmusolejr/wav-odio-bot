import React, { useState } from "react";

const SchedulePanel = ({ groups, onUpdateSchedule }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState("randomize");
  const [selectedGroups, setSelectedGroups] = useState([]);
  const [randomMin, setRandomMin] = useState(1);
  const [randomMax, setRandomMax] = useState(3);
  const [timeValue, setTimeValue] = useState("09:00");

  const handleSelectGroup = (groupName) => {
    setSelectedGroups((prevSelected) =>
      prevSelected.includes(groupName)
        ? prevSelected.filter((name) => name !== groupName)
        : [...prevSelected, groupName],
    );
  };

  const handleSelectAll = (isChecked) => {
    if (isChecked) {
      // Select all groups
      const allGroupNames = groups.map((group) => group.groupName);
      setSelectedGroups(allGroupNames);
    } else {
      // Deselect all groups
      setSelectedGroups([]);
    }
  };

  const isAllSelected =
    groups.length > 0 && selectedGroups.length === groups.length;

  const handleUpdate = () => {
    onUpdateSchedule(mode, selectedGroups, {
      randomMin,
      randomMax,
      timeValue,
    });
    console.log("Schedule update sent!");
  };

  return (
    <div className="w-full">
      {/* Header / Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between group mb-2 focus:outline-none"
      >
        <h2 className="text-2xl capitalize font-semibold text-white/90 group-hover:text-white transition-colors">
          Schedule
        </h2>
        <div
          className={`transform transition-transform duration-300 ${isOpen ? "rotate-180" : "rotate-0"}`}
        >
          <span className="text-white/40 group-hover:text-white text-xl">
            ▼
          </span>
        </div>
      </button>

      {/* Collapsible Content */}
      <div
        className={`overflow-hidden transition-all duration-500 ease-in-out ${
          isOpen ? "max-h-[600px] opacity-100 mb-5" : "max-h-0 opacity-0"
        }`}
      >
        <div className="bg-white/5 border border-white/10 rounded-xl p-5 flex flex-col space-y-6 min-h-[400px] backdrop-blur-md shadow-2xl">
          {/* Schedule Mode Selection */}
          <div className="space-y-3">
            <p className="text-white/40 text-[10px] uppercase font-bold tracking-widest px-1">
              Schedule Mode
            </p>
            <div className="grid grid-cols-3 gap-2 bg-black/20 p-1 rounded-lg border border-white/5">
              <button
                onClick={() => setMode("right_now")}
                className={`flex flex-col items-center justify-center gap-1 py-2 rounded-md text-[10px] font-medium transition-all group border border-transparent ${
                  mode === "right_now"
                    ? "bg-emerald-500/20 text-white border-emerald-400/40 shadow-[0_0_0_1px_rgba(16,185,129,0.4)]"
                    : "text-white/60 hover:bg-white/5"
                }`}
              >
                <span
                  className={`text-base transition-transform ${
                    mode === "right_now" ? "scale-110" : "group-hover:scale-110"
                  }`}
                >
                  ⚡
                </span>
                Right Now
              </button>

              <button
                onClick={() => setMode("randomize")}
                className={`flex flex-col items-center justify-center gap-1 py-2 rounded-md text-[10px] font-medium transition-all group border border-transparent ${
                  mode === "randomize"
                    ? "bg-indigo-500/20 text-white border-indigo-400/40 shadow-[0_0_0_1px_rgba(99,102,241,0.4)]"
                    : "text-white/60 hover:bg-white/5"
                }`}
              >
                <span
                  className={`text-base transition-transform ${
                    mode === "randomize" ? "scale-110" : "group-hover:scale-110"
                  }`}
                >
                  🎲
                </span>
                Randomize
              </button>

              <button
                onClick={() => setMode("set_time")}
                className={`flex flex-col items-center justify-center gap-1 py-2 rounded-md text-[10px] font-medium transition-all group border border-transparent ${
                  mode === "set_time"
                    ? "bg-amber-500/20 text-white border-amber-400/40 shadow-[0_0_0_1px_rgba(251,191,36,0.4)]"
                    : "text-white/60 hover:bg-white/5"
                }`}
              >
                <span
                  className={`text-base transition-transform ${
                    mode === "set_time" ? "scale-110" : "group-hover:scale-110"
                  }`}
                >
                  ⏰
                </span>
                Set Time
              </button>
            </div>
            <p className="text-white/30 text-[10px] italic">
              Selected mode: {mode.replace("_", " ")}
            </p>

            <div className="space-y-3 bg-black/20 border border-white/5 rounded-lg p-3">
              {/* Right Now */}
              {mode === "right_now" && (
                <div
                  className={`rounded-lg border px-3 py-2 transition-all ${
                    mode === "right_now"
                      ? "border-emerald-400/50 bg-emerald-500/5"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  <p className="text-xs text-white font-semibold flex items-center gap-2">
                    ⚡ Right Now
                    {mode === "right_now" && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-200">
                        Selected
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-white/60 mt-1">
                    Immediately triggers playback for the selected groups.
                  </p>
                </div>
              )}

              {/* Randomize */}
              {mode === "randomize" && (
                <div
                  className={`rounded-lg border px-3 py-2 transition-all ${
                    mode === "randomize"
                      ? "border-indigo-400/50 bg-indigo-500/5"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-white font-semibold flex items-center gap-2">
                      🎲 Randomize
                      {mode === "randomize" && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-200">
                          Selected
                        </span>
                      )}
                    </p>
                    <span className="text-[10px] text-white/40">Hours</span>
                  </div>
                  <p className="text-[11px] text-white/60 mt-1">
                    Pick a random delay between the minimum and maximum hours.
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1 text-[11px] text-white/60">
                      Min (hrs)
                      <input
                        type="number"
                        min="0"
                        value={randomMin}
                        onChange={(e) => setRandomMin(Number(e.target.value))}
                        className="w-full rounded-md bg-black/30 border border-white/10 text-white text-sm px-2 py-1 focus:border-indigo-400 focus:outline-none"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-[11px] text-white/60">
                      Max (hrs)
                      <input
                        type="number"
                        min="0"
                        value={randomMax}
                        onChange={(e) => setRandomMax(Number(e.target.value))}
                        className="w-full rounded-md bg-black/30 border border-white/10 text-white text-sm px-2 py-1 focus:border-indigo-400 focus:outline-none"
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* Set Time */}
              {mode === "set_time" && (
                <div
                  className={`rounded-lg border px-3 py-2 transition-all ${
                    mode === "set_time"
                      ? "border-amber-400/50 bg-amber-500/5"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  <p className="text-xs text-white font-semibold flex items-center gap-2">
                    ⏰ Set Time
                    {mode === "set_time" && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200">
                        Selected
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-white/60 mt-1">
                    Schedule playback at a specific clock time.
                  </p>
                  <div className="mt-3">
                    <input
                      type="time"
                      value={timeValue}
                      onChange={(e) => setTimeValue(e.target.value)}
                      className="w-full rounded-md bg-black/30 border border-white/10 text-white text-sm px-2 py-2 focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Group Selection */}
          <div className="flex-1 space-y-3">
            <div className="flex items-center justify-between px-1">
              <p className="text-white/40 text-[10px] uppercase font-bold tracking-widest">
                Apply to Groups
              </p>
              <div className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  id="selectAll"
                  checked={isAllSelected}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  className="w-3 h-3 rounded border-white/10 bg-black/20 checked:bg-indigo-500 text-indigo-500 cursor-pointer"
                />
                <label
                  htmlFor="selectAll"
                  className="text-white/40 text-[9px] uppercase font-bold tracking-widest cursor-pointer group-hover:text-white/60 transition-colors"
                >
                  Apply to all
                </label>
              </div>
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
              {groups.map(({ groupName, players = [] }, index) => {
                const isSelected = selectedGroups.includes(groupName);
                return (
                  <label
                    key={index}
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all border ${
                      isSelected
                        ? "bg-indigo-500/15 border-indigo-400/40 shadow-[0_0_0_1px_rgba(99,102,241,0.35)]"
                        : "bg-white/5 border-white/10 hover:bg-white/10"
                    }`}
                    onClick={() => handleSelectGroup(groupName)}
                  >
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => handleSelectGroup(groupName)}
                        className={`w-4 h-4 rounded border-white/10 bg-black/20 text-indigo-500 focus:ring-0 transition-all ${
                          isSelected ? "bg-indigo-500/60" : ""
                        }`}
                      />
                      <span
                        className={`text-xs font-medium transition-colors ${
                          isSelected ? "text-white" : "text-white/60"
                        }`}
                      >
                        {groupName}
                      </span>
                    </div>
                    <span
                      className={`text-[10px] font-mono transition-colors ${
                        isSelected ? "text-indigo-100" : "text-white/40"
                      }`}
                    >
                      {players.length} players
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Action Button */}
          <button
            onClick={handleUpdate}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-bold shadow-lg transition-all active:scale-[0.98]"
          >
            Update Schedule
          </button>
        </div>
      </div>
    </div>
  );
};

export default SchedulePanel;
