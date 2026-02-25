'use client';

import { create } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';
import type { UseBoundStore } from 'zustand/react';
import {
  CanvasPhase,
  CanvasStroke,
  DrawingBlock,
  DrawingBlockStroke,
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
  addDrawingBlock: (block: Omit<DrawingBlock, 'id'>) => string;
  updateDrawingBlock: (id: string, patch: Partial<DrawingBlock>) => void;
  addStrokeToDrawingBlock: (blockId: string, stroke: DrawingBlockStroke) => void;
  removeStrokeFromDrawingBlock: (blockId: string, strokeIndex: number) => void;
  deleteDrawingBlock: (id: string) => void;
  addPhase: (label: string, viewX: number, viewY: number, zoom: number) => string;
  deletePhase: (id: string) => void;
  reorderPhase: (id: string, newOrder: number) => void;
  setView: (viewX: number, viewY: number, zoom: number) => void;
  undo: () => void;
  loadState: (state: Partial<FreeformCanvasState>) => void;
  getSerializedStrokes: () => string;
  getSerializedTextBlocks: () => string;
  getSerializedDrawingBlocks: () => string;
  getSerializedPhases: () => string;
}

type Snapshot = FreeformCanvasState;

export interface InternalStore extends FreeformCanvasStore {
  history: Snapshot[];
}

const MAX_HISTORY = 50;

const makeId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `id_${Math.random().toString(36).slice(2, 10)}`;

const cloneDrawingBlock = (b: DrawingBlock): DrawingBlock => ({
  ...b,
  strokes: b.strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) })),
});

const cloneSnapshot = (state: FreeformCanvasState): Snapshot => ({
  strokes: state.strokes.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) })),
  textBlocks: state.textBlocks.map((b) => ({ ...b })),
  drawingBlocks: state.drawingBlocks.map(cloneDrawingBlock),
  phases: state.phases.map((p) => ({ ...p })),
  viewX: state.viewX,
  viewY: state.viewY,
  zoom: state.zoom,
});

const selectSnapshot = (state: InternalStore): Snapshot => ({
  strokes: state.strokes,
  textBlocks: state.textBlocks,
  drawingBlocks: state.drawingBlocks,
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

export const useFreeformCanvasStore = create(
  (set: StoreApi<InternalStore>['setState'], get: StoreApi<InternalStore>['getState']) => ({
  strokes: [],
  textBlocks: [],
  drawingBlocks: [],
  phases: [],
  viewX: 0,
  viewY: 0,
  zoom: 1,
  history: [],

  addStroke: (stroke: Omit<CanvasStroke, 'id'>) => {
    const id = makeId();
    withHistory(set, (state: InternalStore) => ({
      strokes: [...state.strokes, { ...stroke, id }],
    }));
    return id;
  },

  deleteStroke: (id: string) => {
    withHistory(set, (state: InternalStore) => ({
      strokes: state.strokes.filter((s) => s.id !== id),
    }));
  },

  setStrokes: (strokes: CanvasStroke[]) => {
    withHistory(set, () => ({ strokes }));
  },

  addTextBlock: (block: Omit<TextBlock, 'id'>) => {
    const id = makeId();
    withHistory(set, (state: InternalStore) => ({
      textBlocks: [...state.textBlocks, { ...block, id }],
    }));
    return id;
  },

  updateTextBlock: (id: string, text: string) => {
    withHistory(set, (state: InternalStore) => ({
      textBlocks: state.textBlocks.map((b) => (b.id === id ? { ...b, text, isEditing: false } : b)),
    }));
  },

  patchTextBlock: (id: string, patch: Partial<TextBlock>) => {
    withHistory(set, (state: InternalStore) => ({
      textBlocks: state.textBlocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  },

  deleteTextBlock: (id: string) => {
    withHistory(set, (state: InternalStore) => ({
      textBlocks: state.textBlocks.filter((b) => b.id !== id),
    }));
  },

  addDrawingBlock: (block: Omit<DrawingBlock, 'id'>) => {
    const id = makeId();
    withHistory(set, (state: InternalStore) => ({
      drawingBlocks: [...state.drawingBlocks, { ...block, id, strokes: block.strokes ?? [] }],
    }));
    return id;
  },

  updateDrawingBlock: (id: string, patch: Partial<DrawingBlock>) => {
    set((state: InternalStore) => ({
      drawingBlocks: state.drawingBlocks.map((b: DrawingBlock) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  },

  addStrokeToDrawingBlock: (blockId: string, stroke: DrawingBlockStroke) => {
    withHistory(set, (state: InternalStore) => ({
      drawingBlocks: state.drawingBlocks.map((b: DrawingBlock) =>
        b.id === blockId ? { ...b, strokes: [...b.strokes, stroke] } : b,
      ),
    }));
  },

  removeStrokeFromDrawingBlock: (blockId: string, strokeIndex: number) => {
    withHistory(set, (state: InternalStore) => ({
      drawingBlocks: state.drawingBlocks.map((b: DrawingBlock) =>
        b.id === blockId
          ? { ...b, strokes: b.strokes.filter((_, i) => i !== strokeIndex) }
          : b,
      ),
    }));
  },

  deleteDrawingBlock: (id: string) => {
    withHistory(set, (state: InternalStore) => ({
      drawingBlocks: state.drawingBlocks.filter((b: DrawingBlock) => b.id !== id),
    }));
  },

  addPhase: (label: string, viewX: number, viewY: number, zoom: number) => {
    const id = makeId();
    withHistory(set, (state: InternalStore) => ({
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

  deletePhase: (id: string) => {
    withHistory(set, (state: InternalStore) => ({
      phases: state.phases
        .filter((p) => p.id !== id)
        .map((p, idx) => ({ ...p, order: idx })),
    }));
  },

  reorderPhase: (id: string, newOrder: number) => {
    withHistory(set, (state: InternalStore) => {
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

  setView: (viewX: number, viewY: number, zoom: number) => {
    set(() => ({ viewX, viewY, zoom }));
  },

  undo: () => {
    set((state: InternalStore) => {
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

  loadState: (incoming: Partial<FreeformCanvasState>) => {
    set(() => ({
      strokes: Array.isArray(incoming.strokes) ? incoming.strokes : [],
      textBlocks: Array.isArray(incoming.textBlocks) ? incoming.textBlocks : [],
      drawingBlocks: Array.isArray(incoming.drawingBlocks) ? incoming.drawingBlocks : [],
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
  getSerializedDrawingBlocks: () => JSON.stringify(get().drawingBlocks),
  getSerializedPhases: () => JSON.stringify(get().phases),
  }),
) as unknown as UseBoundStore<StoreApi<InternalStore>>;

export type { FreeformCanvasStore };
