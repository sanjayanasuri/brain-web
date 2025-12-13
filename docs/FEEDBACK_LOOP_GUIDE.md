# Brain Web Feedback Loop Guide

## Overview

The feedback loop in Brain Web allows you to improve the quality of answers over time by providing feedback on responses. The system collects this feedback and uses it to guide future answers.

## How It Works

### 1. **Submitting Feedback**

When Brain Web provides an answer, you can give feedback in three ways:

#### A. Thumbs Up/Down
- **👍 Thumbs Up**: Click the thumbs up button to indicate the answer was helpful
- **👎 Thumbs Down**: Click the thumbs down button to indicate the answer was not helpful

Both actions automatically submit feedback to the backend with:
- `answer_id`: Unique identifier for the answer
- `rating`: +1 for thumbs up, -1 for thumbs down
- `question`: The original question you asked
- `reasoning`: Optional (currently null, but can be added)

#### B. Edit in My Words
- Click "Edit in my words" to rewrite the answer in your own style
- This creates a **revision** that serves as an example for future answers
- The system learns from your edits to better match your writing style

**Location in UI:**
- After any Brain Web answer, you'll see:
  ```
  Was this helpful? [👍] [👎] [Edit in my words]
  ```

### 2. **What Gets Stored**

#### Feedback Nodes
Each feedback submission creates a `Feedback` node in Neo4j with:
- `answer_id`: Links to the original answer
- `question`: The question that was asked
- `rating`: +1 or -1
- `reasoning`: Optional explanation
- `created_at`: Timestamp

#### Revision Nodes
When you edit an answer, a `Revision` node is created with:
- `answer_id`: Links to the original answer
- `user_rewritten_answer`: Your edited version
- `created_at`: Timestamp

### 3. **How Feedback Is Used**

✅ **Feedback is automatically integrated into chat prompts!**

The system fetches your feedback summary before generating each answer and includes it in the system prompt. Here's how it works:

#### Automatic Integration

**Location:** `frontend/app/api/brain-web/chat/route.ts` (lines 327-335, 529-543)

1. **Feedback Summary is Fetched** (line 327-335):
   ```typescript
   const feedbackResponse = await fetch(`${API_BASE_URL}/feedback/summary`);
   const feedbackSummary = await feedbackResponse.json();
   ```

2. **Feedback is Added to System Prompt** (line 529-543):
   ```typescript
   if (feedbackSummary && feedbackSummary.total > 0) {
     const feedbackInstructions = `
   
   You have feedback on recent answers:
   
   Total ratings: ${feedbackSummary.total}
   Positive: ${feedbackSummary.positive}, Negative: ${feedbackSummary.negative}
   
   Common negative reasons (avoid these): ${JSON.stringify(feedbackSummary.common_reasons)}
   
   Avoid patterns that produced negative feedback, especially ones marked as "too generic" or "not connected to the graph".
   `;
     systemPrompt = systemPrompt + feedbackInstructions;
   }
   ```

#### How It Works

- **Every time you ask a question**, the system:
  1. Fetches your recent feedback summary
  2. Includes it in the prompt as "Layer 2" (after Teaching Style, before Focus Areas)
  3. Tells the AI to avoid patterns that received negative feedback

- **The more feedback you give**, the better the system learns what works for you

#### Available Endpoints

**Get Feedback Summary:**
```bash
GET /feedback/summary
```

Returns:
```json
{
  "total": 50,
  "positive": 35,
  "negative": 15,
  "common_reasons": {
    "too verbose": 5,
    "missing context": 3,
    "unspecified": 7
  }
}
```

### 4. **Current Implementation Status**

✅ **Fully Implemented:**
- Feedback submission (thumbs up/down)
- Answer revision (edit in my words)
- Feedback storage in Neo4j
- Feedback summary endpoint
- UI for submitting feedback
- **Automatic feedback integration into chat prompts** ✨
- Feedback summary included in system prompt (Layer 2)

⚠️ **Partially Implemented:**
- Revisions are stored but not yet used as style examples in prompts
- Example answers endpoint exists (`/answers/examples`) but may need enhancement

### 5. **How the Feedback Loop Works**

The feedback loop operates automatically:

1. **You give feedback** → Stored in Neo4j
2. **You ask a question** → System fetches feedback summary
3. **System builds prompt** → Includes feedback as guidance
4. **AI generates answer** → Avoids patterns that got negative feedback
5. **Answer improves** → Based on your feedback patterns

**The loop is active and working!** Just keep giving feedback and the system will learn.

### 6. **Viewing Your Feedback**

#### Debug Page
Navigate to `/debug/answers` to see:
- All stored answers
- Associated feedback
- Revisions

#### API Endpoints

**Get all feedback:**
```bash
GET /feedback/summary
```

**Get specific answer with feedback:**
```bash
GET /answers/{answer_id}
```

### 7. **Best Practices**

1. **Be Consistent**: Give feedback regularly to build a good dataset
2. **Use "Edit in my words"**: This is the most powerful feedback - it shows exactly how you want answers written
3. **Provide Reasoning** (when implemented): Adding reasoning to negative feedback helps identify patterns
4. **Review Feedback Summary**: Periodically check `/feedback/summary` to see patterns

### 8. **Future Enhancements**

Potential improvements:
- Automatic feedback integration (as described above)
- Feedback-based style adjustment
- Pattern detection (e.g., "answers about X are often rated poorly")
- A/B testing different response styles based on feedback
- Feedback analytics dashboard

### 9. **Code Locations**

**Frontend:**
- `frontend/app/components/GraphVisualization.tsx` (lines 2270-2350) - Feedback UI
- `frontend/app/api-client.ts` (line 467) - `submitFeedback()` function

**Backend:**
- `backend/api_feedback.py` - Feedback endpoints
- `backend/services_graph.py` (line 678) - `store_feedback()` function
- `backend/services_graph.py` (line 699) - `get_recent_feedback_summary()` function
- `backend/models.py` (line 186) - `ExplanationFeedback` model

## Quick Start

1. **Ask a question** in Brain Web chat
2. **Review the answer**
3. **Give feedback**:
   - 👍 if helpful
   - 👎 if not helpful
   - Click "Edit in my words" to rewrite it
4. **Repeat** - The more feedback you give, the better the system can learn

## Example Workflow

```
1. You: "What is a transformer?"
2. Brain Web: [Provides answer]
3. You: [Clicks "Edit in my words"]
4. You: [Rewrites answer in your style]
5. You: [Clicks "Save"]
6. System: Stores your revision as a style example
7. Next time: Brain Web uses your revision as a reference
```

---

**Note**: The feedback loop is **already active**! Feedback is automatically integrated into every chat response. Just keep giving feedback (thumbs up/down or edits) and the system will learn your preferences.
