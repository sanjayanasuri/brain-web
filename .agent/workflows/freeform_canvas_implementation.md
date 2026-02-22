---
description: Infinite Freeform Canvas — Full Implementation Plan for Codex
---

# Infinite Freeform Canvas — Implementation Plan

## Stack Context (Read First)

- **Frontend**: Next.js 14 (App Router), React 18, TypeScript, Vanilla CSS, Zustand for state.
- **Editor system**: Tiptap + ProseMirror extensions inside `LectureEditor.tsx`. Intent markers (ConceptLink, ConceptMention, ConceptHover, WikipediaHover) are implemented as custom Tiptap extensions.
- **Drawing**: `PencilCanvas.tsx` (`frontend/app/components/ui/PencilCanvas.tsx`) — a `<canvas>`-based freehand drawing component with tools: pen, highlighter, eraser, lasso. Lasso produces an `onIntent` callback with `{ type, bounds, snippetUrl }`.
- **Backend**: FastAPI (Python). Lecture ingestion pipeline lives in `backend/services_lecture_ingestion.py`. The handwriting path is `ingest_handwriting()` which calls GPT-4o Vision, extracts nodes/links/segments, and persists them into Neo4j. The endpoint is `POST /lectures/ingest-ink`.
- **Graph DB**: Neo4j — concepts are `(:Concept)` nodes, relationships are `[:RELATES_TO]`-style edges. The `ingest_lecture()` and `ingest_handwriting()` functions write to it.
- **API Client**: `frontend/app/api/lectures.ts` — already has `ingestLecture`, `createLecture`, `updateLecture`, `getLectureMentions`, `createLectureMention`.
- **Routing**: New pages go in `frontend/app/<route>/page.tsx`.
- **Styles**: Global design tokens in `frontend/app/globals.css` (vars: `--background`, `--panel`, `--surface`, `--ink`, `--muted`, `--accent`, `--border`, `--shadow`). Use these everywhere.
- **Canvas State Persistence**: The backend stores per-lecture canvas strokes in `NotebookPage` nodes (`page_number`, `ink_data` JSON, `content`). The API: `GET/POST /lectures/{id}/pages`.

---

## Phase 0 — New Dependencies (install these FIRST)

```bash
cd frontend
npm install perfect-freehand
```

> **Why `perfect-freehand`?** It produces smooth, pressure-sensitive SVG paths from raw pointer events — far better than the current `quadraticCurveTo` approach in `PencilCanvas.tsx`. It is also the library used by Excalidraw and tldraw internally. No canvas-to-SVG translation needed; it renders as inline SVG, which makes shape detection trivial (path bounding boxes are accessible without pixel analysis).

No other new deps are required. The infinite canvas pan/zoom will be implemented with a CSS `transform: scale() translate()` approach on a large inner div, which avoids any third-party canvas library and keeps the rendering model simple.

---

## Phase 1 — Shared Types

**File to create**: `frontend/app/types/freeform-canvas.ts`

```typescript
export type ToolType = 'pen' | 'highlighter' | 'eraser' | 'text' | 'select';

export interface FPoint { x: number; y: number; pressure: number; }

export interface CanvasStroke {
  id: string;             // uuid
  tool: ToolType;
  color: string;
  width: number;
  points: FPoint[];
  timestamp: number;      // epoch ms — used for transcript ordering
  canvasX: number;        // world-space bounding box (computed after stroke ends)
  canvasY: number;
  canvasW: number;
  canvasH: number;
}

export interface TextBlock {
  id: string;             // uuid
  text: string;
  x: number;              // world-space
  y: number;
  w: number;
  fontSize: number;
  color: string;
  timestamp: number;
  isEditing: boolean;
}

export interface CanvasPhase {
  id: string;
  label: string;
  viewX: number;          // world-space pan offset
  viewY: number;
  zoom: number;
  order: number;
  createdAt: number;
}

export interface FreeformCanvasState {
  strokes: CanvasStroke[];
  textBlocks: TextBlock[];
  phases: CanvasPhase[];
  viewX: number;
  viewY: number;
  zoom: number;
}
```

---

## Phase 2 — Backend: New Endpoint for Freeform Canvas Capture

### 2a. New Pydantic model in `backend/models/__init__.py` (or wherever models are defined):

Look at how `HandwritingIngestRequest` is defined (it lives somewhere imported by `api_lectures.py`). Add a new model alongside it:

