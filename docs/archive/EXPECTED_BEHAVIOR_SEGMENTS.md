# Expected Behavior: LectureSegment + Analogy Tracking

## Overview

When a lecture is ingested, the system should:
1. Extract concepts and relationships (existing behavior)
2. **Segment the lecture** into logical parts
3. **Link segments to concepts** they cover
4. **Extract and link analogies** used in each segment

---

## Expected Behavior

### 1. Lecture Ingestion (`POST /lectures/ingest`)

**Input:**
```json
{
  "lecture_title": "Introduction to Neural Networks",
  "lecture_text": "Neural networks are inspired by...",
  "domain": "Machine Learning"
}
```

**Expected Response:**
```json
{
  "lecture_id": "LECTURE_ABC12345",
  "nodes_created": [...],
  "nodes_updated": [...],
  "links_created": [...],
  "segments": [
    {
      "segment_id": "SEG_XXXXXXXXXX",
      "lecture_id": "LECTURE_ABC12345",
      "segment_index": 0,
      "text": "Neural networks are inspired by how the human brain works...",
      "summary": "Introduction to neural networks",
      "style_tags": ["analogy-heavy", "technical"],
      "start_time_sec": null,
      "end_time_sec": null,
      "covered_concepts": [
        {
          "node_id": "N123",
          "name": "Neural Networks",
          "domain": "Machine Learning",
          ...
        }
      ],
      "analogies": [
        {
          "analogy_id": "ANALOGY_123",
          "label": "team of workers",
          "description": "Each neuron receives input and passes result to next layer",
          "tags": ["Machine Learning"]
        }
      ]
    },
    ...
  ]
}
```

**Expected Behavior:**
- ✅ `segments` array is always present (even if empty)
- ✅ Each segment has `segment_id`, `lecture_id`, `segment_index`, `text`
- ✅ Segments are ordered by `segment_index` (0, 1, 2, ...)
- ✅ Concepts are linked to segments via `covered_concepts`
- ✅ Analogies are extracted and linked via `analogies`
- ✅ Multiple segments per lecture (typically 3-5 for a normal lecture)

---

### 2. Fetch Segments (`GET /lectures/{lecture_id}/segments`)

**Expected Response:**
```json
[
  {
    "segment_id": "SEG_123",
    "lecture_id": "LECTURE_ABC12345",
    "segment_index": 0,
    "text": "...",
    "summary": "...",
    "style_tags": [...],
    "covered_concepts": [...],
    "analogies": [...]
  },
  ...
]
```

**Expected Behavior:**
- ✅ Returns array of segments for the lecture
- ✅ Segments ordered by `segment_index`
- ✅ Includes all linked concepts and analogies
- ✅ Returns empty array `[]` if no segments exist
- ✅ Returns 404 if lecture doesn't exist (handled by lecture lookup)

---

### 3. Query Segments by Concept (`GET /lectures/segments/by-concept/{concept_name}`)

**Expected Response:**
```json
[
  {
    "segment_id": "SEG_123",
    "lecture_id": "LECTURE_ABC12345",
    "segment_index": 0,
    "text": "...",
    "covered_concepts": [...],
    "analogies": [...]
  },
  ...
]
```

**Expected Behavior:**
- ✅ Returns all segments that cover the specified concept
- ✅ Case-insensitive concept name matching
- ✅ Returns empty array `[]` if no segments found
- ✅ Includes segments from multiple lectures if concept appears in multiple

---

## Error Cases

### LLM Extraction Fails
- **Expected:** Falls back to stub (1 segment with full text, no concepts/analogies)
- **Response:** Still returns 200, but `segments` contains stub segment
- **Logs:** Error message in backend logs

### No Segments Created
- **Expected:** `segments` array is empty `[]`
- **Response:** 200 OK with empty segments array

### Lecture Not Found
- **Expected:** 404 Not Found
- **Response:** `{"detail": "Lecture not found"}`

### Concept Not Found (in segment query)
- **Expected:** Empty array `[]`
- **Response:** 200 OK with empty segments array

---

## Data Flow

```
1. User ingests lecture
   ↓
2. Backend calls LLM for concept extraction
   ↓
3. Backend creates/updates Concept nodes
   ↓
4. Backend calls LLM for segment extraction
   ↓
5. Backend creates LectureSegment nodes
   ↓
6. Backend links segments to concepts (COVERS relationship)
   ↓
7. Backend creates Analogy nodes
   ↓
8. Backend links segments to analogies (USES_ANALOGY relationship)
   ↓
9. Returns LectureIngestResult with segments
```

---

## Neo4j Graph Structure

```
(:Lecture {lecture_id: "LECTURE_123"})
  -[:HAS_SEGMENT]->
    (:LectureSegment {segment_id: "SEG_123", segment_index: 0, text: "..."})
      -[:COVERS]->
        (:Concept {node_id: "N123", name: "Neural Networks"})
      -[:USES_ANALOGY]->
        (:Analogy {analogy_id: "ANALOGY_123", label: "team of workers"})
```

---

## Test Coverage

### Unit Tests (`test_lecture_segments.py`)
- ✅ Segment creation during ingestion
- ✅ Segments field in ingestion response
- ✅ Fetch segments endpoint
- ✅ Query segments by concept
- ✅ Segment data structure validation
- ✅ Error handling

### Integration Tests
- ✅ End-to-end ingestion with segments
- ✅ Segment-to-concept linking
- ✅ Analogy extraction and linking
- ✅ Multiple segments per lecture

---

## Current Status

### ✅ Implemented
- Segment model and API endpoints
- LLM extraction function
- Concept matching and linking
- Analogy creation and linking
- Error handling with fallback

### ⚠️ Known Limitations
- LLM extraction may fail → falls back to stub
- Concept names must match exactly for linking
- Analogies not yet linked to concepts (only to segments)

### 🔄 Future Enhancements
- Link analogies directly to concepts (`ILLUSTRATES` relationship)
- Segment timestamps for audio/video
- Segment search and filtering
- Analytics on analogy usage

---

## Validation Checklist

When testing, verify:
- [ ] Segments array exists in ingestion response
- [ ] Segments have required fields (segment_id, lecture_id, segment_index, text)
- [ ] Segments are ordered by segment_index
- [ ] Concepts are linked to segments
- [ ] Analogies are extracted and linked
- [ ] GET /lectures/{id}/segments returns segments
- [ ] GET /lectures/segments/by-concept/{name} finds segments
- [ ] Error cases handled gracefully
