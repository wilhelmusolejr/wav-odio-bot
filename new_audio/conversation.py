import time
import random
import os
import numpy as np
import librosa
import soundfile as sf
import uuid
import sys
import argparse
from datetime import datetime

accounts = [
  {
    "username": "botfrag666",
    "voice_type": "real_brendan666",
    "noises": "none",
    "type": "respondent"
  },
  {
    "username": "jeroam",
    "voice_type": "ai_kael",
    "noises": "none",
    "type": "initiator"
  },
]

# ==========================
# USER CONFIGURATION
# ==========================
AUDIOS_TO_GENERATE = 1

# ==========================
# BASE CONFIG\=;0k99o
# ==========================
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_ROOT = os.path.join(BASE_DIR, "output_conversation")

# User directories
USER1_DIR = os.path.join(BASE_DIR, "ai_kael")  # Initiator
USER2_DIR = os.path.join(BASE_DIR, "bren")     # Responder

# ==========================
# Audio Settings
SR = 8000  # Sample rate (Hz)

# Duration Settings (in seconds)
# Target ~1h20m base + 5-15m flex to match round cycle length
BASE_DURATION_SECONDS = 80 * 60
EXTRA_DURATION_MIN = 5 * 60
EXTRA_DURATION_MAX = 15 * 60

# Response timing (time between user1 speaks and user2 responds)
RESPONSE_TIME_MIN = 0.5  # Minimum delay before response (seconds)
RESPONSE_TIME_MAX = 2.0  # Maximum delay before response (seconds)

# Pause between conversation exchanges
EXCHANGE_PAUSE_MIN = 1.0  # Minimum pause after user2 responds
EXCHANGE_PAUSE_MAX = 3.0  # Maximum pause after user2 responds

# Audio Mixing Settings
PEAK_NORMALIZATION = 0.9  # Peak normalization level (0.0-1.0)
FINAL_PEAK_NORMALIZATION = 0.95  # Final peak normalization after mixing

# ==========================
# ROUND SEQUENCE (from main.py)
# ==========================
ROUND_SEQUENCE = [
    "greetings",
    "round_start",
    "strategy",
    "enemy_info",
    "random",
    "strategy",
    "enemy_info",
    "random",
    "enemy_info",
    "strategy",
    "enemy_info",
    "round_result",
]

PLAY_PROBABILITY = {
    "greetings": 0.6,
    "round_start": 0.85,
    "strategy": 0.7,
    "enemy_info": 0.8,
    "random": 0.4,
    "round_result": 1.0,
}

# ==========================
# VOICE FX
# ==========================

def mic_color(audio):
    """Apply mic coloring effect to audio"""
    return librosa.effects.preemphasis(audio, coef=0.93)

# ==========================
# CORE FUNCTIONS
# ==========================

def get_matching_files(category, user1_dir, user2_dir):
    """
    Get matching audio files from both users for a given category.
    Returns list of tuples: [(user1_file_path, user2_file_path), ...]
    """
    user1_folder = os.path.join(user1_dir, category)
    user2_folder = os.path.join(user2_dir, category)
    
    if not os.path.exists(user1_folder) or not os.path.exists(user2_folder):
        return []
    
    user1_files = {f for f in os.listdir(user1_folder) if f.endswith(".mp3")}
    user2_files = {f for f in os.listdir(user2_folder) if f.endswith(".mp3")}
    
    # Find matching filenames
    matching_files = user1_files.intersection(user2_files)
    
    if not matching_files:
        return []
    
    return [
        (os.path.join(user1_folder, f), os.path.join(user2_folder, f))
        for f in matching_files
    ]

def add_silence(seconds, state):
    """Add silence to the audio state"""
    silence = np.zeros(int(seconds * SR))
    state["audio"] = np.concatenate([state["audio"], silence])

