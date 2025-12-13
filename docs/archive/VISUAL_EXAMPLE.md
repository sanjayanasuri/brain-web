# Visual Example: Teaching Style Profile in Action

## The Complete Flow

### 📝 Scenario: You Want Brain Web to Answer Like You

You've written several lectures explaining concepts. Now you want Brain Web chat to answer questions using YOUR style, not generic GPT style.

---

## Step 1: What You Have Now

**Current Brain Web Answer** (generic):
```
Question: "What is async/await?"

Answer: 
Async/await is a JavaScript feature that allows you to write asynchronous 
code in a synchronous style. It is built on top of Promises and provides 
a more readable syntax for handling asynchronous operations. The async keyword 
is used to declare an asynchronous function, while await is used to wait for 
a Promise to resolve before continuing execution.
```

**Problems:**
- ❌ Too formal
- ❌ No analogies
- ❌ Generic textbook tone
- ❌ Doesn't sound like you

---

## Step 2: Your Lectures (What You Actually Write)

You've written lectures like this:

**Lecture 1: "Understanding Async/Await"**
```
Async/await is like ordering food at a restaurant. You place your order 
(async function), and instead of waiting at the counter blocking everyone, 
you get a number and can do other things. When your food is ready (promise 
resolves), you get notified. The await keyword pauses your function until 
the promise resolves, but it doesn't block the whole program.
```

**Lecture 2: "React Hooks Explained"**
```
Think of useState like a box that remembers a value. When you call setState, 
React re-renders your component. useEffect runs after render, like a side 
effect handler. It's similar to componentDidMount but runs every render 
by default.
```

**Your Style Patterns:**
- ✅ Starts with analogies (restaurant, box)
- ✅ Practical examples (ordering food, remembering values)
- ✅ Conversational tone
- ✅ Short, direct sentences

---

## Step 3: Ingest Your Lectures

**Command:**
```bash
curl -X POST http://localhost:8000/lectures/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "lecture_title": "Understanding Async/Await",
    "lecture_text": "Async/await is like ordering food at a restaurant...",
    "domain": "JavaScript"
  }'
```

**What Happens:**
```
[Lecture Ingestion] Calling LLM to extract concepts...
[Lecture Ingestion] Extracted 5 nodes and 3 links
[Lecture Ingestion] Extracting segments and analogies
[Lecture Ingestion] Created 3 segments
```

**Result:** Lecture stored with segments and analogies

---

## Step 4: Learn Your Style

**Command:**
```bash
curl -X POST "http://localhost:8000/teaching-style/recompute?limit=5"
```

**What Happens Behind the Scenes:**

1. **System fetches your lectures:**
   ```
   Found 2 lectures:
   - Understanding Async/Await
   - React Hooks Explained
   ```

2. **For each lecture, LLM analyzes:**
   ```
   [LLM Analysis] Lecture: Understanding Async/Await
   - Tone: conversational, uses analogies
   - Teaching style: analogy-first, practical examples
   - Sentence structure: short, direct
   - Explanation order: analogy → what it does → how it works
   - Forbidden: formal jargon, academic tone
   ```

3. **System aggregates:**
   ```
   Combined styles from 2 lectures:
   - Tone: conversational, analogy-heavy
   - Teaching style: analogy-first, practical examples
   - Sentence structure: short, direct
   - Explanation order: analogy → mechanism → use case
   - Forbidden: formal, academic, jargon-heavy
   ```

4. **Saves to Neo4j:**
   ```
   [Teaching Style] Saved profile to Neo4j
   ```

**Response:**
```json
{
  "id": "default",
  "tone": "conversational, uses analogies, practical examples",
  "teaching_style": "analogy-first, then explains mechanism, connects to real use cases",
  "sentence_structure": "short sentences, direct comparisons",
  "explanation_order": [
    "analogy first",
    "what it does",
    "how it works",
    "when to use it"
  ],
  "forbidden_styles": [
    "formal jargon",
    "academic tone",
    "vague explanations"
  ]
}
```