```python
class FreeformCanvasCaptureRequest(BaseModel):
    canvas_id: str                          # lecture_id repurposed, or a new UUID
    canvas_title: str = "Freeform Canvas"
    domain: Optional[str] = None
    strokes_json: str                       # Full JSON of CanvasStroke[] (serialized on frontend)
    text_blocks_json: str                   # Full JSON of TextBlock[]
    phases_json: Optional[str] = None      # Full JSON of CanvasPhase[]
    ocr_hint: Optional[str] = None         # Pre-extracted text for the LLM hint

class FreeformCanvasCaptureResponse(BaseModel):
    lecture_id: str
    nodes_created: List[Concept]
    nodes_updated: List[Concept]
    links_created: List[dict]
    segments: List[LectureSegment]
    transcript: str                         # Markdown transcript
    run_id: str
```

### 2b. New service function: `backend/services_freeform_canvas.py`

Create this file. It should:

1. **Parse strokes and text blocks** from JSON.
2. **Build a structured description** of the canvas layout to feed to the LLM:
   - Sort all elements (strokes + text blocks) by `timestamp` ascending.
   - For each stroke: classify as "circle/enclosure" if `isClosedLoop()` returns true (reuse the heuristic from `PencilCanvas.tsx`: start and end within 100px), otherwise classify as "line/arrow" if the stroke is relatively straight (compare bbox aspect ratio to stroke length), otherwise as "freehand mark."
   - Group text blocks by proximity to the nearest enclosure (within 80px of bounding box edge).
   - Build a human-readable description string.

The `isClosedLoop` heuristic (port from TypeScript):
```python
def is_closed_loop(points: list[dict]) -> bool:
    if len(points) < 10:
        return False
    start = points[0]
    end = points[-1]
    dist = ((end['x'] - start['x'])**2 + (end['y'] - start['y'])**2) ** 0.5
    return dist < 100
```

Arrow detection heuristic:
```python
def is_arrow(points: list[dict]) -> bool:
    if len(points) < 5:
        return False
    bbox_w = max(p['x'] for p in points) - min(p['x'] for p in points)
    bbox_h = max(p['y'] for p in points) - min(p['y'] for p in points)
    path_length = sum(
        ((points[i]['x'] - points[i-1]['x'])**2 + (points[i]['y'] - points[i-1]['y'])**2)**0.5
        for i in range(1, len(points))
    )
    # A line's path length ≈ its diagonal. A scribble has path_length >> diagonal.
    diagonal = (bbox_w**2 + bbox_h**2)**0.5
    return diagonal > 0 and (path_length / diagonal) < 2.5 and path_length > 60
```

3. **Build prompt and call LLM**. Use the existing `model_router` (already imported across backend services):

```python
FREEFORM_CAPTURE_SYSTEM_PROMPT = """
You are analyzing a freeform whiteboard. The user has described their canvas elements in spatial and temporal order.

Your job is to produce:
1. A list of concept nodes (enclosed shapes / circles = concepts).
2. A list of directed links (arrows from shape A to shape B = directed relationship).
3. A list of unanchored text blocks (free text not clearly inside any enclosure).
4. A Markdown transcript documenting what was drawn and in what order.

Return valid JSON with this schema:
{
  "nodes": [
    { "name": "string", "description": "string", "domain": "string or null", "type": "concept" }
  ],
  "links": [
    { "source_name": "string", "target_name": "string", "predicate": "string", "explanation": "string" }
  ],
  "unanchored_text": ["string"],
  "transcript": "markdown string — document order of creation, what was drawn"
}
"""
```

4. **Delegate to existing `run_lecture_extraction_engine`-equivalent logic** — reuse `ingest_handwriting`'s node/link persistence pattern exactly. Do NOT re-implement the Neo4j writes; call the same helpers: `find_concept_by_name_and_domain`, `create_concept`, `create_relationship_by_ids`, `create_lecture_segment`, `link_segment_to_concept`.

5. **Store the phases** as JSON in `lecture.metadata_json` (`updateLecture` already supports this field).

6. **Return** the `FreeformCanvasCaptureResponse` including the generated `transcript` string.

### 2c. New API endpoint in `backend/api_lectures.py` (add at bottom):

