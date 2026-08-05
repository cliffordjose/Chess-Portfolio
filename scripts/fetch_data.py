#!/usr/bin/env python3
"""
Chess Portfolio — Lichess Data Fetcher
======================================
Fetches your latest Lichess data and writes JSON files
consumed by the portfolio website.

Usage:
    python fetch_data.py --username cliffordjose

Dependencies:
    pip install requests python-chess
"""

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Fix Windows charmap encoding issues
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

try:
    import requests
except ImportError:
    print("Missing 'requests'. Run: pip install requests")
    sys.exit(1)

# ─── Config ──────────────────────────────────────────────────────────────────
LICHESS_BASE    = "https://lichess.org/api"
OUTPUT_DIR      = Path(__file__).parent.parent / "data"
GAMES_TO_FETCH  = 50          # How many recent games to include
RATE_LIMIT_WAIT = 1.5         # Seconds between API calls
TIME_CONTROLS   = ["rapid", "blitz", "bullet", "classical"]

# ─── Helpers ──────────────────────────────────────────────────────────────────
def get(url: str, params: dict = None, stream: bool = False) -> requests.Response:
    """GET with basic error handling and rate-limit courtesy delay."""
    time.sleep(RATE_LIMIT_WAIT)
    headers = {"Accept": "application/json"}
    r = requests.get(url, params=params, headers=headers, stream=stream, timeout=30)
    if r.status_code == 429:
        print("  ⚠  Rate limited, waiting 60s...")
        time.sleep(60)
        r = requests.get(url, params=params, headers=headers, stream=stream, timeout=30)
    r.raise_for_status()
    return r

def get_ndjson(url: str, params: dict = None) -> list:
    """GET NDJSON endpoint (Lichess uses this for game exports)."""
    time.sleep(RATE_LIMIT_WAIT)
    headers = {
        "Accept": "application/x-ndjson",
        "User-Agent": "ChessPortfolioApp/1.0 (cliffordjose2001@gmail.com)"
    }
    r = requests.get(url, params=params, headers=headers, timeout=60)
    r.raise_for_status()
    lines = [ln for ln in r.text.strip().split('\n') if ln.strip()]
    return [json.loads(ln) for ln in lines]

# ─── Fetch Profile ────────────────────────────────────────────────────────────
def fetch_profile(username: str) -> dict:
    print(f"  ↳ Fetching profile for: {username}")
    data = get(f"{LICHESS_BASE}/user/{username}").json()

    perfs = data.get("perfs", {})
    ratings = {}
    for tc in TIME_CONTROLS:
        perf = perfs.get(tc, {})
        ratings[tc] = perf.get("rating", 1500)

    stats_data = data.get("count", {})
    wins   = stats_data.get("win", 0)
    losses = stats_data.get("loss", 0)
    draws  = stats_data.get("draw", 0)
    total  = wins + losses + draws

    profile = {
        "username":   data.get("username", username),
        "name":       data.get("profile", {}).get("realName", username),
        "title":      data.get("title"),
        "bio":        data.get("profile", {}).get("bio", "Chess player & software developer."),
        "avatar":     "avatar.png",
        "github":     data.get("profile", {}).get("links", ""),
        "linkedin":   "",
        "lichess":    f"https://lichess.org/@/{username}",
        "chessdotcom": "",
        "ratings":    ratings,
        "stats": {
            "gamesPlayed":     total,
            "wins":            wins,
            "losses":          losses,
            "draws":           draws,
            "winRate":         round(wins / total * 100, 1) if total > 0 else 0,
            "avgAccuracy":     0,   # filled after game fetch
            "longestWinStreak": 0,  # filled after game fetch
            "currentStreak":   0,  # filled after game fetch
            "bestRating":      max(ratings.values()) if ratings else 1500,
            "titledPlayerBeaten": False
        },
        "achievements": build_achievements(data),
        "openings": [],       # filled after game fetch
        "ratingHistory": {}   # filled separately
    }
    return profile

