# Phase 3 Verification Guide

This document provides step-by-step instructions to verify that Phase 3 (feedback + two-step style rewrite) is working correctly.

## Prerequisites

1. Backend running on `http://127.0.0.1:8000`
2. Frontend running in development mode (`NODE_ENV !== 'production'`)
3. Browser devtools open (F12)

## Test 1: Confirm Rewrite is Happening

### Steps:

1. Open Brain Web in your browser (typically `http://localhost:3000`)
2. Open browser devtools (F12) and go to the Network tab
3. Ask a question like: **"Explain concurrency like I am a beginner"**
4. In the Network tab, find the request to `/api/brain-web/chat`
5. Click on it and view the Response tab
6. Inspect the JSON response

### Expected Results:

- ✅ `meta.rewriteApplied === true`
- ✅ `meta.draftAnswer` is present and different from `answer`
- ✅ `meta.examplesUsed` is either:
  - A non-empty array (if you have previous revisions)
  - `undefined` (if no revisions exist yet - this is OK for first test)

### Verification in Console:

The frontend also logs meta to the console. Check the browser console for:
```
Brain Web meta: { rewriteApplied: true, draftAnswer: "...", examplesUsed: [...] }
```

## Test 2: Confirm Answers are Stored

### Steps:

1. After asking a question in Brain Web, note the `answerId` from the response (or use the debug page)
2. Call the debug endpoint:

```bash
curl http://localhost:8000/debug/answers/recent?limit=5
```

### Expected Results:

- ✅ Response is a JSON array
- ✅ Your latest question and answer appear in the list
- ✅ Each entry has:
  - `answer_id`: A valid UUID-like string
  - `question`: The question you asked
  - `raw_answer`: The final answer
  - `created_at`: ISO timestamp
  - `has_feedback`: boolean
  - `has_revision`: boolean

### Alternative: Use Browser

Navigate to: `http://localhost:8000/debug/answers/recent?limit=5`

## Test 3: Confirm Feedback is Stored

### Steps:

1. In Brain Web, ask a question and get an answer
2. Click the **👍** (thumbs up) or **👎** (thumbs down) button on the answer
3. Note the `answerId` from the response (check Network tab or console)
4. Call the debug endpoint for that answer:

```bash
curl http://localhost:8000/debug/answers/{answer_id}
```

Replace `{answer_id}` with the actual answer ID from step 3.

### Expected Results:

- ✅ Response includes a `feedback` array
- ✅ The array contains at least one entry with:
  - `rating`: 1 or -1
  - `reason`: null (or a string if provided)
  - `created_at`: ISO timestamp

### Example Response:

```json
{
  "answer": {
    "answer_id": "answer-1234567890-abc123",
    "question": "Explain concurrency like I am a beginner",
    "raw_answer": "...",
    "used_node_ids": [...],
    "created_at": "2024-01-15T10:30:00Z"
  },
  "feedback": [
    {
      "rating": 1,
      "reason": null,
      "created_at": "2024-01-15T10:31:00Z"
    }
  ],
  "revisions": []
}
```

## Test 4: Confirm Revisions are Used as Examples

### Steps:

1. In Brain Web, ask a question and get an answer
2. Click the **"Edit in my words"** button
3. Rewrite the answer in your own voice/style
4. Click **"Save"**
5. Ask a **similar question** in Brain Web
6. In the Network tab, check the `/api/brain-web/chat` response

### Expected Results:

- ✅ `meta.examplesUsed` includes a snippet from your rewritten answer
- ✅ The new answer's style is closer to your rewrite
- ✅ `meta.rewriteApplied === true`

### Verification via API:

Check that your revision was stored:

```bash
curl http://localhost:8000/debug/answers/{answer_id}
```

Should show:
```json
{
  "answer": {...},
  "feedback": [...],
  "revisions": [
    {
      "user_rewritten_answer": "Your rewritten text here...",
      "created_at": "2024-01-15T10:32:00Z"
    }
  ]
}
```

Check that examples are being fetched:

```bash
curl http://localhost:8000/answers/examples?limit=5
```

Should return an array with your revision.

## Debug UI

For a visual interface, navigate to:

**http://localhost:3000/debug/answers**

This page shows:
- Table of recent answers with feedback/revision indicators
- Click any row to see full details including:
  - Original answer
  - All feedback entries
  - All revisions

## Common Issues

### Issue: `rewriteApplied` is `false`

**Possible causes:**
- No examples exist yet (create a revision first)
- No style profiles are configured
- Rewrite API call failed (check backend logs)

**Solution:** Create at least one revision by editing an answer, then ask another question.

### Issue: `meta` is missing from response

**Possible causes:**
- Running in production mode (`NODE_ENV=production`)
- Frontend not in dev mode

**Solution:** Ensure `NODE_ENV !== 'production'` in your environment.

### Issue: Debug endpoints return 403

**Possible causes:**
- Running in production mode
- `NODE_ENV=production` is set

**Solution:** Debug endpoints are disabled in production. Run in development mode.

### Issue: Answers not being stored

**Possible causes:**
- Backend `/answers/store` endpoint not working
- Network error (check browser console)

**Solution:** Check backend logs for errors. Verify the endpoint is registered in `main.py`.

## Quick Verification Commands

```bash
# Get recent answers
curl http://localhost:8000/debug/answers/recent?limit=5

# Get answer detail (replace ANSWER_ID)
curl http://localhost:8000/debug/answers/ANSWER_ID

# Get examples for style rewrite
curl http://localhost:8000/answers/examples?limit=5

# Submit feedback (replace ANSWER_ID and QUESTION)
curl -X POST http://localhost:8000/feedback/ \
  -H "Content-Type: application/json" \
  -d '{"answer_id": "ANSWER_ID", "question": "QUESTION", "rating": 1, "reasoning": null}'

# Submit revision (replace ANSWER_ID)
curl -X POST http://localhost:8000/feedback/answer/revision \
  -H "Content-Type: application/json" \
  -d '{"answer_id": "ANSWER_ID", "user_rewritten_answer": "Your rewritten answer here"}'
```

## Summary Checklist

- [ ] Rewrite is happening (`rewriteApplied: true`)
- [ ] Draft answer is visible in dev mode
- [ ] Examples are being used (once revisions exist)
- [ ] Answers are stored in Neo4j
- [ ] Feedback is stored and retrievable
- [ ] Revisions are stored and used as examples
- [ ] Debug UI is accessible and functional
