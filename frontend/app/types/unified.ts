/**
 * Unified cross-modal primitives (frontend mirror of `backend/unified_primitives.py`).
 *
 * These are *adapters* that let us reference artifacts/anchors across:
 * - Neo4j graph objects (artifacts, quotes, lectures…)
 * - Postgres threads (contextual branches, voice sessions…)
 * - Events timeline (chat messages, captured sources…)
 *
 * Additive only: existing endpoints keep their current shapes.
 */

export type ArtifactNamespace = 'neo4j' | 'postgres' | 'events' | 'frontend';

export type ArtifactType =
  | 'artifact'
  | 'source_document'
  | 'quote'
  | 'claim'
  | 'concept'
  | 'lecture'
  | 'lecture_segment'
  | 'resource'
  | 'contextual_branch'
  | 'voice_session'
  | 'study_session'
  | 'chat_message'
  | 'voice_transcript_chunk';

export interface ArtifactRef {
  namespace: ArtifactNamespace;
  type: ArtifactType;
  id: string;
  version?: number | null;
  graph_id?: string | null;
  branch_id?: string | null;
}

export type AnchorSelector =
  | TextOffsetsSelector
  | TextQuoteSelector
  | BBoxSelector
  | TimeRangeSelector;

export interface TextOffsetsSelector {
  kind: 'text_offsets';
  start_offset: number;
  end_offset: number;
}

export interface TextQuoteSelector {
  kind: 'text_quote';
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface BBoxSelector {
  kind: 'bbox';
  x: number;
  y: number;
  w: number;
  h: number;
  unit: 'px' | 'pct';
  page?: number | null;
  image_width?: number | null;
  image_height?: number | null;
}

export interface TimeRangeSelector {
  kind: 'time_range';
  start_ms: number;
  end_ms: number;
}

export interface AnchorRef {
  anchor_id: string;
  artifact: ArtifactRef;
  selector: AnchorSelector;
  preview?: string | null;
}