```python
@router.post("/freeform-capture", response_model=FreeformCanvasCaptureResponse)
def freeform_canvas_capture(
    payload: FreeformCanvasCaptureRequest,
    session=Depends(get_neo4j_session),
    auth: dict = Depends(require_auth),
):
    """
    Analyze a freeform canvas and produce a structured knowledge graph capture.
    Strokes are analyzed geometrically; enclosed shapes → concept nodes,
    arrows → directed links, text → notes. A Markdown transcript is produced.
    """
    from services_freeform_canvas import capture_freeform_canvas
    tenant_id = auth.get("tenant_id")
    result = capture_freeform_canvas(session, payload, tenant_id=tenant_id)
    return result
```

---

## Phase 3 — Frontend: Freeform Canvas Store (Zustand)

**File to create**: `frontend/app/state/freeformCanvasStore.ts`

```typescript
import { create } from 'zustand';
import { FreeformCanvasState, CanvasStroke, TextBlock, CanvasPhase } from '../types/freeform-canvas';
import { v4 as uuidv4 } from 'uuid'; // already available transitively

interface FreeformCanvasStore extends FreeformCanvasState {
  addStroke: (stroke: Omit<CanvasStroke, 'id'>) => void;
  addTextBlock: (block: Omit<TextBlock, 'id'>) => void;
  updateTextBlock: (id: string, text: string) => void;
  deleteTextBlock: (id: string) => void;
  addPhase: (label: string, viewX: number, viewY: number, zoom: number) => void;
  deletePhase: (id: string) => void;
  reorderPhase: (id: string, newOrder: number) => void;
  setView: (viewX: number, viewY: number, zoom: number) => void;
  undo: () => void;
  loadState: (state: Partial<FreeformCanvasState>) => void;
  getSerializedStrokes: () => string;
  getSerializedTextBlocks: () => string;
  getSerializedPhases: () => string;
}
```

Implement using `zustand`'s `create`. Keep a `history: FreeformCanvasState[]` stack for undo (max depth 50). `undo` pops the last item.

---

## Phase 4 — Frontend: InfiniteCanvas Component

**File to create**: `frontend/app/components/canvas/InfiniteCanvas.tsx`

This is the core rendering component. Architecture:

```
<div id="canvas-viewport"  // overflow: hidden, full-screen, touch-action: none
  <div id="canvas-world"   // transform: `scale(${zoom}) translate(${viewX}px, ${viewY}px)`
                           // width: 8000px; height: 6000px; position: relative
    <svg id="strokes-svg"  // absolute, 100% width/height, pointer-events: none
      {strokes.map(stroke => <SvgStrokePath ... />)}
    </svg>
    {textBlocks.map(block => <TextBlockItem ... />)}
    {/* Grid dots background via CSS background-image: radial-gradient */}
  </div>
</div>
```

### 4a. Pan & Zoom

- **Pan**: On `pointerdown` when `activeTool === 'select'` OR two-finger touch: track pointer delta, update `viewX/viewY` in store.
- **Zoom**: On `wheel` event: `zoom = clamp(zoom * (1 - e.deltaY * 0.001), 0.1, 4)`. Zoom toward cursor (adjust viewX/Y to keep cursor stable).
- Pinch-to-zoom on touch: track two-pointer distance delta.

### 4b. Drawing (pen/highlighter/eraser)

Use `perfect-freehand`:
```typescript
import getStroke from 'perfect-freehand';

// On pointerup, finalize stroke:
const strokePoints = getStroke(rawPoints, { size: width, thinning: 0.5, smoothing: 0.5 });
const pathData = getSvgPathFromStroke(strokePoints); // standard helper
```

The `getSvgPathFromStroke` function is a 10-line utility (included in perfect-freehand examples):
```typescript
function getSvgPathFromStroke(stroke: number[][]): string {
  if (!stroke.length) return '';
  const d = stroke.reduce((acc, [x0, y0], i, arr) => {
    const [x1, y1] = arr[(i + 1) % arr.length];
    acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    return acc;
  }, ['M', ...stroke[0], 'Q']);
  return d.join(' ');
}
```

Store raw points (not perfect-freehand output) in the `CanvasStroke` for geometric analysis. Store the computed SVG path string for rendering.

### 4c. Text Blocks

On double-click on empty canvas space (when `activeTool === 'text'` or just double-click):
- Create a `TextBlock` at world-space coordinates (convert from screen coords using `(screenX / zoom) - viewX`).
- Render as an absolutely-positioned `<div contenteditable>` inside `canvas-world`.
- On blur: set `isEditing = false`, persist text.
- On Escape: cancel if empty (delete block).

### 4d. Closed-Loop Detection (client-side)

