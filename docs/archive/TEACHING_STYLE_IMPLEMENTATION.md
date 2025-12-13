# Teaching Style Profile Implementation Summary

## Overview

The Teaching Style Profile feature has been successfully implemented. This feature:
- Represents your preferred explanation style as structured data
- Can be learned from ingested lectures (segments + analogies)
- Can be manually edited via API
- Is automatically injected into the LLM system prompt so all Brain Web answers sound like you

## Files Created/Modified

### Backend Files Created:
1. **`backend/models.py`** - Added `TeachingStyleProfile` and `TeachingStyleUpdateRequest` models
2. **`backend/services_teaching_style.py`** - Neo4j persistence layer (get/update/create default)
3. **`backend/teaching_style_extractor.py`** - LLM-based style extraction from single lectures
4. **`backend/teaching_style_service.py`** - Aggregation service for combining styles across multiple lectures
5. **`backend/api_teaching_style.py`** - FastAPI endpoints for managing teaching style
6. **`backend/tests/test_teaching_style_api.py`** - Basic tests for API endpoints

### Backend Files Modified:
1. **`backend/main.py`** - Added `teaching_style_router` to FastAPI app

### Frontend Files Modified:
1. **`frontend/app/api/brain-web/chat/route.ts`** - Added teaching style loading and injection into system prompt

## API Endpoints

### GET `/teaching-style`
Get the current teaching style profile.

**Response:**
```json
{
  "id": "default",
  "tone": "intuitive, grounded, exploratory, technical but conversational",
  "teaching_style": "analogy-first, zoom-out then zoom-in, highlight big picture, emphasize real-world pattern recognition",
  "sentence_structure": "short, minimal filler, avoid dramatic language",
  "explanation_order": [
    "big picture",
    "core concept definition",
    "example or analogy",
    "connection to adjacent concepts",
    "common pitfalls",
    "summary"
  ],
  "forbidden_styles": [
    "overly formal",
    "generic GPT-like filler",
    "glib positivity",
    "verbose academic tone"
  ]
}
```

**Example:**
```bash
curl http://localhost:8000/teaching-style
```

### POST `/teaching-style`
Update the teaching style profile with partial updates.

**Request Body:**
```json
{
  "tone": "updated tone",
  "teaching_style": "updated style",
  "sentence_structure": "short",
  "explanation_order": ["big picture", "core concept"],
  "forbidden_styles": ["formal", "verbose"]
}
```

Only non-null fields will be updated. Other fields remain unchanged.

**Example:**
```bash
curl -X POST http://localhost:8000/teaching-style \
  -H "Content-Type: application/json" \
  -d '{
    "tone": "more technical, less conversational",
    "forbidden_styles": ["verbose", "academic"]
  }'
```

### POST `/teaching-style/recompute`
Recompute teaching style from recent lectures.

**Query Parameters:**
- `limit` (optional, default: 5, range: 1-20) - Number of recent lectures to analyze

**Example:**
```bash
curl -X POST "http://localhost:8000/teaching-style/recompute?limit=10"
```

This endpoint:
1. Fetches the N most recent lectures with their segments and analogies
2. Extracts teaching style from each lecture using LLM
3. Aggregates styles into a unified profile
4. Persists and returns the new profile

**Aggregation Strategy:**
- For `tone`, `teaching_style`, `sentence_structure`: Last lecture wins (most recent)
- For `explanation_order` and `forbidden_styles`: Union with order preference from latest lecture

## How It Works

### 1. Style Extraction from Lectures

When you call `/teaching-style/recompute`, the system:
- Fetches recent lectures with their segments and analogies
- For each lecture, calls the LLM with a prompt asking it to analyze:
  - The lecture title and text (first 6000 chars)
  - A summary of segments with their covered concepts and analogies
- The LLM returns a JSON object with:
  - `tone`: Overall vibe
  - `teaching_style`: How you explain
  - `sentence_structure`: How you write sentences
  - `explanation_order`: Ordered steps you follow when explaining
  - `forbidden_styles`: What clearly doesn't match your style

### 2. Style Aggregation

