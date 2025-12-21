#!/usr/bin/env python3
"""
Wait for a Browser Use skill to finish recording and become ready.
"""

import os
import sys
import time
import requests
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from config import BROWSER_USE_API_KEY, BROWSER_USE_BASE, BROWSER_USE_FINANCE_TRACKER_SKILL_ID

BASE = BROWSER_USE_BASE or "https://api.browser-use.com/api/v2"

def check_skill_status(skill_id: str):
    """Check the status of a skill and return status info."""
    if not BROWSER_USE_API_KEY:
        return None
    
    try:
        r = requests.get(
            f"{BASE}/skills/{skill_id}",
            headers={
                "X-Browser-Use-API-Key": BROWSER_USE_API_KEY,
                "Content-Type": "application/json",
            },
            timeout=30,
        )
        
        if r.ok:
            return r.json()
        return None
    except Exception:
        return None

def wait_for_skill_ready(skill_id: str, max_wait_minutes: int = 10):
    """Wait for skill to finish recording."""
    print(f"Waiting for skill {skill_id} to finish recording...")
    print(f"Maximum wait time: {max_wait_minutes} minutes")
    print()
    
    start_time = time.time()
    max_wait_seconds = max_wait_minutes * 60
    check_interval = 10  # Check every 10 seconds
    
    while True:
        elapsed = time.time() - start_time
        
        if elapsed > max_wait_seconds:
            print(f"\n⏱️  Timeout: Skill still not ready after {max_wait_minutes} minutes")
            return False
        
        data = check_skill_status(skill_id)
        
        if not data:
            print(f"❌ Could not check skill status")
            return False
        
        status = data.get("status", "unknown")
        finished_at = data.get("currentVersionFinishedAt")
        is_enabled = data.get("isEnabled", False)
        
        print(f"[{int(elapsed)}s] Status: {status}, Finished: {finished_at is not None}, Enabled: {is_enabled}")
        
        # Check if skill is ready
        if status != "recording" and finished_at is not None:
            print(f"\n✅ Skill is ready!")
            print(f"   Status: {status}")
            print(f"   Finished at: {finished_at}")
            print(f"   Enabled: {is_enabled}")
            return True
        
        if status == "recording":
            print(f"   ⏳ Still recording... (waiting {check_interval}s)")
        else:
            print(f"   ⚠️  Status is '{status}' but not finished yet")
        
        time.sleep(check_interval)

if __name__ == "__main__":
    skill_id = BROWSER_USE_FINANCE_TRACKER_SKILL_ID
    if not skill_id:
        print("ERROR: BROWSER_USE_FINANCE_TRACKER_SKILL_ID not set")
        sys.exit(1)
    
    if not BROWSER_USE_API_KEY:
        print("ERROR: BROWSER_USE_API_KEY not set")
        sys.exit(1)
    
    success = wait_for_skill_ready(skill_id, max_wait_minutes=10)
    
    if success:
        print("\n✅ You can now execute the skill!")
        print(f"   Run: python scripts/test_browser_use_skill.py")
    else:
        print("\n❌ Skill is not ready yet. You may need to:")
        print("   1. Check the Browser Use dashboard")
        print("   2. Wait longer for the skill to finish recording")
        print("   3. Manually finish/enable the skill in the dashboard")

