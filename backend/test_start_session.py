import requests
import json
import os
from pathlib import Path
from dotenv import load_dotenv

repo_root = Path(__file__).parent.parent
load_dotenv(repo_root / ".env.local")
load_dotenv(repo_root / ".env")

url = "http://127.0.0.1:8000/study/session/start"
payload = {
    "intent": "practice",
    "current_mode": "explain",
    "selection_id": "test_selection"
}
headers = {
    "Content-Type": "application/json"
}

try:
    response = requests.post(url, json=payload, headers=headers)
    print(f"Status Code: {response.status_code}")
    print(f"Response: {response.text}")
except Exception as e:
    print(f"Error: {e}")
