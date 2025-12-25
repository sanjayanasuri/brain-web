# Cross-Graph Node Visibility & Navigation Design

## Scenario We're Solving

**Problem**: A concept (e.g., "TSMC") exists in multiple graphs:
- Personal Finance graph (`G0F87FFD7`) - TSMC as investment opportunity
- Default graph (`default`) - TSMC as semiconductor company

**Requirements**:
1. **Localized Instances**: Same concept can exist independently in different graphs with different contexts
2. **No Auto-Merge**: Duplicates should NOT be automatically merged - they represent different perspectives
3. **Cross-Graph Visibility**: When viewing a node, see "this node also exists in graph X" with navigation links
4. **Seamless Transitions**: Easy way to jump between graph instances of the same concept
5. **Global Graph Option**: Explicit way to add to default/global graph regardless of current graph
6. **Manual Merge Option**: If user wants to merge, maintain graph-specific context with links showing "also seen in"

## Proposed Solution Architecture

### 1. Cross-Graph Instance Discovery API

**New Endpoint**: `GET /concepts/{node_id}/cross-graph-instances`

Returns all instances of a concept (by name) across all graphs:

```python
{
  "concept_name": "TSMC",
  "instances": [
    {
      "node_id": "N55D928BF",
      "graph_id": "G0F87FFD7",
      "graph_name": "Personal Finance",
      "domain": "Technology",
      "description": "TSMC as investment opportunity...",
      "created_at": "2024-01-15T10:30:00Z"
    },
    {
      "node_id": "NC53B0A1D",
      "graph_id": "default",
      "graph_name": "Default",
      "domain": "Technology",
      "description": "TSMC as semiconductor company...",
      "created_at": "2024-01-10T08:20:00Z"
    }
  ],
  "total_instances": 2
}
```

### 2. Cross-Graph Link Relationship

**New Relationship Type**: `CROSS_GRAPH_LINK`

When a user manually merges or links nodes across graphs, create a bidirectional link:

```cypher
// Link TSMC instances across graphs
MATCH (c1:Concept {node_id: "N55D928BF", graph_id: "G0F87FFD7"})
MATCH (c2:Concept {node_id: "NC53B0A1D", graph_id: "default"})
MERGE (c1)-[:CROSS_GRAPH_LINK {linked_at: timestamp(), linked_by: "user_id"}]-(c2)
```

**Properties**:
- `linked_at`: Timestamp when linked
- `linked_by`: User who created the link
- `link_type`: "manual_merge" | "user_linked" | "auto_detected"
- `confidence`: Similarity score if auto-detected

### 3. Enhanced Concept View UI

**New Component**: `CrossGraphInstancesPanel`

Shows in the context panel when viewing a concept:

```
┌─────────────────────────────────────┐
│ TSMC                                │
│                                     │
│ Also seen in:                       │
│ • Personal Finance (G0F87FFD7)     │
│   [View in Personal Finance] →     │
│ • Default                           │
│   [View in Default] →               │
│                                     │
│ [Link these instances]              │
└─────────────────────────────────────┘
```

### 4. Global Graph Addition

**Chat Command**: `"add TSMC to global graph"` or `"add TSMC globally"`

**UI Option**: Checkbox "Add to global graph" when creating concept

**Backend Logic**:
- If `graph_id=default` or `add_to_global=true`, create in default graph
- Otherwise, create in current active graph

### 5. Search Enhancement

**Enhanced Search**: When searching, show which graphs contain matches:

```
Search: "TSMC"
Results:
• TSMC (Personal Finance) - N55D928BF
• TSMC (Default) - NC53B0A1D
```

### 6. Manual Merge with Graph Preservation

**Merge Action**: When user merges nodes across graphs:

1. Keep both nodes (don't delete)
2. Create `CROSS_GRAPH_LINK` relationship
3. Add `cross_graph_instances` property to both nodes:
   ```json
   {
     "cross_graph_instances": [
       {"node_id": "N55D928BF", "graph_id": "G0F87FFD7"},
       {"node_id": "NC53B0A1D", "graph_id": "default"}
     ],
     "merged_at": "2024-01-20T12:00:00Z",
     "merged_by": "user_id"
   }
   ```
4. Show badge: "Merged with instance in [graph_name]"

## Implementation Plan

### Phase 1: Backend APIs
1. ✅ Create `get_cross_graph_instances()` function
2. ✅ Create `link_cross_graph_instances()` function  
3. ✅ Add `CROSS_GRAPH_LINK` relationship support
4. ✅ Enhance concept creation to support `add_to_global` flag

### Phase 2: Frontend Components
1. ✅ Create `CrossGraphInstancesPanel` component
2. ✅ Add to ContextPanel when viewing concepts
3. ✅ Add "Add to global" option in concept creation
4. ✅ Enhance search results to show graph context

### Phase 3: Chat Integration
1. ✅ Parse "add X to global" commands
2. ✅ Show cross-graph instances in chat responses
3. ✅ Add suggested actions: "View in [graph_name]"

### Phase 4: Navigation
1. ✅ Add graph switcher in concept view
2. ✅ Seamless transition when clicking "View in [graph]"
3. ✅ Breadcrumb showing current graph context

## Benefits

1. **Context Preservation**: Each graph maintains its own perspective on concepts
2. **Discovery**: Users can find related concepts across graphs
3. **Flexibility**: Choose to keep separate or link as needed
4. **Seamless UX**: Easy navigation between graph contexts
5. **Global Knowledge**: Explicit way to add to shared knowledge base

