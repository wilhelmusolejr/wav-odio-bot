#!/usr/bin/env python3
import time
import random
import os
import numpy as np
import librosa
import soundfile as sf
import uuid
import json
import sys
import logging
import subprocess
import requests
from datetime import datetime
from multiprocessing import Process, cpu_count
from pathlib import Path
from typing import Dict, List, Optional, Any

# ==========================
# LOGGING SETUP
# ==========================
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# ==========================
# PATH CONFIGURATION
# ==========================
BASE_DIR = Path(__file__).parent.resolve()
OUTPUT_ROOT = BASE_DIR / "output"
VOICES_DIR = BASE_DIR / "agent_voices" / "profile"
PROFILES_FILE = BASE_DIR / "profiles.json"
BG_NOISE_DIR = BASE_DIR / "bg_noise"

# ==========================
# API CONFIGURATION
# ==========================
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8080")
API_TIMEOUT = 10  # seconds

# ==========================
# AUDIO QUALITY SETTINGS
# ==========================
SAMPLE_RATE = 24000  # Optimized for Discord Voice (High Quality / Low Size)
OUTPUT_FORMAT = "ogg" # We will attempt OGG (Opus) via FFmpeg
FINAL_PEAK_NORMALIZATION = 0.95

# ==========================
# DURATION SETTINGS
# ==========================
BASE_DURATION_SECONDS = 80 * 60 
EXTRA_DURATION_MIN = 5 * 60     
EXTRA_DURATION_MAX = 15 * 60    

# ==========================
# ROUND LOGIC & PROBABILITIES
# ==========================
ROUND_SEQUENCE = ["greetings", "round_start", "strategy", "enemy_info", "random", "round_result"]
PLAY_PROBABILITY = {"greetings": 0.6, "round_start": 0.85, "strategy": 0.7, "enemy_info": 0.8, "random": 0.4, "round_result": 1.0}
INTENSITY = {"greetings": 0.2, "round_start": 0.35, "strategy": 0.45, "enemy_info": 0.8, "random": 0.25, "round_result": 0.5}

# ==========================
# CORE AUDIO FUNCTIONS
# ==========================

def mic_color(audio: np.ndarray) -> np.ndarray:
    """Crisp high-quality pre-emphasis for 24kHz."""
    return librosa.effects.preemphasis(audio, coef=0.95)

def add_silence(seconds: float, state: Dict[str, Any]) -> None:
    """Append silence to the list buffer (Memory efficient)."""
    silence = np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)
    state["audio_list"].append(silence)

def play_random_clip_from(source: str, state: Dict[str, Any], voice_type: str) -> bool:
    folder = VOICES_DIR / voice_type / source
    audio_extensions = {'.mp3', '.wav', '.ogg', '.flac'}
    files = [f for f in folder.iterdir() if f.suffix.lower() in audio_extensions] if folder.exists() else []
    
    if not files: return False
    
    file = random.choice(files)
    try:
        audio, _ = librosa.load(str(file), sr=SAMPLE_RATE)
        # Apply FX
        audio = mic_color(audio)
        # Random Variation
        if random.random() < 0.25: # Fade
            audio = audio * np.linspace(1.0, random.uniform(0.7, 0.9), len(audio))
        
        state["audio_list"].append(audio)
        return True
    except Exception as e:
        logger.error(f"Load error: {e}")
        return False

# ==========================
# GENERATION ENGINE
# ==========================

def generate_round(state: Dict[str, Any], voice_type: str):
    clips_added = 0
    for source in ROUND_SEQUENCE:
        if random.random() > PLAY_PROBABILITY.get(source, 0.5):
            continue
        
        if play_random_clip_from(source, state, voice_type):
            clips_added += 1
            # Variable Pacing
            r = random.random()
            pause = random.uniform(0.1, 0.4) if r < 0.5 else random.uniform(0.5, 1.5)
            add_silence(pause, state)
            
    add_silence(random.uniform(1.0, 3.0), state)
    return clips_added

