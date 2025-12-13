#!/bin/bash
# Example workflow for Teaching Style Profile

echo "=== Step 1: Check Current Style ==="
curl -s http://localhost:8000/teaching-style | jq '.'

echo -e "\n=== Step 2: Ingest a Sample Lecture ==="
curl -X POST http://localhost:8000/lectures/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "lecture_title": "Understanding Async/Await",
    "lecture_text": "Async/await is like ordering food at a restaurant. You place your order (async function), and instead of waiting at the counter blocking everyone, you get a number and can do other things. When your food is ready (promise resolves), you get notified. The await keyword pauses your function until the promise resolves, but it doesn\'t block the whole program. Think of it as a better way to handle promises - cleaner than .then() chains.",
    "domain": "JavaScript"
  }' | jq '.lecture_id'

echo -e "\n=== Step 3: Recompute Style from Lectures ==="
curl -X POST "http://localhost:8000/teaching-style/recompute?limit=5" | jq '.'

echo -e "\n=== Step 4: Verify Updated Style ==="
curl -s http://localhost:8000/teaching-style | jq '.'
