/**
 * Saved items management (localStorage-based)
 */

export type SavedItemKind = 'SUGGESTION' | 'PATH' | 'CONCEPT';

export interface SavedItem {
  id: string;
  kind: SavedItemKind;
  title: string;
  graph_id?: string;
  concept_id?: string;
  suggestion_id?: string;
  path_id?: string;
  created_at: string; // ISO string
}

const STORAGE_KEY = 'brainweb:saved_items';

/**
 * Get all saved items
 */
export function getSavedItems(): SavedItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

/**
 * Save an item
 */
export function saveItem(item: Omit<SavedItem, 'id' | 'created_at'>): SavedItem {
  const savedItems = getSavedItems();
  const newItem: SavedItem = {
    ...item,
    id: `${item.kind}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    created_at: new Date().toISOString(),
  };
  savedItems.push(newItem);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(savedItems));
  return newItem;
}

/**
 * Remove a saved item by ID
 */
export function removeSavedItem(id: string): void {
  const savedItems = getSavedItems();
  const filtered = savedItems.filter(item => item.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
}

/**
 * Check if an item is saved (by kind and relevant ID)
 */
export function isItemSaved(kind: SavedItemKind, id: string): boolean {
  const savedItems = getSavedItems();
  return savedItems.some(item => {
    if (item.kind !== kind) return false;
    switch (kind) {
      case 'SUGGESTION':
        return item.suggestion_id === id;
      case 'PATH':
        return item.path_id === id;
      case 'CONCEPT':
        return item.concept_id === id;
      default: {
        const _: never = kind;
        return false;
      }
    }
  });
}

/**
 * Get saved item by kind and ID
 */
export function getSavedItem(kind: SavedItemKind, id: string): SavedItem | null {
  const savedItems = getSavedItems();
  return savedItems.find(item => {
    if (item.kind !== kind) return false;
    switch (kind) {
      case 'SUGGESTION':
        return item.suggestion_id === id;
      case 'PATH':
        return item.path_id === id;
      case 'CONCEPT':
        return item.concept_id === id;
      default: {
        const _: never = kind;
        return false;
      }
    }
  }) || null;
}

/**
 * Get saved items grouped by kind
 */
export function getSavedItemsByKind(): Record<SavedItemKind, SavedItem[]> {
  const items = getSavedItems();
  return {
    SUGGESTION: items.filter(i => i.kind === 'SUGGESTION'),
    PATH: items.filter(i => i.kind === 'PATH'),
    CONCEPT: items.filter(i => i.kind === 'CONCEPT'),
  };
}