def generate_audio_job(username: str, voice_type: str, bg_noise: str, version: int):
    # Initialize with list for RAM efficiency
    state = {"audio_list": [], "energy": 0.3}
    
    target_seconds = BASE_DURATION_SECONDS + random.randint(EXTRA_DURATION_MIN, EXTRA_DURATION_MAX)
    logger.info(f"[START] {username} v{version} | Target: {target_seconds//60}min")

    total_clips = 0
    while (sum(len(c) for c in state["audio_list"]) / SAMPLE_RATE) < target_seconds:
        total_clips += generate_round(state, voice_type)
        if total_clips == 0: # Safety break if folders are empty
            logger.error("No clips found in folders!")
            return None

    # Concatenate ONCE at the end
    audio = np.concatenate(state["audio_list"])
    
    # Normalization
    peak = np.max(np.abs(audio))
    if peak > 0:
        audio = (audio / peak) * FINAL_PEAK_NORMALIZATION

    # Export Logic
    out_dir = OUTPUT_ROOT / username
    out_dir.mkdir(parents=True, exist_ok=True)
    file_id = f"{datetime.now().strftime('%Y%m%d')}_{str(uuid.uuid4())[:8]}"
    
    wav_path = out_dir / f"{file_id}.wav"
    ogg_path = out_dir / f"{file_id}.ogg"

    # 1. Save as high-quality PCM_16 WAV (Smallest possible WAV)
    sf.write(str(wav_path), audio, SAMPLE_RATE, subtype='PCM_16')

    # 2. Try to convert to OGG/Opus via FFmpeg
    try:
        subprocess.run([
            'ffmpeg', '-i', str(wav_path), '-c:a', 'libopus', '-b:a', '48k', str(ogg_path), '-y'
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        wav_path.unlink() # Delete WAV after successful OGG conversion
        final_path = ogg_path
        logger.info(f"[DONE] Saved OGG: {final_path.name} ({final_path.stat().st_size/(1024*1024):.1f}MB)")
    except Exception:
        final_path = wav_path # Keep WAV if FFmpeg fails
        logger.warning(f"[DONE] FFmpeg failed, kept WAV: {final_path.name}")

    return str(final_path)

# ==========================
# API FUNCTIONS
# ==========================

def fetch_user_config(username: str) -> Optional[Dict[str, Any]]:
    """Fetch user configuration from API."""
    try:
        url = f"{API_BASE_URL}/api/user/{username}"
        logger.info(f"Fetching config from: {url}")
        
        response = requests.get(url, timeout=API_TIMEOUT)
        
        if response.status_code == 200:
            data = response.json()
            logger.info(f"✓ Found config for user: {username}")
            return {
                "voice_type": data.get("voiceType", "real_brendan666"),
                "background_noise": data.get("backgroundNoise", "none"),
                "player_type": data.get("playerType", "player"),
                "discord_name": data.get("discordName", username)
            }
        elif response.status_code == 404:
            logger.warning(f"✗ User '{username}' not found in database")
            return None
        else:
            logger.error(f"API error: {response.status_code}")
            return None
    except requests.exceptions.ConnectionError:
        logger.error(f"✗ Cannot connect to API at {API_BASE_URL}")
        return None
    except requests.exceptions.Timeout:
        logger.error(f"✗ API request timeout after {API_TIMEOUT}s")
        return None
    except Exception as e:
        logger.error(f"✗ Error fetching config: {e}")
        return None

# ==========================
# BOILERPLATE & RUNNER
# ==========================

def load_profiles():
    """Load profiles from JSON file (fallback)."""
    if PROFILES_FILE.exists():
        with open(PROFILES_FILE, 'r') as f: 
            return json.load(f)
    return {}

def run_jobs_for_user(username: str, voice_type: str, bg_noise: str, num_audios: int):
    """Generate multiple audio files for a user."""
    for v in range(1, num_audios + 1):
        generate_audio_job(username, voice_type, bg_noise, v)

def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        logger.error("Usage: python audio_generator_improved.py <username> [count]")
        logger.error("Example: python audio_generator_improved.py john123 3")
        sys.exit(1)
    
    username = sys.argv[1]
    count = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    
    logger.info(f"="*50)
    logger.info(f"Audio Generator - User: {username}")
    logger.info(f"="*50)
    
    # Try to fetch config from API
    config = fetch_user_config(username)
    
    if not config:
        logger.warning("Falling back to profiles.json")
        profiles = load_profiles()
        config = profiles.get(username, {
            "voice_type": "real_brendan666",
            "background_noise": "none"
        })
    
    voice_type = config.get("voice_type", "real_brendan666")
    bg_noise = config.get("background_noise", "none")
    
    logger.info(f"Configuration:")
    logger.info(f"  • Voice Type: {voice_type}")
    logger.info(f"  • Background Noise: {bg_noise}")
    logger.info(f"  • Files to Generate: {count}")
    logger.info(f"="*50)
    
    run_jobs_for_user(username, voice_type, bg_noise, count)
    
    logger.info(f"="*50)
    logger.info(f"✓ Generation complete for {username}")
    logger.info(f"="*50)

if __name__ == "__main__":
    main()