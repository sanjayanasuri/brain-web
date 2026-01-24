/**
 * Concept Navigation History
 * Tracks the sequence of concepts a user has visited to build semantic paths
 * like "Machine Learning -> NLP -> Transformers"
 */

export interface ConceptNavigationEntry {
  node_id: string;
  name: string;
  timestamp: number;
  relationship?: string; // The relationship type that led to this concept
  from_node_id?: string; // The previous concept in the path
}

const NAVIGATION_HISTORY_KEY = 'brainweb:concept-navigation-history';
const MAX_HISTORY_LENGTH = 20;

/**
 * Add a concept to the navigation history
 */
export function addConceptToHistory(
  nodeId: string,
  name: string,
  relationship?: string,
  fromNodeId?: string
): void {
  if (typeof window === 'undefined') return;

  try {
    const history = getConceptHistory();
    
    // Remove if already exists (to avoid duplicates)
    const filtered = history.filter(entry => entry.node_id !== nodeId);
    
    // Add new entry
    const newEntry: ConceptNavigationEntry = {
      node_id: nodeId,
      name,
      timestamp: Date.now(),
      relationship,
      from_node_id: fromNodeId,
    };
    
    // Keep only the last MAX_HISTORY_LENGTH entries
    const updated = [...filtered, newEntry].slice(-MAX_HISTORY_LENGTH);
    
    localStorage.setItem(NAVIGATION_HISTORY_KEY, JSON.stringify(updated));
  } catch (error) {
    console.warn('Failed to save concept navigation history:', error);
  }
}

/**
 * Get the full navigation history
 */
export function getConceptHistory(): ConceptNavigationEntry[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = localStorage.getItem(NAVIGATION_HISTORY_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

/**
 * Get the semantic path leading to the current concept
 * Returns an array of concept names forming a path like ["Machine Learning", "NLP", "Transformers"]
 */
export function getSemanticPath(currentNodeId: string, maxLength: number = 5): string[] {
  const history = getConceptHistory();
  
  if (history.length === 0) return [];
  
  // Find the current concept in history
  const currentIndex = history.findIndex(entry => entry.node_id === currentNodeId);
  if (currentIndex === -1) return [];
  
  // Build path backwards from current concept
  const path: string[] = [];
  let currentEntry = history[currentIndex];
  
  // Add current concept
  path.unshift(currentEntry.name);
  
  // Trace back through relationships
  let remaining = maxLength - 1;
  while (remaining > 0 && currentEntry.from_node_id) {
    const prevEntry = history.find(e => e.node_id === currentEntry.from_node_id);
    if (!prevEntry) break;
    
    path.unshift(prevEntry.name);
    currentEntry = prevEntry;
    remaining--;
  }
  
  return path;
}

/**
 * Get the recent navigation path (last N concepts visited)
 */
export function getRecentPath(maxLength: number = 5): ConceptNavigationEntry[] {
  const history = getConceptHistory();
  return history.slice(-maxLength);
}

/**
 * Clear navigation history
 */
export function clearConceptHistory(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(NAVIGATION_HISTORY_KEY);
}

/**
 * Get the relationship path as a string
 * e.g., "Machine Learning → NLP → Transformers"
 */
export function getSemanticPathString(currentNodeId: string, maxLength: number = 5): string {
  const path = getSemanticPath(currentNodeId, maxLength);
  if (path.length === 0) return '';
  return path.join(' → ');
}