Styles from multiple lectures are aggregated:
- Latest lecture's tone, teaching_style, and sentence_structure take precedence
- Explanation orders are merged (deduplicated, latest-first)
- Forbidden styles are unioned (all unique values)

### 3. Injection into Chat

Every Brain Web chat request now:
1. Fetches the current teaching style profile from `/teaching-style`
2. Injects it into the system prompt as "Layer 0" (highest priority)
3. The LLM is instructed to:
   - Follow the explanation_order
   - Match the tone and teaching_style
   - Use the specified sentence_structure
   - Avoid all patterns in forbidden_styles

## Default Style

If no teaching style exists, the system uses this default:

```python
{
  "tone": "intuitive, grounded, exploratory, technical but conversational",
  "teaching_style": "analogy-first, zoom-out then zoom-in, highlight big picture, emphasize real-world pattern recognition",
  "sentence_structure": "short, minimal filler, avoid dramatic language",
  "explanation_order": [
    "big picture",
    "core concept definition",
    "example or analogy",
    "connection to adjacent concepts",
    "common pitfalls",
    "summary"
  ],
  "forbidden_styles": [
    "overly formal",
    "generic GPT-like filler",
    "glib positivity",
    "verbose academic tone"
  ]
}
```

## Testing

Run the tests:
```bash
cd backend
pytest tests/test_teaching_style_api.py -v
```

## Usage Workflow

### Step 1: Ingest Some Lectures
First, ingest a few lectures to build up your teaching corpus:
```bash
curl -X POST http://localhost:8000/lectures/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "lecture_title": "Understanding React Hooks",
    "lecture_text": "... your lecture text ...",
    "domain": "Web Development"
  }'
```

### Step 2: Recompute Teaching Style
After ingesting a few lectures, recompute your style:
```bash
curl -X POST "http://localhost:8000/teaching-style/recompute?limit=5"
```

### Step 3: Verify the Style
Check what the system learned:
```bash
curl http://localhost:8000/teaching-style
```

### Step 4: Manual Adjustments (Optional)
If needed, manually adjust the style:
```bash
curl -X POST http://localhost:8000/teaching-style \
  -H "Content-Type: application/json" \
  -d '{
    "tone": "more technical, less conversational",
    "forbidden_styles": ["verbose", "academic", "generic"]
  }'
```

### Step 5: Test in Chat
Ask a question in Brain Web chat. The response should now match your teaching style!

## How Style Profile Influences Chat Responses

The teaching style profile is injected into the system prompt with instructions like:

```
The user has a specific teaching and writing style.
You MUST emulate this style when answering.

Here is the Teaching Style Profile as JSON:
{ ... }

Key rules:
- Follow the explanation_order: big picture → core concept definition → example or analogy → ...
- Match the tone: intuitive, grounded, exploratory, technical but conversational
- Use this teaching style: analogy-first, zoom-out then zoom-in, highlight big picture
- Write with this sentence structure: short, minimal filler, avoid dramatic language
- Avoid all patterns listed in forbidden_styles: overly formal, generic GPT-like filler, ...
- Keep responses concise and grounded, not generic.
```

This ensures every Brain Web answer follows your preferred explanation style.

## Error Handling

- If LLM style extraction fails or returns bad JSON, the system falls back to `DEFAULT_STYLE` and logs a warning
- `GET /teaching-style` always returns something valid (never 500 because style node is missing)
- If no lectures exist when recomputing, the existing style is returned unchanged

## Future Enhancements

Potential improvements:
1. Automatic style extraction after each lecture ingestion (background task)
2. Style versioning/history
3. Per-domain style profiles
4. UI for viewing and editing teaching style
5. Style similarity scoring between lectures

## Notes

- The teaching style is stored as a single `TeachingStyle` node in Neo4j with `id='default'`
- List fields (`explanation_order`, `forbidden_styles`) are stored as Neo4j arrays
- The style extraction uses `gpt-4o-mini` with `temperature=0.3` for consistent extraction
- Lecture text is reconstructed from segments (concatenated segment texts) since full lecture text isn't stored separately
