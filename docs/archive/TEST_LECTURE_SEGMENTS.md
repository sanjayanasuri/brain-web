# Quick Test: LectureSegment + Analogy Tracking

## Step 1: Ingest This Lecture

Copy this entire JSON payload and use it in your frontend UI or API call:

**Lecture Title:** `Introduction to Neural Networks`

**Lecture Text:**
```
Neural networks are inspired by how the human brain works. Think of it like a team of workers - each neuron receives input, processes it, and passes the result to the next layer.

The first layer is called the input layer - it's like your eyes receiving raw data. The hidden layers are like your brain processing information step by step. The output layer is like your mouth - it produces the final answer or prediction.

Backpropagation is how the network learns from mistakes. It's like a teacher correcting homework - when the network makes a wrong prediction, it adjusts its internal weights to do better next time. The learning rate controls how big these adjustments are - too fast and you overshoot, too slow and learning takes forever.

Activation functions decide whether a neuron "fires" or not. The sigmoid function is like a dimmer switch - it smoothly transitions between on and off states. ReLU is simpler - it's like a light switch that's either completely on or completely off.

Gradient descent is the optimization algorithm that finds the best weights. Imagine you're hiking down a mountain blindfolded - you take small steps in the direction that feels steepest downward. That's essentially what gradient descent does to find the minimum error.
```

**Domain:** `Machine Learning`

---

## Step 2: Copy These Commands

### Option A: Browser Console (Easiest)

Open your browser console (F12) and paste these commands one by one:

```javascript
// 1. Ingest the lecture
const ingestResponse = await fetch('http://127.0.0.1:8000/lectures/ingest', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    lecture_title: "Introduction to Neural Networks",
    lecture_text: "Neural networks are inspired by how the human brain works. Think of it like a team of workers - each neuron receives input, processes it, and passes the result to the next layer.\n\nThe first layer is called the input layer - it's like your eyes receiving raw data. The hidden layers are like your brain processing information step by step. The output layer is like your mouth - it produces the final answer or prediction.\n\nBackpropagation is how the network learns from mistakes. It's like a teacher correcting homework - when the network makes a wrong prediction, it adjusts its internal weights to do better next time. The learning rate controls how big these adjustments are - too fast and you overshoot, too slow and learning takes forever.\n\nActivation functions decide whether a neuron \"fires\" or not. The sigmoid function is like a dimmer switch - it smoothly transitions between on and off states. ReLU is simpler - it's like a light switch that's either completely on or completely off.\n\nGradient descent is the optimization algorithm that finds the best weights. Imagine you're hiking down a mountain blindfolded - you take small steps in the direction that feels steepest downward. That's essentially what gradient descent does to find the minimum error.",
    domain: "Machine Learning"
  })
});
const ingestResult = await ingestResponse.json();
console.log('✅ Ingestion complete!');
console.log('Lecture ID:', ingestResult.lecture_id);
console.log('Segments created:', ingestResult.segments?.length || 0);
console.log('Full result:', ingestResult);
```

```javascript
// 2. Save the lecture_id (copy it from above output)
const lectureId = ingestResult.lecture_id; // Replace with actual ID if needed
console.log('Using lecture ID:', lectureId);
```

```javascript
// 3. Fetch the segments
const segmentsResponse = await fetch(`http://127.0.0.1:8000/lectures/${lectureId}/segments`);
const segments = await segmentsResponse.json();
console.log('📊 Segments fetched:', segments.length);
console.log('Full segments:', segments);
```

```javascript
// 4. Inspect the first segment
if (segments.length > 0) {
  const seg = segments[0];
  console.log('First segment:', {
    id: seg.segment_id,
    index: seg.segment_index,
    text_preview: seg.text.substring(0, 100) + '...',
    concepts: seg.covered_concepts.map(c => c.name),
    analogies: seg.analogies.map(a => a.label),
    style_tags: seg.style_tags
  });
}
```

```javascript
// 5. Check what was created in Neo4j (via API)
const lectureInfo = await fetch(`http://127.0.0.1:8000/lectures/${lectureId}`);
const lecture = await lectureInfo.json();
console.log('📚 Lecture info:', lecture);
```

---

### Option B: Using curl (Terminal)

```bash
# 1. Ingest the lecture
curl -X POST http://127.0.0.1:8000/lectures/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "lecture_title": "Introduction to Neural Networks",
    "lecture_text": "Neural networks are inspired by how the human brain works. Think of it like a team of workers - each neuron receives input, processes it, and passes the result to the next layer.\n\nThe first layer is called the input layer - it is like your eyes receiving raw data. The hidden layers are like your brain processing information step by step. The output layer is like your mouth - it produces the final answer or prediction.\n\nBackpropagation is how the network learns from mistakes. It is like a teacher correcting homework - when the network makes a wrong prediction, it adjusts its internal weights to do better next time. The learning rate controls how big these adjustments are - too fast and you overshoot, too slow and learning takes forever.\n\nActivation functions decide whether a neuron \"fires\" or not. The sigmoid function is like a dimmer switch - it smoothly transitions between on and off states. ReLU is simpler - it is like a light switch that is either completely on or completely off.\n\nGradient descent is the optimization algorithm that finds the best weights. Imagine you are hiking down a mountain blindfolded - you take small steps in the direction that feels steepest downward. That is essentially what gradient descent does to find the minimum error.",
    "domain": "Machine Learning"
  }' | jq '.lecture_id, .segments | length'

