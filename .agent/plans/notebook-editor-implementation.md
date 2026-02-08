# GoodNotes-Style Notebook Editor Implementation Plan

## Overview
Transform the current lecture editor into a unified notebook experience where text and handwriting coexist on paginated, ruled paper - similar to GoodNotes or physical notebooks.

---

## Core Principles

1. **Unified Surface**: Text and ink exist on the same ruled paper surface
2. **Paginated**: Content is broken into discrete 8.5" x 11" pages
3. **Line-Aligned Text**: Typing follows the ruled lines automatically
4. **Freeform Ink**: Drawing can happen anywhere, including between lines
5. **Auto Pencil Detection**: Apple Pencil automatically enables drawing mode
6. **Print-Ready**: Pages are designed for easy printing

---

## Technical Architecture

### Component Structure

```
NotebookEditor/
├── NotebookPage.tsx          # Single page component (8.5" x 11")
├── NotebookCanvas.tsx        # Manages paginated view
├── RuledPaper.tsx            # Paper background with lines
├── LineAlignedEditor.tsx     # TipTap editor with line snapping
├── InkLayer.tsx              # Per-page handwriting canvas
├── PageBreakManager.tsx      # Handles pagination logic
└── PencilDetector.tsx        # Auto-detects Apple Pencil input
```

---

## Phase 1: Foundation & Paper System

### 1.1 Create Ruled Paper Component
**File**: `frontend/app/components/notebook/RuledPaper.tsx`

