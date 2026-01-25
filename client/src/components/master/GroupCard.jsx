import { useEffect, useState, useRef } from "react";

export default function GroupCard({ data, onCountdownZero }) {
  const [countdown, setCountdown] = useState("00:00:00");
  const triggeredRef = useRef(false);

  useEffect(() => {
    triggeredRef.current = false;

    if (!data.schedule_info?.nextRunAt) {
      setCountdown("00:00:00");
      return;
    }

    const updateCountdown = () => {
      const now = Date.now();
      const delaySeconds = Math.max(
        0,
        Math.floor((data.schedule_info.nextRunAt - now) / 1000),
      );

      const hours = Math.floor(delaySeconds / 3600);
      const minutes = Math.floor((delaySeconds % 3600) / 60);
      const seconds = delaySeconds % 60;

      setCountdown(
        `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
      );

      if (
        delaySeconds === 0 &&
        !triggeredRef.current &&
        typeof onCountdownZero === "function"
      ) {
        triggeredRef.current = true;
        onCountdownZero({ id: data.id, groupName: data.groupName });
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [data.schedule_info?.nextRunAt, data.id, data.groupName]);

  return (
    <>
      {/* card */}
      <div className="bg-white/5 border border-white/10 rounded-xl p-5 flex flex-col justify-between space-y-4 min-h-80 shadow-xl backdrop-blur-md">
        {/* Header Section */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex flex-col">
              <h3 className="text-white font-bold text-lg tracking-tight uppercase truncate max-w-[150px]">
                {data.groupName || "waiting..."}
              </h3>
              {/* Added Channel Name */}
              <p className="text-blue-400 text-[10px] font-bold uppercase tracking-tight flex items-center gap-1">
                <span className="opacity-50">#</span>{" "}
                {data.channelName || "General"}
              </p>
            </div>

            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-emerald-400 font-medium uppercase tracking-wider">
                  Live
                </span>
                <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              </div>
              {/* Added Timer Countdown */}
              <div className="bg-white/5 px-2 py-0.5 rounded border border-white/10">
                <span className="text-white font-mono text-xs tracking-wider">
                  {countdown}
                </span>
              </div>
            </div>
          </div>
          <div className="my-2">
            <p className="text-white/40 text-[10px] uppercase font-bold tracking-widest">
              Session Details
            </p>
            <p className="uppercase">{data.status}</p>
          </div>
        </div>

        {/* Scrollable List of Names */}
        <div className="flex-1 my-2">
          <div className="flex items-center justify-between mb-2">
            <p className="text-white/20 text-[9px] uppercase font-bold">
              Players
            </p>
            <p className="text-[12px] text-white/60 font-mono">
              {data.players?.length || 0} / {data.players?.length || 0}
            </p>
          </div>
          <div className="h-32 overflow-y-auto space-y-1.5 custom-scrollbar">
            {data.players && data.players.length > 0 ? (
              data.players.map((player) => (
                <div
                  key={player.id}
                  className="group flex items-center justify-between bg-white/[0.03] hover:bg-white/[0.08] border border-white/5 rounded-md px-3 py-1.5 transition-all cursor-default"
                >
                  <span className="text-white/70 text-xs font-medium group-hover:text-white transition-colors">
                    {player.name}
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${
                        player.status === "speaking"
                          ? "bg-blue-500/20 text-blue-400"
                          : player.status === "finish"
                            ? "bg-green-500/20 text-green-400"
                            : "bg-yellow-500/20 text-yellow-400"
                      }`}
                    >
                      {player.status}
                    </span>
                    <div
                      className={`w-1 h-1 rounded-full transition-colors ${
                        player.isConnected
                          ? "bg-emerald-500 group-hover:bg-emerald-400"
                          : "bg-red-500 group-hover:bg-red-400"
                      }`}
                    ></div>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-white/30 text-xs text-center py-4 italic">
                No players connected
              </div>
            )}
          </div>
        </div>

        {/* Footer Stats */}
        <div className="flex gap-4 pt-4 border-t border-white/5">
          <div className="flex-1">
            <div className="text-white font-mono text-xl leading-none">
              {data.players?.length || 0}
            </div>
            <p className="text-white/40 text-[10px] uppercase mt-1">Total</p>
          </div>
          <div className="flex-1 border-l border-white/10 pl-4">
            <div className="text-emerald-400 font-mono text-xl leading-none uppercase">
              {data.botStatus || "Active"}
            </div>
            <p className="text-white/40 text-[10px] uppercase mt-1">
              Bot Status
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
