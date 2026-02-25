export type ToolType = 'pen' | 'highlighter' | 'eraser' | 'text' | 'select' | 'drawingBox';

export interface FPoint {
  x: number;
  y: number;
  pressure: number;
}

export interface CanvasStroke {
  id: string;
  tool: ToolType;
  color: string;
  width: number;
  points: FPoint[];
  timestamp: number;
  canvasX: number;
  canvasY: number;
  canvasW: number;
  canvasH: number;
}

export interface TextBlock {
  id: string;
  text: string;
  x: number;
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
  viewX: number;
  viewY: number;
  zoom: number;
  order: number;
  createdAt: number;
}

/** Stroke inside a drawing block; points are in block-local coordinates (0..w, 0..h). */
export interface DrawingBlockStroke {
  tool: 'pen' | 'highlighter' | 'eraser';
  color: string;
  width: number;
  points: FPoint[];
  timestamp: number;
}

export interface DrawingBlock {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  strokes: DrawingBlockStroke[];
  timestamp: number;
}

export interface FreeformCanvasState {
  strokes: CanvasStroke[];
  textBlocks: TextBlock[];
  drawingBlocks: DrawingBlock[];
  phases: CanvasPhase[];
  viewX: number;
  viewY: number;
  zoom: number;
}
