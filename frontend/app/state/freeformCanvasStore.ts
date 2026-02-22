'use client';

import { create } from 'zustand';
import {
  CanvasPhase,
  CanvasStroke,
  FreeformCanvasState,
  TextBlock,
} from '../types/freeform-canvas';

interface FreeformCanvasStore extends FreeformCanvasState {
  addStroke: (stroke: Omit<CanvasStroke, 'id'>) => string;
  deleteStroke: (id: string) => void;
  setStrokes: (strokes: CanvasStroke[]) => void;
  addTextBlock: (block: Omit<TextBlock, 'id'>) => string;
  updateTextBlock: (id: string, text: string) => void;
  patchTextBlock: (id: string, patch: Partial<TextBlock>) => void;
  deleteTextBlock: (id: string) => void;
  addPhase: (label: string, viewX: number, viewY: number, zoom: number) => string;
  deletePhase: (id: string) => void;
  reorderPhase: (id: string, newOrder: number) => void;
  setView: (viewX: number, viewY: number, zoom: number) => void;
  undo: () => void;
  loadState: (state: Partial<FreeformCanvasState>) => void;
  getSerializedStrokes: () => string;
  getSerializedTextBlocks: () => string;
  getSerializedPhases: () => string;
}

type Snapshot = FreeformCanvasState;

interface InternalStore extends FreeformCanvasStore {
  history: Snapshot[];
}

const MAX_HISTORY = 50;

const makeId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id_${Math.random().toString(36).slice(2, 10)}`;

const cloneSnapshot = (state: FreeformCanvasState): Snapshot => ({
  strokes: state.strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) })),
  textBlocks: state.textBlocks.map((b) => ({ ...b })),
  phases: state.phases.map((p) => ({ ...p })),
  viewX: state.viewX,
  viewY: state.viewY,
  zoom: state.zoom,
});

const selectSnapshot = (state: InternalStore): Snapshot => ({
  strokes: state.strokes,
  textBlocks: state.textBlocks,
  phases: state.phases,
  viewX: state.viewX,
  viewY: state.viewY,
  zoom: state.zoom,
});

const withHistory = (
  set: (fn: (state: InternalStore) => Partial<InternalStore>) => void,
  updater: (state: InternalStore) => Partial<InternalStore>,
) => {
  set((state) => {
    const history = [...state.history, cloneSnapshot(selectSnapshot(state))].slice(-MAX_HISTORY);
    return {
      history,
      ...updater(state),
    };
  });
};

export const useFreeformCanvasStore = create<InternalStore>((set, get) => ({
  strokes: [],
  textBlocks: [],
  phases: [],
  viewX: 0,
  viewY: 0,
  zoom: 1,
  history: [],

  addStroke: (stroke) => {
    const id = makeId();
    withHistory(set, (state) => ({
      strokes: [...state.strokes, { ...stroke, id }],
    }));
    return id;
  },

  deleteStroke: (id) => {
    withHistory(set, (state) => ({
      strokes: state.strokes.filter((s) => s.id !== id),
    }));
  },

  setStrokes: (strokes) => {
    withHistory(set, () => ({ strokes }));
  },

  addTextBlock: (block) => {
    const id = makeId();
    withHistory(set, (state) => ({
      textBlocks: [...state.textBlocks, { ...block, id }],
    }));
    return id;
  },

  updateTextBlock: (id, text) => {
    withHistory(set, (state) => ({
      textBlocks: state.textBlocks.map((b) => (b.id === id ? { ...b, text, isEditing: false } : b)),
    }));
  },

  patchTextBlock: (id, patch) => {
    withHistory(set, (state) => ({
      textBlocks: state.textBlocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  },

  deleteTextBlock: (id) => {
    withHistory(set, (state) => ({
      textBlocks: state.textBlocks.filter((b) => b.id !== id),
    }));
  },

  addPhase: (label, viewX, viewY, zoom) => {
    const id = makeId();
    withHistory(set, (state) => ({
      phases: [
        ...state.phases,
        {
          id,
          label: label.trim() || `Phase ${state.phases.length + 1}`,
          viewX,
          viewY,
          zoom,
          order: state.phases.length,
          createdAt: Date.now(),
        } as CanvasPhase,
      ],
    }));
    return id;
  },

  deletePhase: (id) => {
    withHistory(set, (state) => ({
      phases: state.phases
        .filter((p) => p.id !== id)
        .map((p, idx) => ({ ...p, order: idx })),
    }));
  },

  reorderPhase: (id, newOrder) => {
    withHistory(set, (state) => {
      const ordered = [...state.phases].sort((a, b) => a.order - b.order);
      const currentIndex = ordered.findIndex((p) => p.id === id);
      if (currentIndex < 0) {
        return {};
      }
      const clampedIndex = Math.max(0, Math.min(newOrder, ordered.length - 1));
      const [item] = ordered.splice(currentIndex, 1);
      ordered.splice(clampedIndex, 0, item);
      return {
        phases: ordered.map((p, idx) => ({ ...p, order: idx })),
      };
    });
  },

  setView: (viewX, viewY, zoom) => {
    set(() => ({ viewX, viewY, zoom }));
  },

  undo: () => {
    set((state) => {
      if (!state.history.length) {
        return {};
      }
      const history = [...state.history];
      const previous = history.pop()!;
      return {
        history,
        ...cloneSnapshot(previous),
      };
    });
  },

  loadState: (incoming) => {
    set(() => ({
      strokes: Array.isArray(incoming.strokes) ? incoming.strokes : [],
      textBlocks: Array.isArray(incoming.textBlocks) ? incoming.textBlocks : [],
      phases: Array.isArray(incoming.phases)
        ? [...incoming.phases].map((p, idx) => ({ ...p, order: typeof p.order === 'number' ? p.order : idx }))
        : [],
      viewX: typeof incoming.viewX === 'number' ? incoming.viewX : 0,
      viewY: typeof incoming.viewY === 'number' ? incoming.viewY : 0,
      zoom: typeof incoming.zoom === 'number' ? incoming.zoom : 1,
      history: [],
    }));
  },

  getSerializedStrokes: () => JSON.stringify(get().strokes),
  getSerializedTextBlocks: () => JSON.stringify(get().textBlocks),
  getSerializedPhases: () => JSON.stringify(get().phases),
}));

export type { FreeformCanvasStore };
