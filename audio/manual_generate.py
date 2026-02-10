import json
import subprocess
import sys
from pathlib import Path

# Usernames to generate audio for
USERNAMES = [
    "echogreg",
    "reynaldomabinises",
]

# Number of audio files to generate per username
AUDIOS_PER_USER = 5


def run_generation():
    script_dir = Path(__file__).resolve().parent
    generator_py = script_dir / "audio_generator_improved.py"
    
    if not generator_py.exists():
        print(f"❌ Error: {generator_py} not found")
        sys.exit(1)
    
    print(f"🎵 Audio Generation Started")
    print(f"=" * 60)
    print(f"Users: {', '.join(USERNAMES)}")
    print(f"Files per user: {AUDIOS_PER_USER}")
    print(f"=" * 60)
    print()

    for i, username in enumerate(USERNAMES, 1):
        print(f"[{i}/{len(USERNAMES)}] Processing: {username}")
        
        cmd = [sys.executable, str(generator_py), username, str(AUDIOS_PER_USER)]
        
        try:
            result = subprocess.run(cmd, check=True, capture_output=False)
            print(f"✓ Completed: {username}\n")
        except subprocess.CalledProcessError as e:
            print(f"❌ Failed: {username} (Exit code: {e.returncode})\n")
            continue
    
    print(f"=" * 60)
    print(f"✅ All audio generation jobs completed!")
    print(f"=" * 60)


if __name__ == "__main__":
    run_generation()
