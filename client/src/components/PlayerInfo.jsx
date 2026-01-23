export default function PlayerInfo({ playerInfo, connected }) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between">
        <h1 className="text-5xl font-bold">🎵 Player</h1>

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
  );
}