# 2. Copy the lecture_id from the output above, then:
LECTURE_ID="LECTURE_XXXXX"  # Replace with actual ID

# 3. Fetch segments
curl http://127.0.0.1:8000/lectures/$LECTURE_ID/segments | jq '.'

# 4. Check segment count
curl http://127.0.0.1:8000/lectures/$LECTURE_ID/segments | jq 'length'
```

---

## Step 3: What to Check

After running the commands, verify:

### ✅ Expected Results:

1. **Ingestion Response:**
   - `lecture_id` exists (format: `LECTURE_XXXXXXXX`)
   - `segments` array exists
   - `segments.length` should be at least 1

2. **Segments Response:**
   - Array of segment objects
   - Each segment has:
     - `segment_id` (format: `SEG_XXXXXXXXXX`)
     - `lecture_id` (matches the lecture)
     - `segment_index` (0, 1, 2, ...)
     - `text` (contains lecture content)
     - `covered_concepts` (array, may be empty for stub)
     - `analogies` (array, may be empty for stub)

3. **Current Behavior (Stub):**
   - Should return **1 segment** with full lecture text
   - `covered_concepts` and `analogies` will be empty arrays
   - This is expected until LLM extraction is fully implemented

---

## Step 4: Verify in Neo4j (Optional)

If you have Neo4j Browser access:

```cypher
// Find the lecture
MATCH (l:Lecture {lecture_id: "LECTURE_XXXXX"})
RETURN l

// Find segments for this lecture
MATCH (l:Lecture {lecture_id: "LECTURE_XXXXX"})-[:HAS_SEGMENT]->(s:LectureSegment)
RETURN s.segment_id, s.segment_index, s.text
ORDER BY s.segment_index

// Check segment-to-concept links
MATCH (s:LectureSegment)-[:COVERS]->(c:Concept)
RETURN s.segment_id, c.name
LIMIT 10

// Check segment-to-analogy links
MATCH (s:LectureSegment)-[:USES_ANALOGY]->(a:Analogy)
RETURN s.segment_id, a.label
LIMIT 10
```

---

## Quick Copy-Paste Test (All-in-One)

Paste this entire block into browser console:

```javascript
(async () => {
  console.log('🚀 Starting test...');
  
  // Ingest
  const ingest = await fetch('http://127.0.0.1:8000/lectures/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lecture_title: "Introduction to Neural Networks",
      lecture_text: "Neural networks are inspired by how the human brain works. Think of it like a team of workers - each neuron receives input, processes it, and passes the result to the next layer.\n\nThe first layer is called the input layer - it's like your eyes receiving raw data. The hidden layers are like your brain processing information step by step. The output layer is like your mouth - it produces the final answer or prediction.\n\nBackpropagation is how the network learns from mistakes. It's like a teacher correcting homework - when the network makes a wrong prediction, it adjusts its internal weights to do better next time. The learning rate controls how big these adjustments are - too fast and you overshoot, too slow and learning takes forever.\n\nActivation functions decide whether a neuron \"fires\" or not. The sigmoid function is like a dimmer switch - it smoothly transitions between on and off states. ReLU is simpler - it's like a light switch that's either completely on or completely off.\n\nGradient descent is the optimization algorithm that finds the best weights. Imagine you're hiking down a mountain blindfolded - you take small steps in the direction that feels steepest downward. That's essentially what gradient descent does to find the minimum error.",
      domain: "Machine Learning"
    })
  });
  const result = await ingest.json();
  console.log('✅ Ingested! Lecture ID:', result.lecture_id);
  console.log('📊 Segments in response:', result.segments?.length || 0);
  
  // Fetch segments
  const segs = await fetch(`http://127.0.0.1:8000/lectures/${result.lecture_id}/segments`);
  const segments = await segs.json();
  console.log('📋 Fetched segments:', segments.length);
  console.log('📄 First segment preview:', segments[0]?.text?.substring(0, 150));
  console.log('🎯 Full segments:', segments);
  
  return { lectureId: result.lecture_id, segments };
})();
```

This will output everything you need to verify!
