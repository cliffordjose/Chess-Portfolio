import os
import subprocess
import time
from datetime import datetime

# Configuration
POLL_INTERVAL_SECONDS = 5 * 60  # Check Lichess every 5 minutes
USERNAME = "clifford10"
TARGET_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def log(msg):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

def run_git_command(args):
    try:
        result = subprocess.run(
            args, 
            cwd=TARGET_DIR, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE, 
            text=True, 
            check=True
        )
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        log(f"Git command failed: {' '.join(args)}\nError: {e.stderr.strip()}")
        return None
    except FileNotFoundError:
        log("ERROR: Git is not installed or not added to your system PATH. Please install Git for Windows.")
        return None

def main():
    log("Starting Chess Portfolio Auto-Uploader...")
    log(f"Monitoring Lichess for user: {USERNAME}")
    log("Press Ctrl+C to stop.")
    
    while True:
        # Step 1: Run the fetcher
        log("Fetching latest games from Lichess...")
        fetcher_script = os.path.join(TARGET_DIR, "scripts", "fetch_data.py")
        
        try:
            subprocess.run(["python", fetcher_script, "--username", USERNAME], cwd=TARGET_DIR, check=True)
        except subprocess.CalledProcessError:
            log("Error occurred while fetching data. Retrying next cycle.")
        
        # Step 2: Check for changes
        status = run_git_command(["git", "status", "--porcelain", "data/"])
        
        if status is None:
            # Git command failed or not installed
            pass
        elif status == "":
            log("No new games found. Everything is up to date.")
        else:
            # Step 3: Commit and Push
            log("New games detected! Committing to GitHub...")
            run_git_command(["git", "add", "data/"])
            run_git_command(["git", "commit", "-m", "Auto-update latest Lichess games"])
            
            log("Pushing to GitHub...")
            push_res = run_git_command(["git", "push"])
            if push_res is not None:
                log("Successfully uploaded to GitHub!")
        
        # Step 4: Wait
        log(f"Waiting {POLL_INTERVAL_SECONDS // 60} minutes...\n")
        time.sleep(POLL_INTERVAL_SECONDS)

if __name__ == "__main__":
    main()