def play_conversation_exchange(category, state_user1, state_user2, user1_dir, user2_dir):
    """
    Play a conversation exchange for both users:
    User1: speaks, then silence for user2's response duration
    User2: silence for user1's speech duration, then speaks
    """
    matching_files = get_matching_files(category, user1_dir, user2_dir)
    
    if not matching_files:
        return False
    
    # Select a random matching pair
    user1_file, user2_file = random.choice(matching_files)
    
    # Load both audio files
    try:
        audio1, _ = librosa.load(user1_file, sr=SR)
        audio1 = mic_color(audio1)
        
        # Apply normalization
        peak = np.max(np.abs(audio1))
        if peak > 0:
            audio1 = audio1 / peak * PEAK_NORMALIZATION
        
        audio2, _ = librosa.load(user2_file, sr=SR)
        audio2 = mic_color(audio2)
        
        # Apply normalization
        peak = np.max(np.abs(audio2))
        if peak > 0:
            audio2 = audio2 / peak * PEAK_NORMALIZATION
        
        # Get durations
        duration1 = len(audio1) / SR
        duration2 = len(audio2) / SR
        
        # Add response delays
        response_delay = random.uniform(RESPONSE_TIME_MIN, RESPONSE_TIME_MAX)
        
        # User1 track: speaks, then silence for user2's response
        state_user1["audio"] = np.concatenate([state_user1["audio"], audio1])
        add_silence(response_delay, state_user1)
        add_silence(duration2, state_user1)
        
        # User2 track: silence for user1's speech, then speaks
        add_silence(duration1, state_user2)
        add_silence(response_delay, state_user2)
        state_user2["audio"] = np.concatenate([state_user2["audio"], audio2])
        
        return True
        
    except Exception as e:
        print(f"[WARNING] Error playing conversation exchange from {category}: {e}")
        return False

# ==========================
# CONVERSATION GENERATION
# ==========================

def generate_conversation(state_user1, state_user2, user1_dir, user2_dir):
    """Generate a full conversation sequence for both users following the round order"""
    # Iterate through the round sequence in order
    for category in ROUND_SEQUENCE:
        # Check probability
        if random.random() > PLAY_PROBABILITY.get(category, 1.0):
            continue
        
        # Play conversation exchange
        success = play_conversation_exchange(category, state_user1, state_user2, user1_dir, user2_dir)
        
        if success:
            # Add pause after the exchange to both tracks (mimic main.py pacing)
            r = random.random()
            if r < 0.5:
                pause = random.uniform(0.05, 0.3)
            elif r < 0.9:
                pause = random.uniform(0.4, 1.2)
            else:
                pause = random.uniform(2.5, 5.0)
            add_silence(pause, state_user1)
            add_silence(pause, state_user2)

# ==========================
# AUDIO JOB
# ==========================

