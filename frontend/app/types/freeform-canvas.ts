export type ToolType = 'pen' | 'highlighter' | 'eraser' | 'text' | 'select';

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

export interface FreeformCanvasState {
  strokes: CanvasStroke[];
  textBlocks: TextBlock[];
  phases: CanvasPhase[];
  viewX: number;
  viewY: number;
  zoom: number;
}
