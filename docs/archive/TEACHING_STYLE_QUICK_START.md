# Teaching Style Profile - Quick Start Guide

## What This Does

The Teaching Style Profile makes Brain Web chat answers sound like YOU. It learns from your lectures and applies that style to all answers.

## Step-by-Step: How to Use It

### Step 1: Check Current Style (See What's There Now)

**Command:**
```bash
curl http://localhost:8000/teaching-style
```

**What You'll See:**
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

This is the **default** style. It's generic. We want to replace it with YOUR style.

---

### Step 2: Ingest a Lecture (If You Haven't Already)

You need at least one lecture ingested for the system to learn from.

**Command:**
```bash
curl -X POST http://localhost:8000/lectures/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "lecture_title": "How React Hooks Work",
    "lecture_text": "React hooks let you use state in functional components. Think of useState like a box that remembers a value. When you call setState, React re-renders your component. useEffect runs after render, like a side effect handler. It\'s similar to componentDidMount but runs every render by default.",
    "domain": "Web Development"
  }'
```

**What Happens:**
- System extracts concepts and relationships
- Creates segments with analogies
- Stores everything in Neo4j

**Response:**
```json
{
  "lecture_id": "LECTURE_A1B2C3D4",
  "nodes_created": [...],
  "nodes_updated": [...],
  "links_created": [...],
  "segments": [...]
}
```

**Do this 2-5 times** with different lectures so the system has enough examples.

---

### Step 3: Recompute Your Style (Learn From Your Lectures)

**Command:**
```bash
curl -X POST "http://localhost:8000/teaching-style/recompute?limit=5"
```

**What Happens:**
1. System fetches your 5 most recent lectures
2. For each lecture, calls LLM: "Analyze this writing style"
3. LLM extracts: tone, teaching style, sentence structure, explanation order, forbidden styles
4. Aggregates all styles into one profile
5. Saves it to Neo4j

**What You'll See:**
```json
{
  "id": "default",
  "tone": "conversational, uses analogies like 'box that remembers', practical examples",
  "teaching_style": "starts with analogy, then explains mechanism, connects to real use cases",
  "sentence_structure": "short sentences, direct comparisons, avoids jargon",
  "explanation_order": [
    "analogy first",
    "what it does",
    "how it works",
    "when to use it"
  ],
  "forbidden_styles": [
    "overly technical jargon",
    "academic tone",
    "vague explanations"
  ]
}
```

**This is YOUR style** learned from your actual lectures!

---

### Step 4: Test It in Brain Web Chat

**Before:** Ask "What is React?"
- Generic answer, formal tone, textbook-like

**After:** Ask "What is React?"
- Answer matches YOUR style:
  - Uses analogies you use
  - Follows your explanation order
  - Matches your tone
  - Avoids your forbidden styles

**Try it:** Open Brain Web chat in your browser and ask a question!

---

### Step 5: Manual Tweaks (Optional)

If the learned style isn't quite right, manually adjust it:

**Command:**
```bash
curl -X POST http://localhost:8000/teaching-style \
  -H "Content-Type: application/json" \
  -d '{
    "tone": "more technical, less conversational",
    "forbidden_styles": ["verbose", "academic", "generic"]
  }'
```

**What Happens:**
- Only the fields you provide are updated
- Other fields stay the same
- New style is saved immediately

**Check the update:**
```bash
curl http://localhost:8000/teaching-style
```

---

## Real Example: Before vs After

### Before Teaching Style (Generic Answer)

**Question:** "What is a database index?"

**Answer:**
> A database index is a data structure that improves the speed of data retrieval operations on a database table at the cost of additional writes and storage space to maintain the index data structure. Indexes are used to quickly locate data without having to search every row in a database table every time a database table is accessed. They can be created using one or more columns of a database table, providing the basis for both rapid random lookups and efficient access of ordered records.

**Problems:**
- Too formal/academic
- No analogies
- Generic textbook tone
- Doesn't match your style

---

### After Teaching Style (Your Style)

**Question:** "What is a database index?"

**Answer:**
> Think of a database index like a book's index at the back. Instead of reading every page to find "React hooks," you check the index, see "page 45," and jump right there.
>
> A database index does the same thing. It's a separate structure that maps values to row locations. When you query `WHERE user_id = 123`, the database checks the index first, finds the row location instantly, instead of scanning every row.
>
> Trade-off: faster reads, but slower writes (because you have to update the index too). Use indexes on columns you query frequently, like user_id or email.

**Why This is Better:**
- ✅ Starts with analogy (your style)
- ✅ Practical example (user_id, email)
- ✅ Explains trade-offs (your explanation order)
- ✅ Conversational tone (matches your lectures)
- ✅ No academic jargon

