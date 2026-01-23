import { useState, useEffect } from "react";

export default function PlayerSetupModal({ onSubmit }) {
  const [accounts, setAccounts] = useState([]);
  const [username, setUsername] = useState("");
  const [groupName, setGroupName] = useState("");

  useEffect(() => {
    // Fetch account.json from public folder
    fetch("/account.json")
      .then((res) => res.json())
      .then((data) => setAccounts(data))
      .catch((err) => console.error("Failed to load accounts:", err));
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (username.trim() && groupName.trim()) {
      onSubmit({ username: username.trim(), groupName: groupName.trim() });
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-8 max-w-md w-full mx-4 shadow-2xl">
        <h2 className="text-2xl font-bold text-white mb-6">Player Setup</h2>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Username Input with Datalist */}
          <div>
            <label
              htmlFor="username"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Username
            </label>
            <input
              id="username"
              type="text"
              list="accounts-list"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="Select or type username"
              required
            />
            <datalist id="accounts-list">
              {accounts.map((acc) => (
                <option key={acc.username} value={acc.username} />
              ))}
            </datalist>
          </div>

          {/* Group Name Input */}
          <div>
            <label
              htmlFor="groupName"
              className="block text-sm font-medium text-gray-300 mb-2"
            >
              Group Name
            </label>
            <input
              id="groupName"
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="w-full px-4 py-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:border-blue-500 focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="Enter group name"
              required
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors"
          >
            Join Game
          </button>
        </form>
      </div>
    </div>
  );
}
