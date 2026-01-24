export default function AudioPlaylist({
  audioList,
  currentAudioIndex,
  isPlaying,
  currentTime,
  duration,
  audioRef,
  onPlayPause,
  onTimeUpdate,
  onLoadedMetadata,
  handleAudioError,
  onSeek,
  onEnded,
  formatTime,
}) {
  if (audioList.length === 0) {
    return null;
  }

  return (
    <div className="bg-gray-800 rounded-lg p-8 mt-6">
      <h2 className="text-2xl font-bold mb-6">🎧 Audio Playlist</h2>

      {/* Hidden Audio Element */}
      <audio
        ref={audioRef}
        src={currentAudioIndex !== null ? audioList[currentAudioIndex].url : ""}
        onTimeUpdate={onTimeUpdate}
        onLoadedMetadata={onLoadedMetadata}
        onEnded={onEnded}
        onError={handleAudioError}
        crossOrigin="anonymous"
        preload="metadata"
      />

      {/* Current Playing Info */}
      {currentAudioIndex !== null && (
        <div className="mb-6 p-4 bg-gray-700 rounded-lg">
          <p className="text-gray-400 text-sm mb-2">Now Playing:</p>
          <p className="text-white font-semibold">
            {audioList[currentAudioIndex].name}
          </p>

          {/* Time Display */}
          <div className="flex justify-between text-sm text-gray-400 mt-4 mb-2">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>

          {/* Progress Bar */}
          <input
            type="range"
            min="0"
            max={duration || 0}
            value={currentTime}
            onChange={onSeek}
            className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-green-500"
            style={{
              background: `linear-gradient(to right, #22c55e 0%, #22c55e ${(currentTime / duration) * 100}%, #4b5563 ${(currentTime / duration) * 100}%, #4b5563 100%)`,
            }}
          />
        </div>
      )}

      {/* Audio List */}
      <div className="space-y-3">
        {audioList.map((audio, index) => (
          <div
            key={audio.id}
            className={`p-4 rounded-lg border-2 transition ${
              currentAudioIndex === index
                ? "bg-green-900 border-green-500"
                : "bg-gray-700 border-gray-600 hover:border-gray-500"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-gray-400 font-semibold">
                  #{index + 1}
                </span>
                <div>
                  <p className="text-white font-semibold">{audio.name}</p>
                  {currentAudioIndex === index && isPlaying && (
                    <p className="text-green-400 text-sm mt-1">▶️ Playing...</p>
                  )}
                  {currentAudioIndex === index && !isPlaying && (
                    <p className="text-yellow-400 text-sm mt-1">⏸️ Paused</p>
                  )}
                </div>
              </div>
              <button
                onClick={() => onPlayPause(index)}
                className={`px-4 py-2 rounded-lg font-semibold transition ${
                  currentAudioIndex === index && isPlaying
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-green-600 hover:bg-green-700"
                }`}
              >
                {currentAudioIndex === index && isPlaying
                  ? "⏸️ Pause"
                  : "▶️ Play"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