---

## UI Examples (What You'll See)

### In Your Browser DevTools (Network Tab)

When you ask a question in Brain Web chat, you'll see:

```
Request: POST /api/brain-web/chat
```

The system automatically:
1. Fetches `/teaching-style` (you won't see this, it happens automatically)
2. Builds system prompt with your style
3. Sends to OpenAI with your style instructions
4. Returns answer in YOUR voice

### In Backend Logs

When recomputing style, you'll see:
```
[Teaching Style] Recomputing teaching style from 5 recent lectures
[Teaching Style] Found 5 lectures to analyze
[Teaching Style] Extracted style from lecture: How React Hooks Work
[Teaching Style] Extracted style from lecture: Database Indexing Explained
...
[Teaching Style] Teaching style recomputed and persisted
```

---

## Common Workflows

### Workflow 1: First Time Setup
```bash
# 1. Ingest 3-5 lectures
curl -X POST http://localhost:8000/lectures/ingest -d '{...}'
curl -X POST http://localhost:8000/lectures/ingest -d '{...}'
curl -X POST http://localhost:8000/lectures/ingest -d '{...}'

# 2. Learn your style
curl -X POST "http://localhost:8000/teaching-style/recompute?limit=5"

# 3. Verify
curl http://localhost:8000/teaching-style

# 4. Test in chat!
# Open browser → Brain Web → Ask a question
```

### Workflow 2: Update After New Lectures
```bash
# 1. Ingest new lecture
curl -X POST http://localhost:8000/lectures/ingest -d '{...}'

# 2. Recompute (includes new lecture)
curl -X POST "http://localhost:8000/teaching-style/recompute?limit=5"

# Done! Style updated automatically
```

### Workflow 3: Manual Fine-Tuning
```bash
# 1. Check current style
curl http://localhost:8000/teaching-style

# 2. Adjust what you don't like
curl -X POST http://localhost:8000/teaching-style \
  -H "Content-Type: application/json" \
  -d '{
    "tone": "more casual",
    "forbidden_styles": ["formal", "academic", "verbose"]
  }'

# 3. Verify
curl http://localhost:8000/teaching-style
```

---

## Troubleshooting

### "No lectures found" when recomputing
**Solution:** Ingest at least one lecture first
```bash
curl -X POST http://localhost:8000/lectures/ingest -d '{...}'
```

### Style doesn't seem to be applied
**Check:** Is the style actually loaded?
```bash
curl http://localhost:8000/teaching-style
```

**Check backend logs:** Look for "Loaded teaching style profile" in chat API logs

### Want to reset to default
**Solution:** Delete the TeachingStyle node in Neo4j, or manually set it:
```bash
curl -X POST http://localhost:8000/teaching-style \
  -H "Content-Type: application/json" \
  -d '{
    "tone": "intuitive, grounded, exploratory, technical but conversational",
    "teaching_style": "analogy-first, zoom-out then zoom-in, highlight big picture, emphasize real-world pattern recognition",
    "sentence_structure": "short, minimal filler, avoid dramatic language",
    "explanation_order": ["big picture", "core concept definition", "example or analogy", "connection to adjacent concepts", "common pitfalls", "summary"],
    "forbidden_styles": ["overly formal", "generic GPT-like filler", "glib positivity", "verbose academic tone"]
  }'
```

---

## Quick Reference

| What You Want | Command |
|--------------|---------|
| See current style | `curl http://localhost:8000/teaching-style` |
| Learn from lectures | `curl -X POST "http://localhost:8000/teaching-style/recompute?limit=5"` |
| Update tone only | `curl -X POST http://localhost:8000/teaching-style -d '{"tone": "new tone"}'` |
| Update forbidden styles | `curl -X POST http://localhost:8000/teaching-style -d '{"forbidden_styles": ["style1", "style2"]}'` |
| Ingest new lecture | `curl -X POST http://localhost:8000/lectures/ingest -d '{...}'` |

---

## The Magic: How It Works Behind the Scenes

1. **You ingest lectures** → System stores segments + analogies
2. **You call recompute** → System sends each lecture to LLM: "What's the writing style?"
3. **LLM analyzes** → Returns: tone, teaching style, sentence structure, etc.
4. **System aggregates** → Combines styles from all lectures
5. **System saves** → Stores in Neo4j as TeachingStyle node
6. **You ask a question** → System loads your style, injects into prompt
7. **LLM answers** → In YOUR voice, following YOUR style

That's it! Every answer now sounds like you wrote it.
