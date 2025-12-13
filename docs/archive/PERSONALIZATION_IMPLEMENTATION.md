# Personalization & Teaching Behavior Implementation

This document summarizes the implementation of 5 layers of personalization and teaching behavior on top of the existing knowledge-graph + chat system.

## Overview

The implementation adds:
1. **Response Style Profile (RSP)** - Makes Brain Web answer in a consistent "voice"
2. **Feedback Loops** - Thumbs up/down on answers to improve future responses
3. **System Theme Awareness** - Focus areas that bias answers toward current learning themes
4. **Long-term Personal Preferences** - User profile with background, interests, weak spots
5. **Gap Detection & Smart Teacher Questions** - Suggests missing concepts based on graph structure

## Backend Changes

### Models (`backend/models.py`)
Added new Pydantic models:
- `ResponseStyleProfile` - Style profile for LLM responses
- `ResponseStyleProfileWrapper` - API wrapper for style profile
- `ExplanationFeedback` - Feedback on specific answers
- `FeedbackSummary` - Aggregated feedback summary
- `FocusArea` - Current learning themes
- `UserProfile` - Long-term personal preferences

### Services (`backend/services_graph.py`)
Added service functions:
- `get_response_style_profile()` - Fetch style profile from Neo4j
- `update_response_style_profile()` - Update style profile
- `store_feedback()` - Store feedback in Neo4j
- `get_recent_feedback_summary()` - Aggregate recent feedback
- `get_focus_areas()` - Get all focus areas
- `upsert_focus_area()` - Create/update focus area
- `set_focus_area_active()` - Toggle focus area active status
- `get_user_profile()` - Get user profile
- `update_user_profile()` - Update user profile
- `find_concept_gaps()` - Find concept gaps using heuristics

### API Routers

#### `backend/api_preferences.py` (NEW)
Endpoints for preferences:
- `GET /preferences/response-style` - Get response style profile
- `POST /preferences/response-style` - Update response style profile
- `GET /preferences/focus-areas` - List all focus areas
- `POST /preferences/focus-areas` - Create/update focus area
- `POST /preferences/focus-areas/{focus_id}/active` - Toggle focus area
- `GET /preferences/user-profile` - Get user profile
- `POST /preferences/user-profile` - Update user profile

#### `backend/api_feedback.py` (NEW)
Endpoints for feedback:
- `POST /feedback/` - Submit feedback on an answer
- `GET /feedback/summary` - Get feedback summary

#### `backend/api_concepts.py`
Added endpoint:
- `GET /concepts/gaps` - Get concept gaps (for smart teacher questions)

### Main App (`backend/main.py`)
Registered new routers:
- `preferences_router` from `api_preferences`
- `feedback_router` from `api_feedback`

## Frontend Changes

### Chat Route (`frontend/app/api/brain-web/chat/route.ts`)
Enhanced the chat handler to:
1. Fetch personalization data before building system prompt:
   - Response style profile
   - Feedback summary
   - Active focus areas
   - User profile
2. Build layered system prompt with all personalization features
3. Generate `answerId` for each response
4. Call gap detection and merge suggested questions
5. Return `answerId` in response

### API Client (`frontend/app/api-client.ts`)
Added function:
- `submitFeedback(answerId, rating, reasoning, question?)` - Submit feedback to backend

### Graph Visualization (`frontend/app/components/GraphVisualization.tsx`)
Added:
- State for `answerId` and `lastQuestion`
- Store `answerId` from chat response
- Feedback buttons (👍 Yes / 👎 No) in chat bubble
- Call `submitFeedback` API when buttons are clicked

## Data Storage

All personalization data is stored in Neo4j:
- **Response Style Profile**: Stored as `Meta` node with key `'response_style_profile'`
- **Feedback**: Stored as `Feedback` nodes with properties: `answer_id`, `question`, `rating`, `reasoning`, `created_at`
- **Focus Areas**: Stored as `FocusArea` nodes with properties: `id`, `name`, `description`, `active`
- **User Profile**: Stored as `UserProfile` node with `id='default'` and properties: `name`, `background`, `interests`, `weak_spots`, `learning_preferences`

## How It Works

### Response Generation Flow

1. User asks a question in the chat
2. Next.js chat route fetches personalization data from backend:
   - Response style profile
   - Recent feedback summary
   - Active focus areas
   - User profile
3. System prompt is built by layering:
   - Base prompt (gap question vs normal)
   - Response style instructions
   - Feedback guidance
   - Focus area context
   - User profile context
4. LLM generates answer using personalized prompt
5. Gap detection finds concept gaps and generates suggested questions
6. Response includes `answerId` for feedback tracking

### Feedback Loop

1. User clicks 👍 or 👎 on an answer
2. Frontend calls `submitFeedback(answerId, rating, reasoning)`
3. Feedback is stored in Neo4j
4. Future responses use feedback summary to avoid negative patterns

### Gap Detection

Uses simple heuristics:
- Concepts with very short descriptions (< 60 chars)
- Concepts with low degree (< 2 relationships)

Generates questions like: "How would you define {concept_name} in your own words?"

## Default Values

When no data exists, defaults are created:
- **Response Style Profile**: Intuitive, grounded, exploratory tone with analogy-first teaching style
- **User Profile**: Name "Sanjay" with empty arrays for background, interests, weak spots
- **Focus Areas**: None (user can create via API)
- **Feedback**: Empty (starts accumulating as user provides feedback)

## API Usage Examples

### Set Response Style Profile
```bash
curl -X POST http://localhost:8000/preferences/response-style \
  -H "Content-Type: application/json" \
  -d '{
    "id": "default",
    "profile": {
      "tone": "intuitive, grounded, exploratory",
      "teaching_style": "analogy-first, zoom-out then zoom-in",
      "sentence_structure": "short, minimal filler",
      "explanation_order": ["big picture", "core concept", "example"],
      "forbidden_styles": ["overly formal", "glib"]
    }
  }'
```

### Create Focus Area
```bash
curl -X POST http://localhost:8000/preferences/focus-areas \
  -H "Content-Type: application/json" \
  -d '{
    "id": "distributed-systems",
    "name": "Distributed Systems",
    "description": "Current focus on distributed systems concepts",
    "active": true
  }'
```

### Submit Feedback
```bash
curl -X POST http://localhost:8000/feedback/ \
  -H "Content-Type: application/json" \
  -d '{
    "answer_id": "answer-123",
    "question": "What is a graph?",
    "rating": 1,
    "reasoning": "helpful"
  }'
```

## Notes

- All features are additive and don't break existing behavior
- Personalization data is optional - if endpoints fail, chat still works with defaults
- Feedback accumulates over time to improve responses
- Gap detection is a simple heuristic - can be enhanced later with more sophisticated analysis
- Frontend feedback UI is minimal (thumbs up/down) - can be enhanced with more detailed feedback forms
