# Components Directory Structure

This directory contains all React components organized by their purpose and functionality.

## Directory Organization

### `/graph/` - Graph Visualization Components
Core components for displaying and interacting with the knowledge graph:
- **GraphVisualization.tsx** - Main graph visualization component with force-directed layout
- **GraphMiniMap.tsx** - Mini map overlay showing graph overview
- **ExplorerToolbar.tsx** - Toolbar with graph/branch controls, filters, and stats

### `/navigation/` - Navigation & Routing Components
Components for navigating through the application and content:
- **SessionDrawer.tsx** - Sidebar showing recent sessions and quick links
- **PathRunner.tsx** - Component for following and executing suggested learning paths
- **ContinueBlock.tsx** - Block showing continuation suggestions (resume paths, review items, etc.)

### `/ui/` - Reusable UI Components
General-purpose UI components used throughout the application:
- **QualityIndicators.tsx** - Quality badges and pills (coverage, freshness, graph health)
- **ReminderBanner.tsx** - Banner component for displaying reminders and notifications
- **StyleFeedbackForm.tsx** - Form for submitting style feedback on AI responses

### `/context/` - Context Panel Components
Components for the context panel that appears when a node is selected:
- **ContextPanel.tsx** - Main context panel with tabs (overview, evidence, notes, connections, activity, data)

### `/finance/` - Finance-Specific Components
Components related to finance tracking and snapshots:
- **TrackedCompaniesPanel.tsx** - Panel showing tracked companies with staleness indicators

### `/notion/` - Notion Integration Components
Components for managing Notion integration:
- **NotionSyncManager.tsx** - Manager for syncing and indexing Notion pages

### `/topbar/` - Top Navigation Bar
Top navigation bar components:
- **TopBar.tsx** - Main top bar with search and navigation
- **TopBarWrapper.tsx** - Wrapper that conditionally shows/hides TopBar based on route

### `/landing/` - Landing Page
Entry point components:
- **LandingPage.tsx** - Landing page shown on first visit

### `/context-providers/` - React Context Providers
React context providers for global state:
- **LensContext.tsx** - Context for managing lens/filter state (finance, general, etc.)
- **SidebarContext.tsx** - Context for managing sidebar open/closed state

## Import Patterns

When importing components, use the organized paths:

```typescript
// Graph components
import GraphVisualization from '../components/graph/GraphVisualization';
import GraphMiniMap from '../components/graph/GraphMiniMap';

// Navigation components
import SessionDrawer from '../components/navigation/SessionDrawer';
import PathRunner from '../components/navigation/PathRunner';

// UI components
import { GraphHealthBadge } from '../components/ui/QualityIndicators';
import ReminderBanner from '../components/ui/ReminderBanner';

// Context providers
import { useLens } from '../components/context-providers/LensContext';
```

## Adding New Components

When adding new components:
1. Place them in the appropriate subdirectory based on their purpose
2. If a component doesn't fit existing categories, consider creating a new subdirectory
3. Update this README if adding a new category
4. Follow the existing naming conventions (PascalCase for component files)

