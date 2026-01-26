import express from "express";
import cors from "cors";

const app = express();

/* -------------------- MIDDLEWARE -------------------- */
// Enable CORS for all origins
app.use(
  cors({
    origin: "*", // Allow all origins
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  }),
);

app.use(express.json());

/* -------------------- SAMPLE DATA -------------------- */
const sampleAudios = {
  botfrag666: [
    {
      id: 1,
      name: "audio_1.mp3",
      path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    },
    {
      id: 2,
      name: "audio_2.mp3",
      path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    },
    {
      id: 3,
      name: "audio_3.mp3",
      path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
    },
  ],
  echogreg: [
    {
      id: 1,
      name: "greeting_1.mp3",
      path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    },
    {
      id: 2,
      name: "greeting_2.mp3",
      path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    },
  ],
  elooo2092: [
    {
      id: 1,
      name: "voice_message_1.wav",
      path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    },
  ],
  real_brendan666: [
    {
      id: 1,
      name: "audio_sample_1.mp3",
      path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    },
    {
      id: 2,
      name: "audio_sample_2.mp3",
      path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    },
    {
      id: 3,
      name: "audio_sample_3.mp3",
      path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
    },
    {
      id: 4,
      name: "audio_sample_4.mp3",
      path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
    },
  ],
  thesis2023wmsu: [
    {
      id: 1,
      name: "audio_sample_1.mp3",
      path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    },
    {
      id: 2,
      name: "audio_sample_2.mp3",
      path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    },
    {
      id: 3,
      name: "audio_sample_3.mp3",
      path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
    },
    {
      id: 4,
      name: "audio_sample_4.mp3",
      path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
    },
  ],
  totoyoymonaxia: [
    {
      id: 1,
      name: "audio_sample_1.mp3",
      path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
    },
    {
      id: 2,
      name: "audio_sample_2.mp3",
      path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3",
    },
    {
      id: 3,
      name: "audio_sample_3.mp3",
      path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3",
    },
    {
      id: 4,
      name: "audio_sample_4.mp3",
      path: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3",
    },
  ],
};

/* -------------------- API ROUTES -------------------- */

// GET audios for a specific username
app.get("/api/audios/:username", (req, res) => {
  try {
    const { username } = req.params;

    console.log(`\n🎵 API REQUEST: GET /api/audios/${username}`);

    if (!username) {
      console.log(`   ❌ No username provided`);
      return res.status(400).json({
        error: "Username is required",
        success: false,
      });
    }

    // Get audios for the username
    const audios = sampleAudios[username] || [];

    console.log(`   ✅ Found ${audios.length} audios for ${username}`);

    const response = {
      success: true,
      username: username,
      audioCount: audios.length,
      audios: audios,
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(response);
  } catch (error) {
    console.error(`❌ API ERROR:`, error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch audio files",
      message: error.message,
    });
  }
});

// GET all available usernames
app.get("/api/usernames", (req, res) => {
  try {
    console.log(`\n👥 API REQUEST: GET /api/usernames`);

    const usernames = Object.keys(sampleAudios);
    console.log(`   ✅ Found ${usernames.length} users`);

    res.status(200).json({
      success: true,
      usernames: usernames,
      count: usernames.length,
    });
  } catch (error) {
    console.error(`❌ API ERROR:`, error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch usernames",
    });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "API is running",
    timestamp: new Date().toISOString(),
  });
});

/* -------------------- START SERVER -------------------- */
const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`\n🚀 API Server running on http://localhost:${PORT}`);
  console.log(`\n📡 Available endpoints:`);
  console.log(`   GET /api/audios/<username>`);
  console.log(`   GET /api/usernames`);
  console.log(`   GET /api/health`);
  console.log(
    `\n📝 Sample users: botfrag666, echogreg, elooo2092, real_brendan666\n`,
  );
});
