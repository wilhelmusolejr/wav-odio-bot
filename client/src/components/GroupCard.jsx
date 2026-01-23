export default function GroupCard({ group, onPlayAudio, finishedCount = 0 }) {
  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xl font-bold">🌐 Group: {group.name}</h3>
          <p className="text-gray-400 text-sm">
            👥 {group.players.length} player(s)
            {finishedCount > 0 && (
              <span className="text-green-400 ml-2">
                ({finishedCount}/{group.players.length} finished)
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => onPlayAudio(group.name)}
          className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded-lg font-semibold transition"
        >
          ▶️ Play Audio
        </button>
      </div>

      <div className="space-y-2">
        {group.players.map((player, idx) => (
          <div
            key={idx}
            className="bg-gray-700 rounded-lg px-4 py-2 flex items-center justify-between"
          >
            <span className="text-gray-300">👤 {player.name}</span>
            <span className="text-xs text-gray-500">{player.clientId}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
