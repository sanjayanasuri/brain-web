#!/usr/bin/env python3
"""
Quick test script for calendar planning with todos.

This script demonstrates how to:
1. Create tasks/todos
2. Generate schedule suggestions for tomorrow
3. View the results

Usage:
    python scripts/test_calendar_planning.py
"""

import requests
import json
from datetime import datetime, timedelta
from typing import Dict, Any

# Configuration
API_BASE_URL = "http://localhost:8000/api"
# If you have auth enabled, set this:
# AUTH_TOKEN = "your_token_here"
AUTH_TOKEN = None

def get_headers() -> Dict[str, str]:
    """Get request headers with optional auth."""
    headers = {"Content-Type": "application/json"}
    if AUTH_TOKEN:
        headers["Authorization"] = f"Bearer {AUTH_TOKEN}"
    return headers

def create_task(title: str, estimated_minutes: int, priority: str = "medium", 
                energy: str = "med", due_date: str = None, 
                preferred_time_windows: list = None, location: str = None) -> Dict[str, Any]:
    """Create a task."""
    payload = {
        "title": title,
        "estimated_minutes": estimated_minutes,
        "priority": priority,
        "energy": energy,
    }
    
    if due_date:
        payload["due_date"] = due_date
    if preferred_time_windows:
        payload["preferred_time_windows"] = preferred_time_windows
    if location:
        payload["location"] = location
    
    response = requests.post(
        f"{API_BASE_URL}/tasks",
        headers=get_headers(),
        json=payload
    )
    response.raise_for_status()
    return response.json()

def get_tasks(range_days: int = 7) -> Dict[str, Any]:
    """Get tasks for the next N days."""
    response = requests.get(
        f"{API_BASE_URL}/tasks?range={range_days}",
        headers=get_headers()
    )
    response.raise_for_status()
    return response.json()

def generate_suggestions(start: str, end: str) -> Dict[str, Any]:
    """Generate schedule suggestions for a date range."""
    response = requests.post(
        f"{API_BASE_URL}/schedule/suggestions",
        headers=get_headers(),
        params={"start": start, "end": end}
    )
    response.raise_for_status()
    return response.json()

def get_free_blocks(start: str, end: str) -> Dict[str, Any]:
    """Get free time blocks for a date range."""
    response = requests.get(
        f"{API_BASE_URL}/schedule/free-blocks",
        headers=get_headers(),
        params={"start": start, "end": end}
    )
    response.raise_for_status()
    return response.json()

def main():
    """Run the test scenario."""
    print("=" * 60)
    print("Calendar Planning Test")
    print("=" * 60)
    
    # Get tomorrow's date
    tomorrow = datetime.now() + timedelta(days=1)
    tomorrow_start = tomorrow.replace(hour=8, minute=0, second=0, microsecond=0)
    tomorrow_end = tomorrow.replace(hour=22, minute=0, second=0, microsecond=0)
    
    start_iso = tomorrow_start.isoformat()
    end_iso = tomorrow_end.isoformat()
    due_date = tomorrow.strftime("%Y-%m-%d")
    
    print(f"\n📅 Planning for: {due_date}")
    print(f"   Time range: {tomorrow_start.strftime('%I:%M %p')} - {tomorrow_end.strftime('%I:%M %p')}")
    
    # Step 1: Create test tasks
    print("\n1️⃣ Creating tasks...")
    
    tasks = []
    
    try:
        task1 = create_task(
            title="Review Q4 financial reports",
            estimated_minutes=90,
            priority="high",
            energy="high",
            due_date=due_date,
            preferred_time_windows=["morning"]
        )
        tasks.append(task1)
        print(f"   ✓ Created: {task1['title']} ({task1['estimated_minutes']} min, {task1['priority']} priority)")
        
        task2 = create_task(
            title="Update project documentation",
            estimated_minutes=60,
            priority="medium",
            energy="low",
            due_date=due_date,
            preferred_time_windows=["afternoon"]
        )
        tasks.append(task2)
        print(f"   ✓ Created: {task2['title']} ({task2['estimated_minutes']} min, {task2['priority']} priority)")
        
        task3 = create_task(
            title="Prepare client presentation",
            estimated_minutes=120,
            priority="high",
            energy="high",
            due_date=due_date,
            preferred_time_windows=["morning"]
        )
        tasks.append(task3)
        print(f"   ✓ Created: {task3['title']} ({task3['estimated_minutes']} min, {task3['priority']} priority)")
        
    except requests.exceptions.RequestException as e:
        print(f"   ✗ Error creating tasks: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"   Response: {e.response.text}")
        return
    
    # Step 2: Get free blocks
    print("\n2️⃣ Checking free time blocks...")
    try:
        free_blocks = get_free_blocks(start_iso, end_iso)
        print(f"   Found {len(free_blocks.get('free_blocks', []))} free time blocks")
        for block in free_blocks.get('free_blocks', [])[:3]:  # Show first 3
            start_time = datetime.fromisoformat(block['start']).strftime('%I:%M %p')
            duration = block['duration_minutes']
            print(f"   - {start_time} ({duration} min)")
    except requests.exceptions.RequestException as e:
        print(f"   ✗ Error getting free blocks: {e}")
    
    # Step 3: Generate suggestions
    print("\n3️⃣ Generating schedule suggestions...")
    try:
        suggestions = generate_suggestions(start_iso, end_iso)
        
        print(f"\n   Generated {len(suggestions.get('suggestions', []))} suggestions:")
        print()
        
        for sug in suggestions.get('suggestions', []):
            start_dt = datetime.fromisoformat(sug['start'])
            end_dt = datetime.fromisoformat(sug['end'])
            
            print(f"   📌 {sug['task_title']}")
            print(f"      Time: {start_dt.strftime('%I:%M %p')} - {end_dt.strftime('%I:%M %p')}")
            print(f"      Confidence: {sug['confidence']:.0%}")
            print(f"      Reasons:")
            for reason in sug.get('reasons', []):
                print(f"        • {reason}")
            print()
        
        # Show grouped by day
        if 'grouped_by_day' in suggestions:
            print("   📅 Grouped by day:")
            for date, day_suggestions in suggestions['grouped_by_day'].items():
                print(f"      {date}: {len(day_suggestions)} suggestions")
        
    except requests.exceptions.RequestException as e:
        print(f"   ✗ Error generating suggestions: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"   Response: {e.response.text}")
    
    # Step 4: Summary
    print("\n" + "=" * 60)
    print("✅ Test complete!")
    print("\nNext steps:")
    print("1. Check the calendar widget on the home page for tomorrow")
    print("2. Ask the chat: 'What's my itinerary for tomorrow?'")
    print("3. Review the suggestions and see how they fit your schedule")
    print("=" * 60)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nTest interrupted by user.")
    except Exception as e:
        print(f"\n\nUnexpected error: {e}")
        import traceback
        traceback.print_exc()
