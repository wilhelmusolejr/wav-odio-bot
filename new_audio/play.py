import argparse
import sys
import re
from pathlib import Path

import numpy as np
import soundfile as sf

try:
    import sounddevice as sd
except ImportError:
    print("sounddevice is required. Install with: pip install sounddevice")
    sys.exit(1)

OUTPUT_DIR = Path(__file__).parent / "output_conversation"
USER1_PATTERN = re.compile(r"conversation_user1_kael_(.+)\.wav", re.IGNORECASE)
USER2_PATTERN = re.compile(r"conversation_user2_bren_(.+)\.wav", re.IGNORECASE)

def parse_args():
    parser = argparse.ArgumentParser(description="Play the two conversation WAVs in sync")
    parser.add_argument("--user1", type=Path, help="Path to user1 (kael) wav")
    parser.add_argument("--user2", type=Path, help="Path to user2 (bren) wav")
    return parser.parse_args()


def find_latest_pair():
    if not OUTPUT_DIR.exists():
        return None

    user1_files = sorted(OUTPUT_DIR.glob("conversation_user1_kael_*.wav"), key=lambda p: p.stat().st_mtime, reverse=True)
    user2_files = {f.name: f for f in OUTPUT_DIR.glob("conversation_user2_bren_*.wav")}

    for u1 in user1_files:
        m = USER1_PATTERN.match(u1.name)
        if not m:
            continue
        suffix = m.group(1)
        match_name = f"conversation_user2_bren_{suffix}.wav"
        if match_name in user2_files:
            return u1, user2_files[match_name]

    return None


def load_mono(path: Path):
    audio, sr = sf.read(path, always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    audio = audio.astype(np.float32)
    return audio, sr


def main():
    args = parse_args()

    if args.user1 and args.user2:
        path1, path2 = args.user1, args.user2
    else:
        pair = find_latest_pair()
        if not pair:
            print("No matching pair found in output_conversation. Provide --user1 and --user2.")
            sys.exit(1)
        path1, path2 = pair
        print(f"Using latest pair:\n  user1: {path1}\n  user2: {path2}")

    if not path1.exists() or not path2.exists():
        print("One or both files do not exist.")
        sys.exit(1)

    audio1, sr1 = load_mono(path1)
    audio2, sr2 = load_mono(path2)

    if sr1 != sr2:
        print(f"Sample rate mismatch: {sr1} vs {sr2}")
        sys.exit(1)

    max_len = max(len(audio1), len(audio2))
    if len(audio1) < max_len:
        audio1 = np.pad(audio1, (0, max_len - len(audio1)))
    if len(audio2) < max_len:
        audio2 = np.pad(audio2, (0, max_len - len(audio2)))

    stereo = np.column_stack([audio1, audio2]).astype(np.float32)
    peak = np.max(np.abs(stereo))
    if peak > 1.0:
        stereo = stereo / peak * 0.99

    dur_sec = max_len / sr1
    print(f"Playing stereo mix for {dur_sec/60:.2f} minutes...")
    sd.play(stereo, sr1)
    sd.wait()
    print("Done.")


if __name__ == "__main__":
    main()