After every stroke ends, check if it's a closed loop:
```typescript
function isClosedLoop(points: FPoint[]): boolean {
  if (points.length < 10) return false;
  const dx = points[0].x - points[points.length - 1].x;
  const dy = points[0].y - points[points.length - 1].y;
  return Math.sqrt(dx * dx + dy * dy) < 100;
}
```

If true → render the stroke with a subtle fill (low-opacity version of the stroke color) to visually indicate it's been detected as a "concept enclosure." Add a small animated ring/pulse effect to signal detection.

### 4e. Arrow Detection (client-side)

After every stroke ends:
```typescript
function isArrow(points: FPoint[]): boolean {
  const bbox = getBoundingBox(points);
  const diagonal = Math.sqrt(bbox.w ** 2 + bbox.h ** 2);
  const pathLen = points.reduce((sum, p, i) =>
    i === 0 ? sum : sum + Math.hypot(p.x - points[i-1].x, p.y - points[i-1].y), 0);
  return diagonal > 60 && (pathLen / diagonal) < 2.5;
}
```

If true → draw an arrowhead at the end of the stroke (a small filled triangle computed from the last two points' angle).

---

## Phase 5 — Frontend: Toolbar & Phase Panel

**File to create**: `frontend/app/components/canvas/CanvasToolbar.tsx`

Floating draggable toolbar (reuse the drag pattern from `PencilCanvas.tsx`). Tools:
- Pen (P), Highlighter (H), Eraser (E), Text (T), Select/Pan (V)
- Color swatches (5 colors for pen, 4 for highlighter)
- Brush size slider
- **Undo** button
- **+ Phase** button → opens a small popover to name then save the current viewport
- **Capture** button (primary CTA, accent color, pill shape)

**File to create**: `frontend/app/components/canvas/PhasePanel.tsx`

A collapsible panel on the right side:
```
┌─────────────────────┐
│ Phases              │
│ + Add Phase         │
│ ─────────────────── │
│ 1. Introduction  [▶]│
│ 2. Concept A     [▶]│
│ 3. Summary       [▶]│
└─────────────────────┘
```

- Clicking `[▶]` on a phase animates viewport to that phase using a CSS transition:
  ```typescript
  // Animate to phase via requestAnimationFrame lerp
  function animateToPhase(phase: CanvasPhase) {
    // lerp viewX, viewY, zoom over 600ms
  }
```
- **Present Mode**: Clicking "Present" starts auto-cycling through phases with smooth animation. Keyboard arrow keys advance/go back.

---

## Phase 6 — Frontend: Capture Flow

**File to create**: `frontend/app/components/canvas/CaptureModal.tsx`

When user clicks **Capture**:
1. Show a modal: "Analyzing your canvas…" with a spinner.
2. Collect from store: `strokes`, `textBlocks`, `phases`.
3. Optionally run client-side Tesseract OCR on a rendered snapshot for the `ocr_hint` (reuse the OCR logic from `PencilCanvas.tsx`'s `handleIngest`).
4. Call new API endpoint:
   ```typescript
   POST /api/canvas/capture   // Next.js route handler (proxy)
   {
     canvas_id: string,
     canvas_title: string,
     domain?: string,
     strokes_json: JSON.stringify(strokes),
     text_blocks_json: JSON.stringify(textBlocks),
     phases_json: JSON.stringify(phases),
     ocr_hint?: string
   }
   ```
5. On response, show a **Capture Results Panel**:
   - "📍 X concepts created, Y links created"
   - Markdown transcript rendered inline (using `markdown-it`, already in deps)
   - "Open in Knowledge Graph" button → `router.push('/graphs')`
   - "Open in Lecture Editor" button → `router.push('/lecture-editor?lectureId=...')`
   - Dismiss/Close

### 6a. Next.js API Route (proxy)

**File to create**: `frontend/app/api/canvas/capture/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]/route';

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const body = await request.json();
  const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (session?.accessToken) {
    headers['Authorization'] = `Bearer ${session.accessToken}`;
  }
  const resp = await fetch(`${backendUrl}/lectures/freeform-capture`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
```

Also add a **save-canvas** route for auto-save:
**File to create**: `frontend/app/api/canvas/save/route.ts`
This proxies to `PUT /lectures/{id}` with `metadata_json` containing the serialized canvas state.

---

## Phase 7 — Frontend: Auto-Save

Inside the `InfiniteCanvas` component, add a debounced auto-save:
```typescript
useEffect(() => {
  const timeout = setTimeout(async () => {
    await fetch(`/api/canvas/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canvas_id: canvasId,
        state: {
          strokes: store.strokes,
          textBlocks: store.textBlocks,
          phases: store.phases,
          viewX: store.viewX,
          viewY: store.viewY,
          zoom: store.zoom,
        }
      })
    });
  }, 2000);
  return () => clearTimeout(timeout);
}, [store.strokes, store.textBlocks, store.phases]);
```

The canvas state is stored in `lecture.metadata_json` (already a string field, already persisted by `updateLecture`).

---

## Phase 8 — Frontend: Page Route

**File to create**: `frontend/app/freeform-canvas/page.tsx`

```
URL: /freeform-canvas
URL: /freeform-canvas?canvasId=LECTURE_XXXXXXXX  (to resume)
```

On mount:
1. If `canvasId` is in query params, call `GET /lectures/{canvasId}` and parse `metadata_json` to restore canvas state.
2. If no `canvasId`, create a new lecture via `createLecture({ title: 'Untitled Canvas', raw_text: '' })`, then `router.replace` to include the new `canvasId` in the URL.

Render:
```tsx
<div style={{ position: 'fixed', inset: 0, background: 'var(--background)' }}>
  <CanvasToolbar ... />
  <PhasePanel ... />
  <InfiniteCanvas canvasId={canvasId} />
  {captureResult && <CaptureModal result={captureResult} onClose={...} />}
