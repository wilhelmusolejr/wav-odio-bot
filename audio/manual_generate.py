import json
import subprocess
import sys
from pathlib import Path

# Usernames to generate audio for
USERNAMES = [
    "totoyoymonaxia",
    "paraximonaxi",
    "koooooalaid",
    "botfrag666",
    "echogreg",
    "elooo2092",
]

# Number of audio files to generate per username
AUDIOS_PER_USER = 8


def run_generation():
    script_dir = Path(__file__).resolve().parent
    main_py = script_dir / "main.py"

    config = [{"username": u, "audios": AUDIOS_PER_USER} for u in USERNAMES]
    payload = json.dumps(config)

    cmd = [sys.executable, str(main_py), payload]

    print(f"Running: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)


if __name__ == "__main__":
    run_generation()
