import sys
import argparse
import subprocess

def generate_audio(usernames, num_files=1):
    """
    Generate audio conversations for given usernames.
    
    Args:
        usernames (list): List of usernames to generate audio for
        num_files (int): Number of files to generate
    """
    try:
        # Build the command to call conversation.py
        cmd = [
            sys.executable,
            "conversation.py",
            "--usernames",
            *usernames,
            "--num-files",
            str(num_files),
        ]
        
        print(f"🎙️ Generating audio for: {', '.join(usernames)}")
        print(f"📊 Number of files: {num_files}")
        
        # Run the subprocess
        result = subprocess.run(cmd, check=True, capture_output=False)
        
        print(f"✅ Audio generation completed successfully")
        return True
        
    except subprocess.CalledProcessError as e:
        print(f"❌ Error generating audio: {e}")
        return False
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        return False

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Generate audio conversations for users"
    )
    parser.add_argument(
        "--usernames",
        nargs="+",
        required=True,
        help="List of usernames to generate audio for",
    )
    parser.add_argument(
        "--num-files",
        type=int,
        default=1,
        help="Number of files to generate (default: 1)",
    )
    
    args = parser.parse_args()
    
    success = generate_audio(args.usernames, args.num_files)
    sys.exit(0 if success else 1)