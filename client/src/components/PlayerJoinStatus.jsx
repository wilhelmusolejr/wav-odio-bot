export default function PlayerJoinStatus({
  joined,
  playerInfo,
  testPlayerName,
  testGroupName,
}) {
  if (joined) {
    return (
      <div className="text-center">
        <p className="text-green-400 text-2xl font-bold mb-4">
          ✅ Joined Successfully!
        </p>
        <div className="bg-gray-700 rounded-lg p-6 inline-block">
          <p className="text-gray-300 mb-2">
            <span className="text-gray-400">👤 Player:</span>{" "}
            <span className="font-bold">{playerInfo?.playerName}</span>
          </p>
          <p className="text-gray-300 mb-2">
            <span className="text-gray-400">🌐 Group:</span>{" "}
            <span className="font-bold">{playerInfo?.groupName}</span>
          </p>
          <p className="text-gray-300">
            <span className="text-gray-400">👥 Players in group:</span>{" "}
            <span className="font-bold">{playerInfo?.playersInGroup}</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center">
      <p className="text-yellow-400 text-lg">⏳ Joining group...</p>
      <p className="text-gray-500 text-sm mt-2">
        Player: {testPlayerName} → Group: {testGroupName}
      </p>
    </div>
  );
}