# ─── Fetch Rating History ─────────────────────────────────────────────────────
def fetch_rating_history(username: str) -> dict:
    print(f"  ↳ Fetching rating history...")
    data = get(f"{LICHESS_BASE}/user/{username}/rating-history").json()

    history = {}
    tc_name_map = {
        "Rapid":     "rapid",
        "Blitz":     "blitz",
        "Bullet":    "bullet",
        "Classical": "classical"
    }

    for tc_data in data:
        name = tc_data.get("name", "")
        key  = tc_name_map.get(name)
        if not key:
            continue

        points = tc_data.get("points", [])
        parsed = []
        for p in points[-12:]:  # last 12 data points
            year, month, _, rating = p
            month_str = f"{year}-{month+1:02d}"
            parsed.append({"date": month_str, "rating": rating})

        if parsed:
            history[key] = parsed

    return history

# ─── Fetch Games ──────────────────────────────────────────────────────────────
def fetch_games(username: str) -> list:
    print(f"  ↳ Fetching last {GAMES_TO_FETCH} games...")
    games_raw = get_ndjson(
        f"{LICHESS_BASE}/games/user/{username}",
        params={
            "max":        GAMES_TO_FETCH,
            "clocks":     "false",
            "evals":      "false",
            "opening":    "true",
            "accuracy":   "true",
            "perfType":   "rapid,blitz,bullet,classical"
        }
    )

    games = []
    for g in games_raw:
        players  = g.get("players", {})
        white_u  = players.get("white", {}).get("user", {}).get("name", "?")
        black_u  = players.get("black", {}).get("user", {}).get("name", "?")
        white_acc = players.get("white", {}).get("analysis", {}).get("accuracy", 0)
        black_acc = players.get("black", {}).get("analysis", {}).get("accuracy", 0)
        opening  = g.get("opening", {}).get("name", "Unknown Opening")
        speed    = g.get("speed", "rapid").capitalize()
        status   = g.get("status", "unknown")
        winner   = g.get("winner", None)

        if winner == "white":   result = "1-0"
        elif winner == "black": result = "0-1"
        else:                   result = "1/2-1/2"

        pgn = g.get("moves", "")
        if pgn:
            # Convert moves string to numbered PGN
            moves = pgn.split()
            pgn_numbered = ""
            for i, mv in enumerate(moves):
                if i % 2 == 0:
                    pgn_numbered += f"{i//2 + 1}. "
                pgn_numbered += mv + " "
            pgn = pgn_numbered.strip() + " " + result
        else:
            pgn = result

        ts = g.get("createdAt", 0)
        date_str = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime("%Y-%m-%d")

        games.append({
            "id":          g.get("id", ""),
            "white":       white_u,
            "black":       black_u,
            "result":      result,
            "timeControl": speed,
            "accuracy":    {"white": white_acc or 0, "black": black_acc or 0},
            "opening":     opening,
            "date":        date_str,
            "moves":       len(pgn.split()) // 2,
            "pgn":         pgn
        })

    return games

# ─── Compute Derived Stats ────────────────────────────────────────────────────
def compute_stats(profile: dict, games: list) -> dict:
    """Compute streak, opening stats, avg accuracy from game list."""
    username  = profile["username"].lower()
    accuracies = []
    streak = 0
    longest_streak = 0
    current_streak = 0
    last_result = None

    opening_counts = {}

    for g in games:
        is_white  = g["white"].lower() == username
        my_acc    = g["accuracy"]["white"] if is_white else g["accuracy"]["black"]
        if my_acc > 0:
            accuracies.append(my_acc)

        result = g["result"]
        my_win = (is_white and result == "1-0") or (not is_white and result == "0-1")
        draw   = result == "1/2-1/2"

        if my_win:
            current_streak += 1
            longest_streak = max(longest_streak, current_streak)
        else:
            current_streak = 0

        # Openings
        op = g["opening"]
        if op not in opening_counts:
            opening_counts[op] = {"games":0, "wins":0, "draws":0, "losses":0}
        opening_counts[op]["games"] += 1
        if my_win:      opening_counts[op]["wins"]   += 1
        elif draw:      opening_counts[op]["draws"]  += 1
        else:           opening_counts[op]["losses"] += 1

    # Sort openings by games played
    openings_list = []
    colors = ["#769656","#c9a227","#4a90d9","#d94a4a","#9b59b6","#e67e22","#1abc9c"]
    for i, (name, counts) in enumerate(sorted(opening_counts.items(), key=lambda x: -x[1]["games"])[:7]):
        openings_list.append({
            "name":   name,
            "games":  counts["games"],
            "wins":   counts["wins"],
            "draws":  counts["draws"],
            "losses": counts["losses"],
            "color":  colors[i % len(colors)]
        })

    profile["stats"]["avgAccuracy"]       = round(sum(accuracies)/len(accuracies), 1) if accuracies else 0
    profile["stats"]["longestWinStreak"]  = longest_streak
    profile["stats"]["currentStreak"]     = current_streak
    profile["openings"] = openings_list

    return profile