**Features**:
- Renders ruled lines (college-ruled: 9/32" spacing = ~28px at 96 DPI)
- Page dimensions: 8.5" x 11" (816px x 1056px at 96 DPI)
- Paper types: ruled, grid, blank, dotted
- Margin line (red vertical line on left)
- Header space at top

**Implementation**:
```typescript
interface RuledPaperProps {
  type: 'ruled' | 'grid' | 'blank' | 'dotted';
  showMargin: boolean;
  lineSpacing: number; // pixels between lines
}

// SVG pattern for ruled lines
// CSS background for paper texture
// Responsive scaling for different screen sizes
```

**Acceptance Criteria**:
- [ ] Paper renders at correct dimensions
- [ ] Lines are evenly spaced and crisp
- [ ] Margin line appears on left
- [ ] Paper texture is subtle and realistic
- [ ] Scales properly on different screens

---

### 1.2 Create Page Component
**File**: `frontend/app/components/notebook/NotebookPage.tsx`

**Features**:
- Container for a single page
- Holds both text editor and ink layer
- Page number display
- Shadow/border for depth effect

**Structure**:
```typescript
interface NotebookPageProps {
  pageNumber: number;
  paperType: 'ruled' | 'grid' | 'blank';
  content: string; // TipTap JSON
  inkData: Stroke[]; // Handwriting strokes
  onContentChange: (content: string) => void;
  onInkChange: (strokes: Stroke[]) => void;
}

// Layers (bottom to top):
// 1. RuledPaper background
// 2. LineAlignedEditor (text)
// 3. InkLayer (handwriting)
```

**Acceptance Criteria**:
- [ ] Page has correct dimensions (8.5" x 11")
- [ ] Layers stack correctly (paper → text → ink)
- [ ] Page number displays in footer
- [ ] Realistic shadow/depth effect
- [ ] Smooth scrolling between pages

---

## Phase 2: Line-Aligned Text Editor

### 2.1 Create Line-Snapping Text Editor
**File**: `frontend/app/components/notebook/LineAlignedEditor.tsx`

**Features**:
- TipTap editor with custom styling
- Text snaps to ruled lines
- Line height matches paper line spacing (28px)
- Cursor starts at first line
- Auto-advance to next line when current line is full
- Respect left margin

**Implementation Details**:

**CSS Styling**:
```css
.line-aligned-editor {
  line-height: 28px; /* Match ruled line spacing */
  padding-left: 80px; /* Respect margin line */
  padding-right: 40px;
  padding-top: 60px; /* Header space */
  font-size: 16px;
  font-family: 'Crimson Pro', serif; /* Handwriting-friendly font */
}

.line-aligned-editor p {
  margin: 0;
  min-height: 28px; /* Ensure empty lines take up space */
}
```

**TipTap Extensions**:
- Custom paragraph extension with fixed line height
- Enter key behavior: create new paragraph on same page or next page
- Backspace behavior: merge paragraphs respecting line alignment

**Line Overflow Detection**:
```typescript
// Detect when text exceeds page height
const MAX_LINES_PER_PAGE = 35; // ~980px / 28px
const currentLineCount = editor.state.doc.textContent.split('\n').length;

if (currentLineCount > MAX_LINES_PER_PAGE) {
  // Move overflow content to next page
  createNewPage(overflowContent);
}
```

**Acceptance Criteria**:
- [ ] Text aligns perfectly with ruled lines
- [ ] Typing starts at first line below header
- [ ] Line height is consistent (28px)
- [ ] Left margin is respected (80px)
- [ ] Enter key creates new line on same page
- [ ] Overflow text moves to next page automatically
- [ ] Font is readable and handwriting-friendly

---

### 2.2 Implement Page Break Logic
**File**: `frontend/app/components/notebook/PageBreakManager.tsx`

**Features**:
- Detects when content exceeds page height
- Automatically creates new pages
- Splits content at paragraph boundaries
- Maintains content continuity across pages

**Algorithm**:
```typescript
function splitContentIntoPages(content: string): Page[] {
  const pages: Page[] = [];
  const paragraphs = content.split('\n');
  let currentPage: string[] = [];
  let currentLineCount = 0;
  
  for (const paragraph of paragraphs) {
    const paragraphLines = Math.ceil(paragraph.length / CHARS_PER_LINE);
    
    if (currentLineCount + paragraphLines > MAX_LINES_PER_PAGE) {
      // Save current page and start new one
      pages.push({ content: currentPage.join('\n'), pageNumber: pages.length + 1 });
      currentPage = [paragraph];
      currentLineCount = paragraphLines;
    } else {
      currentPage.push(paragraph);
      currentLineCount += paragraphLines;
    }
  }
  
  // Add final page
  if (currentPage.length > 0) {
    pages.push({ content: currentPage.join('\n'), pageNumber: pages.length + 1 });
  }
  
  return pages;
}
```

**Acceptance Criteria**:
- [ ] Content splits at paragraph boundaries
- [ ] No orphaned lines (minimum 2 lines per paragraph on a page)
- [ ] Page breaks are smooth and natural
- [ ] Editing updates pagination in real-time
- [ ] Deleting content merges pages when appropriate

---

## Phase 3: Handwriting Integration

### 3.1 Create Per-Page Ink Layer
**File**: `frontend/app/components/notebook/InkLayer.tsx`

**Features**:
- Transparent canvas overlay on each page
- Captures pen/touch input
- Stores strokes per page
- Renders existing strokes
- Supports eraser tool

**Structure**:
```typescript
interface InkLayerProps {
  pageNumber: number;
  strokes: Stroke[];
  onStrokesChange: (strokes: Stroke[]) => void;
  isDrawingEnabled: boolean; // Auto-enabled by pencil detection
  paperType: 'ruled' | 'grid' | 'blank';
}

// Canvas dimensions: 816px x 1056px (8.5" x 11")
// Pointer events: only active when Apple Pencil detected
// Z-index: above text editor but below toolbar
```

**Drawing Modes**:
- **Freeform**: Draw anywhere on the page
- **Line-Guided** (optional): Snap ink to ruled lines for neat handwriting
- **Between-Lines**: Draw in the space between lines (for diagrams, arrows, etc.)

**Acceptance Criteria**:
- [ ] Canvas overlays text without blocking it
- [ ] Strokes are smooth and responsive
- [ ] Ink persists across page navigation
- [ ] Eraser removes strokes cleanly
- [ ] Strokes are saved per-page (not global)
- [ ] Undo/redo works for ink strokes

---

### 3.2 Implement Apple Pencil Auto-Detection
**File**: `frontend/app/components/notebook/PencilDetector.tsx`

**Features**:
- Detects `pointerType === 'pen'` events
- Automatically enables drawing mode
- Disables text cursor when pencil is active
- Re-enables text cursor when finger/mouse is used

**Implementation**:
```typescript
function usePencilDetection() {
  const [isDrawingMode, setIsDrawingMode] = useState(false);
  
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'pen') {
        setIsDrawingMode(true);
        // Disable text selection
        document.body.style.userSelect = 'none';
      } else {
        setIsDrawingMode(false);
        // Re-enable text selection
        document.body.style.userSelect = 'auto';
      }
    };
    
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, []);
  
  return isDrawingMode;
}
```

**Acceptance Criteria**:
- [ ] Apple Pencil input automatically enables drawing
- [ ] Finger/mouse input enables text editing
- [ ] No manual mode toggle required
- [ ] Smooth transition between drawing and typing
- [ ] Text cursor hidden when drawing
- [ ] Drawing cursor (crosshair) shown when pencil active

---

## Phase 4: Pagination & Navigation

### 4.1 Create Paginated Notebook Canvas
**File**: `frontend/app/components/notebook/NotebookCanvas.tsx`

**Features**:
- Vertical scroll of pages
- Page shadows for depth
- Page numbers
- Smooth scrolling
- Zoom controls (50% - 200%)

**Layout**:
```typescript
// Pages stacked vertically with spacing
const PAGE_SPACING = 40px; // Space between pages

<div className="notebook-canvas">
  {pages.map((page, index) => (
    <div key={page.id} style={{ marginBottom: PAGE_SPACING }}>
      <NotebookPage
        pageNumber={index + 1}
        content={page.content}
        inkData={page.inkData}
        paperType={paperType}
      />
    </div>
  ))}
</div>
```

**Zoom Implementation**:
```typescript
const [zoom, setZoom] = useState(1.0); // 100%

// Apply CSS transform to pages
<div style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}>
  {/* Pages */}
</div>
```

**Acceptance Criteria**:
- [ ] Pages stack vertically with spacing
- [ ] Smooth scrolling between pages
- [ ] Page shadows create depth effect
- [ ] Zoom controls work (50% - 200%)
- [ ] Current page indicator visible
- [ ] Scroll position persists on reload

---

### 4.2 Implement Page Navigation
**Features**:
- Scroll to specific page
- Next/previous page buttons
- Page thumbnail sidebar (optional)
- Jump to page by number

**Keyboard Shortcuts**:
- `Cmd + ↑`: Previous page
- `Cmd + ↓`: Next page
- `Cmd + Home`: First page
- `Cmd + End`: Last page

**Acceptance Criteria**:
- [ ] Keyboard shortcuts work
- [ ] Scroll to page is smooth
- [ ] Current page is highlighted
- [ ] Page navigation doesn't lose cursor position

---

## Phase 5: Data Persistence

### 5.1 Update Data Model
**Backend**: `backend/models.py`

```python
class NotebookPage(Base):
    __tablename__ = "notebook_pages"
    
    page_id = Column(String, primary_key=True)
    lecture_id = Column(String, ForeignKey("lectures.lecture_id"))
    page_number = Column(Integer, nullable=False)
    content = Column(Text)  # TipTap JSON
    ink_data = Column(Text)  # JSON array of strokes
    paper_type = Column(String, default="ruled")
    created_at = Column(DateTime)
    updated_at = Column(DateTime)
```

**Frontend**: Update API client

```typescript
interface NotebookPage {
  page_id: string;
  lecture_id: string;
  page_number: number;
  content: string; // TipTap JSON
  ink_data: Stroke[];
  paper_type: 'ruled' | 'grid' | 'blank';
}

// API endpoints
async function getNotebookPages(lectureId: string): Promise<NotebookPage[]>
async function updateNotebookPage(page: NotebookPage): Promise<void>
async function createNotebookPage(lectureId: string): Promise<NotebookPage>
```

**Acceptance Criteria**:
- [ ] Pages save to database individually
- [ ] Ink data persists per page
- [ ] Content updates save automatically (debounced)
- [ ] Page order is maintained
- [ ] Deleted pages are removed from DB

---

### 5.2 Implement Auto-Save
**Features**:
- Debounced save (500ms after last edit)
- Save indicator (Saving... / Saved ✓)
- Offline support (queue saves)
- Conflict resolution

**Implementation**:
```typescript
const debouncedSave = useMemo(
  () => debounce(async (page: NotebookPage) => {
    setSaveStatus('saving');
    try {
      await updateNotebookPage(page);
      setSaveStatus('saved');
    } catch (error) {
      setSaveStatus('error');
      // Queue for retry
      queueOfflineSave(page);
    }
  }, 500),
  []
);

// Trigger on content or ink change
useEffect(() => {
  if (page.content || page.ink_data) {
    debouncedSave(page);
  }
}, [page.content, page.ink_data]);
```

**Acceptance Criteria**:
- [ ] Changes save automatically after 500ms
- [ ] Save status indicator is accurate
- [ ] Offline edits queue for later sync
- [ ] No data loss on page refresh
- [ ] Concurrent edits are handled gracefully

---

## Phase 6: Polish & Features

### 6.1 Add Toolbar
**Features**:
- Paper type selector (ruled, grid, blank)
- Pen color picker
- Pen width selector
- Eraser tool
- Undo/redo
- Export to PDF

**Position**: Floating toolbar (top-right or left sidebar)

**Acceptance Criteria**:
- [ ] Toolbar is always accessible
- [ ] Tools work on current page
- [ ] Undo/redo works for both text and ink
- [ ] Export generates multi-page PDF

---

### 6.2 Implement Export to PDF
**Features**:
- Export all pages as PDF
- Preserve page dimensions (8.5" x 11")
- Include both text and ink
- Maintain formatting

**Implementation**:
```typescript
async function exportToPDF(pages: NotebookPage[]) {
  const pdf = new jsPDF('p', 'in', 'letter'); // 8.5" x 11"
  
  for (const [index, page] of pages.entries()) {
    if (index > 0) pdf.addPage();
    
    // Render paper background
    // Render text content
    // Render ink strokes
  }
  
  pdf.save('notebook.pdf');
}
```

**Acceptance Criteria**:
- [ ] PDF includes all pages
- [ ] Text is selectable in PDF
- [ ] Ink renders correctly
- [ ] Page dimensions are correct
- [ ] File size is reasonable

---

## Phase 7: Migration & Rollout

### 7.1 Migrate Existing Lectures
**Strategy**:
- Convert existing lecture content to paginated format
- Preserve all text content
- Migrate existing annotations to first page
- Create migration script

**Migration Script**:
```typescript
async function migrateLectureToNotebook(lectureId: string) {
  const lecture = await getLecture(lectureId);
  const pages = splitContentIntoPages(lecture.raw_text);
  
  for (const [index, pageContent] of pages.entries()) {
    await createNotebookPage({
      lecture_id: lectureId,
      page_number: index + 1,
      content: pageContent,
      ink_data: index === 0 ? lecture.annotations : [],
      paper_type: 'ruled'
    });
  }
}
```

**Acceptance Criteria**:
- [ ] All existing lectures migrate successfully
- [ ] No content is lost
- [ ] Annotations are preserved
- [ ] Users can access old lectures in new format

---

### 7.2 Update Lecture Editor Page
**File**: `frontend/app/lecture-editor/page.tsx`

**Changes**:
- Replace `LectureEditor` with `NotebookCanvas`
- Remove mode toggle UI
- Update toolbar to notebook-style
- Maintain backward compatibility

**Acceptance Criteria**:
- [ ] New editor loads correctly
- [ ] All features work (text, ink, save, export)
- [ ] Performance is acceptable (< 100ms render time per page)
- [ ] No regressions in existing features

---

## Success Metrics

### User Experience
- [ ] Users can seamlessly switch between typing and drawing
- [ ] No mode confusion or jarring transitions
- [ ] Notebook feels like physical paper
- [ ] Pages are print-ready

### Performance
- [ ] Page render time < 100ms
- [ ] Smooth scrolling (60 FPS)
- [ ] Ink latency < 10ms
- [ ] Auto-save doesn't block UI

### Reliability
- [ ] No data loss
- [ ] Offline editing works
- [ ] Concurrent edits handled
- [ ] Migration is lossless

---

## Timeline Estimate

**Phase 1 (Foundation)**: 2-3 days
- Ruled paper component
- Page component
- Basic layout

**Phase 2 (Text Editor)**: 3-4 days
- Line-aligned editor
- Page break logic
- Overflow handling

**Phase 3 (Handwriting)**: 2-3 days
- Ink layer per page
- Pencil detection
- Drawing tools

**Phase 4 (Pagination)**: 2 days
- Notebook canvas
- Navigation
- Zoom

**Phase 5 (Persistence)**: 2-3 days
- Database schema
- API endpoints
- Auto-save

**Phase 6 (Polish)**: 2 days
- Toolbar
- Export to PDF
- UX refinements

**Phase 7 (Migration)**: 1-2 days
- Migration script
- Testing
- Rollout

**Total**: ~14-19 days (2.5-3.5 weeks)

---

## Risk Mitigation

### Technical Risks
1. **Performance with many pages**: Virtualize pages (only render visible + buffer)
2. **Ink rendering lag**: Use requestAnimationFrame and canvas optimization
3. **Data loss**: Implement robust auto-save with offline queue
4. **Browser compatibility**: Test on Safari, Chrome, Firefox

### UX Risks
1. **Learning curve**: Provide onboarding tutorial
2. **Accidental drawing**: Make pencil detection very clear (cursor change)
3. **Lost content**: Implement page recovery and version history

---

## Next Steps

1. **Review this plan** with team/stakeholders
2. **Create detailed tasks** in project management tool
3. **Set up feature branch**: `feature/notebook-editor`
4. **Start with Phase 1**: Build foundation components
5. **Iterate with user feedback**: Test early and often

---

## Notes

- This is a **major UX overhaul** - expect significant development time
- Consider **feature flag** for gradual rollout
- **User testing** is critical - get feedback early
- **Accessibility**: Ensure keyboard navigation works
- **Mobile**: Consider responsive design for iPad/tablet