def generate_conversation_audio(version):
    """Generate two conversation audio files (one for each user)"""
    state_user1 = {
        "audio": np.array([], dtype=np.float32),
    }
    state_user2 = {
        "audio": np.array([], dtype=np.float32),
    }
    
    EXTRA_SECONDS = random.randint(EXTRA_DURATION_MIN, EXTRA_DURATION_MAX)
    TARGET_SECONDS = BASE_DURATION_SECONDS + EXTRA_SECONDS
    
    print(f"[JOB START] Conversation v{version} - Target: {TARGET_SECONDS}s")
    
    # Keep generating conversation exchanges until target duration is reached
    while len(state_user1["audio"]) / SR < TARGET_SECONDS:
        generate_conversation(state_user1, state_user2, USER1_DIR, USER2_DIR)
    
    audio_user1 = state_user1["audio"]
    audio_user2 = state_user2["audio"]
    
    # Ensure both tracks are the same length (pad the shorter one)
    max_len = max(len(audio_user1), len(audio_user2))
    if len(audio_user1) < max_len:
        audio_user1 = np.pad(audio_user1, (0, max_len - len(audio_user1)), mode='constant')
    if len(audio_user2) < max_len:
        audio_user2 = np.pad(audio_user2, (0, max_len - len(audio_user2)), mode='constant')
    
    # Final normalization for both tracks
    peak = np.max(np.abs(audio_user1))
    if peak > 0:
        audio_user1 = audio_user1 / peak * FINAL_PEAK_NORMALIZATION
    
    peak = np.max(np.abs(audio_user2))
    if peak > 0:
        audio_user2 = audio_user2 / peak * FINAL_PEAK_NORMALIZATION
    
    # Create output directory
    os.makedirs(OUTPUT_ROOT, exist_ok=True)
    
    # Generate filename with date and unique ID
    date_str = datetime.now().strftime("%Y%m%d")
    unique_id = str(uuid.uuid4())[:8]
    
    # Save User1 (ai_kael) file
    file_name_user1 = f"conversation_user1_kael_{date_str}_{unique_id}"
    out_path_user1 = os.path.join(OUTPUT_ROOT, f"{file_name_user1}.wav")
    sf.write(out_path_user1, audio_user1, SR)
    
    # Save User2 (bren) file
    file_name_user2 = f"conversation_user2_bren_{date_str}_{unique_id}"
    out_path_user2 = os.path.join(OUTPUT_ROOT, f"{file_name_user2}.wav")
    sf.write(out_path_user2, audio_user2, SR)
    
    duration = len(audio_user1) / SR
    print(f"[JOB DONE] User1: {out_path_user1} - Duration: {duration:.2f}s")
    print(f"[JOB DONE] User2: {out_path_user2} - Duration: {duration:.2f}s")
    
    return out_path_user1, out_path_user2

# ==========================
# MAIN
# ==========================

def parse_args():
    parser = argparse.ArgumentParser(description="Generate conversation audio files")
    parser.add_argument("--usernames", type=str, nargs="+", help="List of usernames to generate conversations for")
    parser.add_argument("--num-files", type=int, required=False, help="Number of conversation files to generate")
    return parser.parse_args()


def get_account_config(username):
    """Get account configuration for a username"""
    for account in accounts:
        if account["username"].lower() == username.lower():
            return account
    return None


def get_voice_dir(voice_type):
    """Get the directory path for a voice type"""
    return os.path.join(BASE_DIR, "voices", voice_type)


