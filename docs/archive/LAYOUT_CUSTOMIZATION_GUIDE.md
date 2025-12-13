# Layout Customization Guide

This guide shows you exactly where to adjust the sizes of different sections in Brain Web.

## File Locations

### 1. **React Component (Layout Structure)**
**File:** `frontend/app/components/GraphVisualization.tsx`

**Key Lines:**
- **Line 58**: `const [graphHeightPct, setGraphHeightPct] = useState(55);`
  - This controls the split between graph pane and chat pane
  - Current: 55% graph, 45% chat
  - Increase to make graph bigger (e.g., 60 = 60% graph, 40% chat)
  - Decrease to make chat bigger (e.g., 50 = 50% graph, 50% chat)

- **Line 832**: `<div className="graph-pane" style={{ flexBasis: `${graphHeightPct}%` }}>`
  - Graph pane container (contains header, controls, and canvas)

- **Line 1052**: `<div className="chat-pane" style={{ flexBasis: `${100 - graphHeightPct}%` }}>`
  - Chat pane container (automatically calculated from graphHeightPct)

### 2. **CSS Styles (Visual Sizing)**
**File:** `frontend/app/globals.css`

## Section Breakdown

### **TOP SECTION (Header & Controls)**

**CSS Classes in `globals.css`:**

1. **`.graph-pane`** (Lines ~52-59)
   - Controls overall top section container
   - `padding: 8px 16px 4px;` - Adjust top/bottom padding
   - `gap: 6px;` - Space between header, controls, and canvas

2. **`.graph-header`** (Lines ~61-66)
   - Title, subtitle, and stats bar
   - `gap: 12px;` - Space between title and stats
   - `margin-bottom: 2px;` - Space below header

3. **`.title`** (Lines ~76-81)
   - Main title "Lecture-friendly knowledge bubbles"
   - `font-size: 22px;` - Make smaller/larger
   - `margin-bottom: 3px;` - Space below title

4. **`.subtitle`** (Lines ~83-87)
   - Description text
   - `font-size: 13px;` - Make smaller/larger
   - `line-height: 1.4;` - Line spacing

5. **`.graph-controls`** (Lines ~115-119)
   - Sliders and domain filters container
   - `gap: 8px;` - Space between control cards
   - `grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));` - Card sizing

6. **`.control-card`** (Lines ~121-128)
   - Individual control cards (Domain spread, Bubble padding, Domains)
   - `padding: 10px 12px;` - Internal padding
   - `border-radius: 12px;` - Corner rounding

### **MIDDLE SECTION (Graph Canvas)**

**CSS Classes in `globals.css`:**

1. **`.graph-canvas`** (Lines ~193-203)
   - The actual graph visualization area
   - `min-height: 400px;` - Minimum height (increase for bigger graph)
   - `flex: 1 1 auto;` - Takes remaining space in graph-pane
   - This is the BIGGEST factor for graph size

**React Component:**
- The graph canvas is inside `.graph-pane` and takes up remaining space after header/controls
- To make it bigger: reduce header/controls size OR increase `graphHeightPct`

### **BOTTOM SECTION (Chat)**

**CSS Classes in `globals.css`:**

1. **`.chat-pane`** (Lines ~284-295)
   - Overall chat container
   - `padding: 14px 16px 16px;` - Internal padding
   - `gap: 14px;` - Space between elements
   - `min-height: 45vh;` - Minimum height (increase for bigger chat)
   - This controls the overall chat section size

2. **`.chat-stream`** (Lines ~337-345)
   - Scrollable message area
   - `min-height: 200px;` - Minimum height for scrolling
   - `gap: 12px;` - Space between messages
   - `padding: 8px 0;` - Vertical padding

3. **`.chat-header`** (Lines ~297-302)
   - "Graph concierge" header
   - `gap: 12px;` - Space between elements

4. **`.chat-input-row`** (Lines ~393-398)
   - Input field container
   - `gap: 10px;` - Space between input and send button

## Quick Adjustment Guide

### Make Graph Bigger:
1. **Increase `graphHeightPct`** in `GraphVisualization.tsx` line 58 (e.g., 60 or 65)
2. **Increase `.graph-canvas` min-height** in `globals.css` (e.g., 500px)
3. **Reduce `.graph-pane` padding/gaps** to give more space to canvas

### Make Chat Bigger:
1. **Decrease `graphHeightPct`** in `GraphVisualization.tsx` line 58 (e.g., 50 or 45)
2. **Increase `.chat-pane` min-height** in `globals.css` (e.g., 50vh)
3. **Increase `.chat-stream` min-height** for more message area

### Make Top Section Smaller:
1. **Reduce `.graph-pane` padding** (currently `8px 16px 4px`)
2. **Reduce `.title` font-size** (currently 22px)
3. **Reduce `.graph-controls` gap** (currently 8px)
4. **Reduce `.control-card` padding** (currently `10px 12px`)

## Example Adjustments

### For a Much Bigger Graph:
```typescript
// GraphVisualization.tsx line 58
const [graphHeightPct, setGraphHeightPct] = useState(65); // Was 55
```

```css
/* globals.css - .graph-canvas */
min-height: 500px; /* Was 400px */
```

### For a Much Bigger Chat:
```typescript
// GraphVisualization.tsx line 58
const [graphHeightPct, setGraphHeightPct] = useState(45); // Was 55
```

```css
/* globals.css - .chat-pane */
min-height: 55vh; /* Was 45vh */
```

### For a Smaller Top Section:
```css
/* globals.css - .graph-pane */
padding: 4px 16px 2px; /* Was 8px 16px 4px */
gap: 4px; /* Was 6px */

/* globals.css - .title */
font-size: 18px; /* Was 22px */
margin-bottom: 2px; /* Was 3px */

/* globals.css - .graph-controls */
gap: 6px; /* Was 8px */
```

## Current Default Values Summary

- **Graph Height Percentage**: 55% (45% for chat)
- **Graph Canvas Min Height**: 400px
- **Chat Pane Min Height**: 45vh
- **Chat Stream Min Height**: 200px
- **Title Font Size**: 22px
- **Graph Pane Padding**: 8px 16px 4px
- **Graph Controls Gap**: 8px

