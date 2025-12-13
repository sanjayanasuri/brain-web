# Phase 3 Implementation Summary

This document summarizes all changes made to add verifiable signals that Phase 3 (feedback + two-step style rewrite) is working.

## Files Touched

### Backend Files

1. **`backend/models.py`**
   - Added `AnswerRecord` model for storing answers
   - Added `Revision` model for storing user-rewritten answers
   - Added `AnswerRevisionRequest` model for API requests

2. **`backend/services_graph.py`**
   - Added `store_answer()` - Stores answer records in Neo4j
   - Added `store_revision()` - Stores user revisions linked to answers
   - Added `get_recent_answers()` - Retrieves recent answers with feedback/revision flags
   - Added `get_answer_detail()` - Gets full answer details including feedback and revisions
   - Added `get_example_answers()` - Gets user-rewritten answers for style examples
   - Updated imports to include new models

3. **`backend/api_debug.py`** (NEW)
   - `GET /debug/answers/recent?limit=10` - List recent answers
   - `GET /debug/answers/{answer_id}` - Get full answer details
   - Protected by `NODE_ENV !== 'production'` check

4. **`backend/api_answers.py`** (NEW)
   - `POST /answers/store` - Store an answer record
   - `GET /answers/examples?limit=5` - Get example answers for style rewrite

5. **`backend/api_feedback.py`**
   - Added `POST /feedback/answer/revision` - Store user-rewritten answers

6. **`backend/main.py`**
   - Registered `debug_router` from `api_debug`
   - Registered `answers_router` from `api_answers`

### Frontend Files

1. **`frontend/app/api/brain-web/chat/route.ts`**
   - Implemented two-step pipeline:
     - Step 1: Generate draft answer (first LLM call)
     - Step 2: Apply style rewrite (second LLM call) if examples or style profiles exist
   - Added debug metadata to response:
     - `meta.draftAnswer` - Original draft (dev only)
     - `meta.rewriteApplied` - Boolean indicating if rewrite was used
     - `meta.examplesUsed` - Array of example snippets used (dev only)
   - Stores answers in Neo4j after generation
   - Fetches example answers from revisions for style guidance

2. **`frontend/app/components/GraphVisualization.tsx`**
   - Added `console.debug()` logging for meta in devtools
   - Enhanced feedback controls:
     - 👍 and 👎 buttons (already existed, updated to use null for reason)
     - Added "Edit in my words" button
   - Added edit mode with textarea for rewriting answers
   - Added save/cancel buttons for revisions
   - Stores revisions via `POST /feedback/answer/revision`

3. **`frontend/app/debug/answers/page.tsx`** (NEW)
   - Debug UI page showing:
     - Table of recent answers with feedback/revision indicators
     - Clickable rows to view full details
     - Displays original answer, feedback entries, and revisions

## New Endpoints Added

### Debug Endpoints (dev only)

- `GET /debug/answers/recent?limit=10` - List recent answers
- `GET /debug/answers/{answer_id}` - Get answer details

### Answer Management

- `POST /answers/store` - Store answer record
- `GET /answers/examples?limit=5` - Get example answers for style rewrite

### Feedback

- `POST /feedback/answer/revision` - Store user-rewritten answer

## How to See Rewrite Applied and Examples Used

### In Browser Devtools

1. Open Brain Web in your browser
2. Open DevTools (F12)
3. Go to Network tab
4. Ask a question
5. Find the request to `/api/brain-web/chat`
6. View the Response tab
7. Look for the `meta` field:

```json
{
  "answer": "...",
  "answerId": "...",
  "meta": {
    "rewriteApplied": true,
    "draftAnswer": "...",
    "examplesUsed": [
      {
        "question": "...",
        "snippet": "..."
      }
    ]
  }
}
```

### In Console

The frontend automatically logs meta to console:
```
Brain Web meta: { rewriteApplied: true, draftAnswer: "...", examplesUsed: [...] }
```

## Curl Commands to Verify Debug Endpoints

### Get Recent Answers

```bash
curl http://localhost:8000/debug/answers/recent?limit=10
```

### Get Answer Detail

```bash
# Replace ANSWER_ID with actual ID from recent answers
curl http://localhost:8000/debug/answers/ANSWER_ID
```

### Get Examples for Style Rewrite

```bash
curl http://localhost:8000/answers/examples?limit=5
```

### Submit Feedback

```bash
curl -X POST http://localhost:8000/feedback/ \
  -H "Content-Type: application/json" \
  -d '{
    "answer_id": "ANSWER_ID",
    "question": "Your question here",
    "rating": 1,
    "reasoning": null
  }'
```

### Submit Revision

```bash
curl -X POST http://localhost:8000/feedback/answer/revision \
  -H "Content-Type: application/json" \
  -d '{
    "answer_id": "ANSWER_ID",
    "user_rewritten_answer": "Your rewritten answer here"
  }'
```

## How It Works

### Two-Step Rewrite Pipeline

1. **Draft Generation**: First LLM call generates a draft answer using the full context and personalization layers
2. **Style Rewrite**: If examples or style profiles exist, a second LLM call rewrites the draft to match the user's style
3. **Storage**: The final answer is stored in Neo4j as an `AnswerRecord`
4. **Metadata**: Debug metadata is added to the response (dev only)

### Example Usage Flow

1. User asks a question → Draft answer generated
2. System checks for examples/revisions → If found, applies style rewrite
3. Answer stored in Neo4j → Available for feedback and revisions
4. User provides feedback → Stored as `Feedback` node
5. User edits answer → Stored as `Revision` node linked to `AnswerRecord`
6. Future questions → Use revisions as examples for style rewrite

### Data Flow

```
Question → Draft Answer → Style Rewrite → Final Answer
                ↓                              ↓
         Store in Neo4j              Return to Frontend
                ↓                              ↓
    AnswerRecord node              Display + Feedback UI
                ↓                              ↓
    Feedback/Revision nodes        Store Feedback/Revision
                ↓                              ↓
    Used as examples in future rewrites
```

## Verification Checklist

- [x] Two-step rewrite pipeline implemented
- [x] Debug metadata added to responses
- [x] Frontend logs meta to console
- [x] Answers stored in Neo4j
- [x] Feedback endpoints working
- [x] Revision endpoints working
- [x] Debug endpoints created
- [x] Debug UI page created
- [x] Feedback controls in chat UI
- [x] Edit functionality in chat UI
- [x] Test documentation created

## Notes

- Debug endpoints are **disabled in production** (`NODE_ENV=production`)
- Debug metadata (`draftAnswer`, `examplesUsed`) is **only included in dev mode**
- `rewriteApplied` is **always included** (even in production) for monitoring
- Answers are stored **asynchronously** - failures don't block the response
- Revisions are linked to answers via `HAS_REVISION` relationship in Neo4j

## Testing

See `PHASE3_VERIFICATION.md` for detailed testing instructions.
