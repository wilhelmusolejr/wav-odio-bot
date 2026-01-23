export default function AudioUnlockScreen({ onUnlock }) {
  return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-red-900 to-red-700 text-white">
      <div className="text-center">
        <div className="mb-6">
          <div className="text-6xl mb-4">🔊</div>
          <h2 className="text-3xl font-bold mb-2">Audio Player Ready</h2>
          <p className="text-red-200">Click below to enable audio playback</p>
        </div>
        <button
          onClick={onUnlock}
          className="px-8 py-4 bg-white text-red-900 rounded-lg font-bold text-lg hover:bg-gray-100 transition shadow-lg"
        >
          🔓 UNLOCK AUDIO
        </button>
      </div>
    </div>
  );
}