</div>
```

---

## Phase 9 — Navigation Integration

**File to edit**: wherever the main nav lives (`frontend/app/components/navigation/`).

Add a nav item:
```tsx
{ label: 'Freeform', href: '/freeform-canvas', icon: <SquarePenIcon /> }
```

Also add an entry card to the Lecture Studio landing page (`frontend/app/lecture-studio/page.tsx`) under the "Write Notes" button:
```tsx
<button onClick={() => router.push('/freeform-canvas')}>
  🎨 Freeform Canvas
</button>
```

---

## Phase 10 — Polish Pass (Post-Capture)

After capture, offer a "Polish" button that:
1. Iterates all closed-loop strokes.
2. Computes a clean bounding ellipse for each (using the min/max x/y of the stroke's points, with 10px padding).
3. Replaces the freehand closed stroke with a clean SVG `<ellipse>` element at those coords.
4. Moves all text blocks within 80px of the ellipse into a styled label div centered below the ellipse.

This is pure frontend geometry — no backend call needed.

---

## File Map Summary

### NEW files to create:
```
frontend/app/types/freeform-canvas.ts         ← shared types
frontend/app/state/freeformCanvasStore.ts     ← Zustand store
frontend/app/components/canvas/
  InfiniteCanvas.tsx                          ← core canvas
  CanvasToolbar.tsx                           ← tool dock
  PhasePanel.tsx                              ← phase list + presentation
  CaptureModal.tsx                            ← capture results
frontend/app/freeform-canvas/page.tsx         ← route
frontend/app/api/canvas/capture/route.ts      ← Next.js proxy route
frontend/app/api/canvas/save/route.ts         ← auto-save proxy

backend/services_freeform_canvas.py           ← capture service
```

### FILES TO EDIT:
```
backend/models/__init__.py (or wherever HandwritingIngestRequest lives)
  → Add FreeformCanvasCaptureRequest, FreeformCanvasCaptureResponse

backend/api_lectures.py
  → Add POST /freeform-capture endpoint at bottom

frontend/app/components/navigation/  (whichever nav file)
  → Add "Freeform" nav item

frontend/app/lecture-studio/page.tsx
  → Add "Freeform Canvas" button in the header action area
```

---

## Acceptance Criteria

1. User can open `/freeform-canvas` and get a blank infinite canvas.
2. Canvas auto-saves every 2 seconds and restores on reload (via `canvasId` in URL).
3. Closed loops are detected client-side and subtly filled.
4. Arrows are detected client-side and rendered with arrowheads.
5. Text blocks can be added by double-clicking.
6. Pan: click-drag with Select tool. Zoom: scroll wheel + pinch.
7. Phases can be created, reordered, and played back as a presentation.
8. Capture sends data to backend, which uses GPT-4o to extract concepts + links → creates them in Neo4j.
9. Capture returns a Markdown transcript shown in the modal.
10. "Open in Knowledge Graph" navigates to `/graphs`. "Open in Lecture Editor" navigates to `/lecture-editor?lectureId=...`.
11. No existing Lecture Studio or LectureEditor functionality is broken.
