export default function NotificationList({ notifications }) {
  if (notifications.length === 0) {
    return null;
  }

  return (
    <div className="mt-8">
      <h2 className="text-2xl font-bold mb-4">🔔 Recent Notifications</h2>
      <div className="space-y-2">
        {notifications.slice(0, 5).map((notif, index) => (
          <div
            key={index}
            className="bg-green-900 border border-green-600 rounded-lg p-4"
          >
            <p className="text-green-300">
              ✅ <span className="font-bold">{notif.playerName}</span> finished
              playing audio in group{" "}
              <span className="font-bold">{notif.groupName}</span>
            </p>
            <p className="text-green-500 text-xs mt-1">
              {new Date(notif.timestamp).toLocaleTimeString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