---

## Step 5: Ask a Question (See the Magic!)

**Question:** "What is async/await?"

**Before (Generic):**
```
Async/await is a JavaScript feature that allows you to write asynchronous 
code in a synchronous style. It is built on top of Promises...
```

**After (Your Style):**
```
Think of async/await like ordering food at a restaurant. You place your 
order (async function), and instead of waiting at the counter blocking 
everyone, you get a number and can do other things.

When your food is ready (promise resolves), you get notified. The await 
keyword pauses your function until the promise resolves, but it doesn't 
block the whole program.

Use it when you need to wait for API calls, file reads, or any async 
operation. It's cleaner than .then() chains and reads more like regular 
code.
```

**Why It's Better:**
- ✅ Starts with analogy (your style!)
- ✅ Practical example (restaurant)
- ✅ Explains mechanism (your explanation order)
- ✅ Conversational tone (matches your lectures)
- ✅ No formal jargon

---

## What Changed in the System Prompt

**Before:**
```
You are Brain Web, a teaching assistant...
Answer in a clear, academic but accessible style.
```

**After:**
```
You are Brain Web, a teaching assistant...

The user has a specific teaching and writing style.
You MUST emulate this style when answering.

Teaching Style Profile:
- Tone: conversational, uses analogies, practical examples
- Teaching style: analogy-first, then explains mechanism
- Explanation order: analogy → what it does → how it works → when to use it
- Sentence structure: short sentences, direct comparisons
- Forbidden styles: formal jargon, academic tone, vague explanations

Key rules:
- Follow the explanation_order: analogy → what it does → how it works → when to use it
- Match the tone: conversational, uses analogies, practical examples
- Use this teaching style: analogy-first, then explains mechanism
- Write with this sentence structure: short sentences, direct comparisons
- Avoid: formal jargon, academic tone, vague explanations
```

---

## Real Terminal Output Example

```bash
$ curl http://localhost:8000/teaching-style
{
  "id": "default",
  "tone": "conversational, uses analogies, practical examples",
  "teaching_style": "analogy-first, then explains mechanism, connects to real use cases",
  "sentence_structure": "short sentences, direct comparisons",
  "explanation_order": [
    "analogy first",
    "what it does",
    "how it works",
    "when to use it"
  ],
  "forbidden_styles": [
    "formal jargon",
    "academic tone",
    "vague explanations"
  ]
}

$ curl -X POST "http://localhost:8000/teaching-style/recompute?limit=5"
{
  "id": "default",
  "tone": "conversational, uses analogies, practical examples",
  "teaching_style": "analogy-first, then explains mechanism, connects to real use cases",
  "sentence_structure": "short sentences, direct comparisons",
  "explanation_order": [
    "analogy first",
    "what it does",
    "how it works",
    "when to use it"
  ],
  "forbidden_styles": [
    "formal jargon",
    "academic tone",
    "vague explanations"
  ]
}
```

---

## Quick Test: See It Work

1. **Open Brain Web in browser** (http://localhost:3000)

2. **Before recompute:** Ask "What is a database index?"
   - Note: Generic, formal answer

3. **Run recompute:**
   ```bash
   curl -X POST "http://localhost:8000/teaching-style/recompute?limit=5"
   ```

4. **After recompute:** Ask "What is a database index?" again
   - Note: Answer now uses YOUR style (analogies, your tone, your explanation order)

---

## Summary

**The Problem:**
- Brain Web answers sounded generic
- Didn't match your teaching style

**The Solution:**
1. Ingest your lectures → System learns your style
2. Recompute style → System extracts patterns
3. Auto-inject → Every answer uses your style

**The Result:**
- Every Brain Web answer sounds like YOU wrote it
- Uses your analogies
- Follows your explanation order
- Matches your tone
- Avoids your forbidden styles

**One Command to Rule Them All:**
```bash
curl -X POST "http://localhost:8000/teaching-style/recompute?limit=5"
```

That's it! Now all answers match your style automatically.