# ─── Achievements Builder ─────────────────────────────────────────────────────
def build_achievements(data: dict) -> list:
    perfs = data.get("perfs", {})
    best  = max((p.get("rating", 0) for p in perfs.values()), default=0)
    total = data.get("count", {}).get("all", 0)

    return [
        {"id":1, "icon":"🥇", "title":"Crossed 2000",       "desc":"Reached 2000+ in any time control", "unlocked": best >= 2000 },
        {"id":2, "icon":"🎯", "title":"1000 Games Played",  "desc":"Completed 1,000 rated games",       "unlocked": total >= 1000 },
        {"id":3, "icon":"⚔️", "title":"Beat a Titled Player","desc":"Defeated an NM/FM/IM/GM",         "unlocked": False },
        {"id":4, "icon":"🔥", "title":"95%+ Accuracy Game", "desc":"95%+ accuracy in a rated game",    "unlocked": False },
        {"id":5, "icon":"🌟", "title":"Win Streak of 10",   "desc":"Won 10 games in a row",             "unlocked": False },
        {"id":6, "icon":"♟️", "title":"Opening Expert",     "desc":"Played 100+ games same opening",   "unlocked": False },
        {"id":7, "icon":"🏆", "title":"Tournament Winner",  "desc":"Won a Lichess arena",               "unlocked": False },
        {"id":8, "icon":"👑", "title":"Crossed 2200",       "desc":"Reached 2200+ in any time control", "unlocked": best >= 2200 }
    ]

# ─── Main ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="Fetch Lichess data for chess portfolio")
    parser.add_argument("--username", "-u", required=True, help="Lichess username")
    args = parser.parse_args()

    username = args.username.strip().lower()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\n  Chess Portfolio - Lichess Data Fetcher")
    print(f"   Username: {username}\n")

    try:
        print("[1/4] Fetching profile...")
        profile = fetch_profile(username)

        print("[2/4] Fetching rating history...")
        history = fetch_rating_history(username)
        profile["ratingHistory"] = history

        print("[3/4] Fetching games...")
        games = fetch_games(username)

        print("[4/4] Computing stats & openings...")
        profile = compute_stats(profile, games)

        # Write output
        profile_path = OUTPUT_DIR / "profile.json"
        games_path   = OUTPUT_DIR / "games.json"

        with open(profile_path, "w", encoding="utf-8") as f:
            json.dump(profile, f, indent=2, ensure_ascii=False)

        with open(games_path, "w", encoding="utf-8") as f:
            json.dump(games[:20], f, indent=2, ensure_ascii=False)  # top 20 for display

        print(f"\n✅ Done!")
        print(f"   Profile → {profile_path}")
        print(f"   Games   → {games_path}")
        print(f"   Ratings: {profile['ratings']}")
        print(f"   Games fetched: {len(games)}\n")

    except requests.HTTPError as e:
        print(f"\n❌ HTTP error: {e}")
        if e.response.status_code == 404:
            print(f"   User '{username}' not found on Lichess.")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error: {e}")
        raise

if __name__ == "__main__":
    main()
