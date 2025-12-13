# Testing LectureSegment + Analogy Tracking

This guide explains how to test the new LectureSegment + Analogy tracking feature in the frontend.

## Quick Test (Browser Console)

The easiest way to test is using the browser's developer console:

1. **Start your backend** (if not already running):
   ```bash
   cd backend
   python -m uvicorn main:app --reload
   ```

2. **Start your frontend** (if not already running):
   ```bash
   cd frontend
   npm run dev
   ```

3. **Open your browser** to `http://localhost:3000` (or your frontend URL)

4. **Open Developer Console** (F12 or Cmd+Option+I)

5. **Ingest a test lecture** using the UI or console:
   ```javascript
   // In browser console
   const response = await fetch('http://127.0.0.1:8000/lectures/ingest', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({
       lecture_title: "Test Lecture: Machine Learning Basics",
       lecture_text: "Machine learning is like teaching a computer to recognize patterns. Think of it like a DJ reading the crowd - the DJ learns which songs work best based on audience reactions. Similarly, a machine learning model learns from data to make predictions.",
       domain: "Machine Learning"
     })
   });
   const result = await response.json();
   console.log('Ingestion result:', result);
   console.log('Lecture ID:', result.lecture_id);
   console.log('Segments:', result.segments);
   ```

6. **Fetch segments** for the lecture:
   ```javascript
   // Replace LECTURE_XXXXX with the actual lecture_id from step 5
   const lectureId = result.lecture_id; // or use the ID from step 5
   const segmentsResponse = await fetch(`http://127.0.0.1:8000/lectures/${lectureId}/segments`);
   const segments = await segmentsResponse.json();
   console.log('Segments:', segments);
   console.log('Number of segments:', segments.length);
   segments.forEach((seg, idx) => {
     console.log(`Segment ${idx + 1}:`, {
       index: seg.segment_index,
       text: seg.text.substring(0, 100) + '...',
       concepts: seg.covered_concepts.map(c => c.name),
       analogies: seg.analogies.map(a => a.label)
     });
   });
   ```

## Test Using the Updated UI Components

### Option 1: Use the LectureIngestion Component

The `LectureIngestion` component has been updated to show segment count:

1. Use the lecture ingestion form in your UI
2. After ingestion, you'll see "Segments: X segments" in the success message
3. Copy the `lecture_id` from the success message

### Option 2: Add the LectureSegmentsViewer Component

A new component `LectureSegmentsViewer.tsx` has been created. To use it:

1. **Add it to your page** (e.g., in `app/page.tsx` or `GraphVisualization.tsx`):

   ```tsx
   import LectureSegmentsViewer from './components/LectureSegmentsViewer';
   
   // In your component:
   <LectureSegmentsViewer />
   ```

2. **Or add it conditionally** to GraphVisualization:

   ```tsx
   // At the top of GraphVisualization.tsx
   import LectureSegmentsViewer from './LectureSegmentsViewer';
   
   // In the component, add state:
   const [showSegmentsViewer, setShowSegmentsViewer] = useState(false);
   
   // Add a button to toggle it:
   <button onClick={() => setShowSegmentsViewer(!showSegmentsViewer)}>
     {showSegmentsViewer ? 'Hide' : 'Show'} Segments Viewer
   </button>
   
   {showSegmentsViewer && <LectureSegmentsViewer />}
   ```

## Testing Checklist

- [ ] **Ingest a lecture** and verify `segments` array is returned
- [ ] **Check segment count** - should be at least 1 (even if stub)
- [ ] **Fetch segments** via GET endpoint using lecture_id
- [ ] **Verify segment structure**:
  - `segment_id` exists
  - `lecture_id` matches
  - `segment_index` is set
  - `text` contains lecture content
  - `covered_concepts` array exists (may be empty initially)
  - `analogies` array exists (may be empty initially)
- [ ] **Check Neo4j** (optional):
  ```cypher
  MATCH (l:Lecture)-[:HAS_SEGMENT]->(s:LectureSegment)
  RETURN l.lecture_id, s.segment_id, s.segment_index, s.text
  ORDER BY l.lecture_id, s.segment_index
  LIMIT 10
  ```

## Expected Behavior

### Current Implementation (Stub)

Right now, `extract_segments_and_analogies_with_llm()` returns a **single stub segment** with:
- `segment_index: 0`
- `text`: full lecture text
- `covered_concepts: []` (empty)
- `analogies: []` (empty)

This means:
- ✅ Segments are created in Neo4j
- ✅ Lecture node is created
- ✅ Segments are linked to Lecture via `HAS_SEGMENT`
- ⚠️ Concepts and analogies are not yet extracted (stub implementation)

### Next Steps

To enable full functionality, you'll need to:

1. **Implement LLM extraction** in `extract_segments_and_analogies_with_llm()`:
   - Create a prompt similar to `LECTURE_TO_GRAPH_PROMPT`
   - Ask LLM to segment the lecture
   - Extract concepts per segment
   - Extract analogies with labels and descriptions

2. **Test with real segmentation**:
   - Provide a longer lecture text
   - Verify multiple segments are created
   - Verify concepts are linked to segments
   - Verify analogies are extracted and linked

## Troubleshooting

### No segments returned
- Check that `lecture_id` is correct
- Verify the lecture was ingested successfully
- Check backend logs for errors

### Segments array is empty
- This is expected for the stub implementation
- Verify segments are created in Neo4j:
  ```cypher
  MATCH (s:LectureSegment) RETURN s LIMIT 5
  ```

### API errors
- Check backend is running on port 8000
- Verify CORS is configured correctly
- Check browser console for network errors

## Example Test Lecture

Use this sample lecture text for testing:

```
Title: Introduction to Neural Networks

Neural networks are inspired by how the human brain works. Think of it like a team of workers - each neuron receives input, processes it, and passes the result to the next layer.

The first layer is like your eyes - it receives raw data. The hidden layers are like your brain processing information. The output layer is like your mouth - it produces the final answer.

Backpropagation is how the network learns from mistakes. It's like a teacher correcting homework - when the network makes a wrong prediction, it adjusts its weights to do better next time.

Activation functions decide whether a neuron "fires" or not. The sigmoid function is like a dimmer switch - it smoothly transitions between on and off states.
```

This should create:
- Multiple concepts: Neural Networks, Backpropagation, Activation Functions, etc.
- Multiple analogies: "team of workers", "teacher correcting homework", "dimmer switch"
- Multiple segments (once LLM extraction is implemented)