def generate_conversations_for_users(usernames, num_files):
    """Generate conversation audio files for multiple users"""
    # Get account configurations
    accounts_config = []
    for username in usernames:
        account = get_account_config(username)
        if not account:
            print(f"❌ Username '{username}' not found in accounts configuration.")
            return
        accounts_config.append(account)
    
    # Separate by type
    initiators = [acc for acc in accounts_config if acc.get("type") == "initiator"]
    respondents = [acc for acc in accounts_config if acc.get("type") == "respondent"]
    
    if not initiators or not respondents:
        print(f"❌ Need at least one initiator and one respondent. Found {len(initiators)} initiators and {len(respondents)} respondents.")
        return
    
    # Create output directories for all users
    for account in accounts_config:
        output_dir = os.path.join(BASE_DIR, "output", account["username"])
        os.makedirs(output_dir, exist_ok=True)
    
    print(f"\n=== Conversation Audio Generator ===")
    print(f"📝 Generating {num_files} conversation(s)")
    print(f"   Initiators: {[acc['username'] for acc in initiators]}")
    print(f"   Respondents: {[acc['username'] for acc in respondents]}")
    
    for file_num in range(1, num_files + 1):
        try:
            # Generate unique ID for this conversation pair
            unique_id = str(uuid.uuid4())[:6]
            
            print(f"\n   [{file_num}/{num_files}] Conversation ID: {unique_id}")
            
            # Generate conversation for each initiator-respondent pair
            for initiator in initiators:
                for respondent in respondents:
                    state_initiator = {"audio": np.array([], dtype=np.float32)}
                    state_respondent = {"audio": np.array([], dtype=np.float32)}
                    
                    # Get voice directories based on voice_type
                    initiator_voice_dir = get_voice_dir(initiator["voice_type"])
                    respondent_voice_dir = get_voice_dir(respondent["voice_type"])
                    
                    EXTRA_SECONDS = random.randint(EXTRA_DURATION_MIN, EXTRA_DURATION_MAX)
                    TARGET_SECONDS = BASE_DURATION_SECONDS + EXTRA_SECONDS
                    
                    print(f"      • {initiator['username']} <-> {respondent['username']} (Target: {TARGET_SECONDS:.0f}s)")
                    
                    # Keep generating conversation exchanges until target duration is reached
                    while len(state_initiator["audio"]) / SR < TARGET_SECONDS:
                        generate_conversation(state_initiator, state_respondent, initiator_voice_dir, respondent_voice_dir)
                    
                    audio_initiator = state_initiator["audio"]
                    audio_respondent = state_respondent["audio"]
                    
                    # Ensure both tracks are the same length (pad the shorter one)
                    max_len = max(len(audio_initiator), len(audio_respondent))
                    if len(audio_initiator) < max_len:
                        audio_initiator = np.pad(audio_initiator, (0, max_len - len(audio_initiator)))
                    if len(audio_respondent) < max_len:
                        audio_respondent = np.pad(audio_respondent, (0, max_len - len(audio_respondent)))
                    
                    # Normalize peak levels
                    peak = np.max(np.abs(audio_initiator))
                    if peak > 0:
                        audio_initiator = audio_initiator / peak * FINAL_PEAK_NORMALIZATION
                    
                    peak = np.max(np.abs(audio_respondent))
                    if peak > 0:
                        audio_respondent = audio_respondent / peak * FINAL_PEAK_NORMALIZATION
                    
                    # Save files with numbering format: {number}_{randomkey}.wav
                    initiator_filename = f"{file_num}_{unique_id}.wav"
                    respondent_filename = f"{file_num}_{unique_id}.wav"
                    
                    initiator_output_dir = os.path.join(BASE_DIR, "output", initiator["username"])
                    respondent_output_dir = os.path.join(BASE_DIR, "output", respondent["username"])
                    
                    initiator_path = os.path.join(initiator_output_dir, initiator_filename)
                    respondent_path = os.path.join(respondent_output_dir, respondent_filename)
                    
                    # Save audio files
                    sf.write(initiator_path, audio_initiator, SR)
                    sf.write(respondent_path, audio_respondent, SR)
                    
                    duration = len(audio_initiator) / SR
                    print(f"         ✓ {initiator['username']}: {initiator_filename} ({duration:.0f}s)")
                    print(f"         ✓ {respondent['username']}: {respondent_filename} ({duration:.0f}s)")
        
        except Exception as e:
            print(f"        ✗ Error generating conversation {file_num}: {e}")
            import traceback
            traceback.print_exc()
    
    print(f"\n✅ All conversation audio generation completed!")
    for account in accounts_config:
        output_dir = os.path.join(BASE_DIR, "output", account["username"])
        print(f"   {account['username']}: {output_dir}")


if __name__ == "__main__":
    args = parse_args()
    
    if args.usernames and args.num_files:
        # Generate conversations for specified usernames
        generate_conversations_for_users(args.usernames, args.num_files)
    elif args.usernames or args.num_files:
        print("❌ Both --usernames and --num-files are required when using command-line arguments.")
        print("   Example: python conversation.py --usernames botfrag666 jeroam --num-files 3")
        sys.exit(1)
    else:
        # Default behavior if no arguments provided
        print("\n=== Conversation Audio Generator ===")
        print(f"User 1 (Initiator): ai_kael")
        print(f"User 2 (Responder): bren")
        print(f"Generating {AUDIOS_TO_GENERATE} conversation(s)...\n")
        
        for v in range(1, AUDIOS_TO_GENERATE + 1):
            generate_conversation_audio(v)
        
        print("\n✅ All conversation audio generation completed.")

