# Test LLM Extraction Implementation

## What Was Implemented

✅ **LLM Segmentation Prompt** - Created `LECTURE_SEGMENTATION_PROMPT` in `prompts.py`
✅ **Full LLM Extraction** - Implemented `extract_segments_and_analogies_with_llm()` 
✅ **Concept Matching** - Improved to match concepts from current ingestion first
✅ **Error Handling** - Falls back to stub if LLM fails

---

## Test It Now

### Step 1: Ingest a Lecture with Analogies

Paste this into your browser console:

```javascript
(async () => {
  console.log('🧪 Testing LLM Segment Extraction\n');
  
  const response = await fetch('http://127.0.0.1:8000/lectures/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lecture_title: "Introduction to Neural Networks",
      lecture_text: "Neural networks are inspired by how the human brain works. Think of it like a team of workers - each neuron receives input, processes it, and passes the result to the next layer.\n\nThe first layer is called the input layer - it's like your eyes receiving raw data. The hidden layers are like your brain processing information step by step. The output layer is like your mouth - it produces the final answer or prediction.\n\nBackpropagation is how the network learns from mistakes. It's like a teacher correcting homework - when the network makes a wrong prediction, it adjusts its internal weights to do better next time. The learning rate controls how big these adjustments are - too fast and you overshoot, too slow and learning takes forever.\n\nActivation functions decide whether a neuron \"fires\" or not. The sigmoid function is like a dimmer switch - it smoothly transitions between on and off states. ReLU is simpler - it's like a light switch that's either completely on or completely off.\n\nGradient descent is the optimization algorithm that finds the best weights. Imagine you're hiking down a mountain blindfolded - you take small steps in the direction that feels steepest downward. That's essentially what gradient descent does to find the minimum error.",
      domain: "Machine Learning"
    })
  });
  
  const result = await response.json();
  console.log('✅ Ingestion complete!');
  console.log('   Lecture ID:', result.lecture_id);
  console.log('   Segments:', result.segments.length);
  
  // Check segments
  result.segments.forEach((seg, i) => {
    console.log(`\n📄 Segment ${i + 1}:`);
    console.log(`   Index: ${seg.segment_index}`);
    console.log(`   Text length: ${seg.text.length} chars`);
    console.log(`   Summary: ${seg.summary || 'None'}`);
    console.log(`   Style tags: ${seg.style_tags.join(', ') || 'None'}`);
    console.log(`   Concepts: ${seg.covered_concepts.length}`);
    if (seg.covered_concepts.length > 0) {
      console.log(`      - ${seg.covered_concepts.map(c => c.name).join(', ')}`);
    }
    console.log(`   Analogies: ${seg.analogies.length}`);
    if (seg.analogies.length > 0) {
      seg.analogies.forEach(a => {
        console.log(`      - "${a.label}": ${a.description || 'No description'}`);
      });
    }
  });
  
  return result;
})();
```

### Step 2: Verify Segments Were Created

```javascript
const lectureId = 'LECTURE_XXXXX'; // Use the ID from Step 1

const segments = await fetch(`http://127.0.0.1:8000/lectures/${lectureId}/segments`)
  .then(r => r.json());

console.log(`\n✅ Found ${segments.length} segment(s)`);
console.log('\n📊 Summary:');
console.log(`   Total concepts linked: ${segments.reduce((sum, s) => sum + s.covered_concepts.length, 0)}`);
console.log(`   Total analogies: ${segments.reduce((sum, s) => sum + s.analogies.length, 0)}`);

// Show analogies
const allAnalogies = segments.flatMap(s => s.analogies);
if (allAnalogies.length > 0) {
  console.log('\n💡 Analogies found:');
  allAnalogies.forEach(a => {
    console.log(`   - "${a.label}"`);
  });
}
```

### Step 3: Test Concept Query

```javascript
// Find segments covering a specific concept
const conceptName = 'Neural Networks'; // or 'Backpropagation', 'Gradient Descent', etc.

const conceptSegments = await fetch(
  `http://127.0.0.1:8000/lectures/segments/by-concept/${encodeURIComponent(conceptName)}`
).then(r => r.json());

console.log(`\n🎯 Found ${conceptSegments.length} segment(s) explaining "${conceptName}"`);
conceptSegments.forEach((seg, i) => {
  console.log(`\n   ${i + 1}. From lecture: ${seg.lecture_id}`);
  console.log(`      ${seg.text.substring(0, 150)}...`);
  if (seg.analogies.length > 0) {
    console.log(`      💡 Analogies: ${seg.analogies.map(a => a.label).join(', ')}`);
  }
});
```

---

## Expected Results

### ✅ Success Indicators:

1. **Multiple segments** - Should get 3-5 segments (not just 1)
2. **Concepts linked** - Each segment should have `covered_concepts` populated
3. **Analogies extracted** - Should find analogies like:
   - "team of workers"
   - "teacher correcting homework"
   - "dimmer switch"
   - "light switch"
   - "hiking down a mountain blindfolded"
4. **Summaries** - Each segment should have a summary
5. **Style tags** - Segments should have style tags like ["analogy-heavy", "technical"]

### ⚠️ If You See:

- **Only 1 segment** - LLM extraction might have failed, check backend logs
- **Empty concepts/analogies** - LLM might not have extracted them, check prompt
- **Error messages** - Check backend console for LLM API errors

---

## Backend Logs to Check

Look for these messages in your backend console:

```
[Segment Extraction] Calling LLM to segment lecture: Introduction to Neural Networks
[Segment Extraction] Successfully extracted X segments
[Lecture Ingestion] Created X segments
```

If you see errors, check:
- OpenAI API key is set
- API key has credits
- Network connectivity

---

## Troubleshooting

### LLM Not Being Called

Check that `OPENAI_API_KEY` is set:
```bash
# In backend directory
echo $OPENAI_API_KEY
```

### LLM Returns Invalid JSON

The function falls back to stub. Check backend logs for JSON parsing errors.

### Concepts Not Matching

The function tries to match concept names from segments to concepts created in the main extraction. If names don't match exactly, they won't link. Check:
- Concept names in segments match concept names in main extraction
- Case-insensitive matching is working

---

## What Changed

1. **`prompts.py`** - Added `LECTURE_SEGMENTATION_PROMPT`
2. **`services_lecture_ingestion.py`**:
   - Implemented full LLM call in `extract_segments_and_analogies_with_llm()`
   - Added JSON parsing and validation
   - Improved concept matching to use `node_name_to_id` map first
   - Added error handling with fallback to stub

---

## Next Steps

Once this works:
1. ✅ Test with multiple lectures
2. ✅ Verify analogies are being tracked
3. ✅ Build UI to show segments
4. ✅ Add analytics (which analogies used most, etc.)
