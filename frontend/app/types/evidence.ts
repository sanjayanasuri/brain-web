/**
 * Evidence source types supported by Brain Web
 */
export type EvidenceSourceType =
  | 'browser_use'
  | 'upload'
  | 'notion'
  | 'voice_transcript_chunk'
  | 'quote'
  | 'source_chunk'
  | 'unknown';

import { AnchorRef } from './unified';

/**
 * Strict EvidenceItem contract for navigation and display
 * All fields are required for proper navigation except where marked optional
 */
export interface EvidenceItem {
  /** Stable unique identifier for this evidence item */
  id: string;

  /** Display title (optional) */
  title?: string;

  /** URL to the source (optional) */
  url?: string;

  /** Text snippet/preview (optional) */
  snippet?: string;

  /** Source type - required for filtering/display */
  source_type: EvidenceSourceType;

  /** ISO timestamp when evidence was created (optional) */
  created_at?: string;

  /** ISO timestamp when evidence was observed "as of" date (optional) */
  as_of?: string;

  /** Confidence score 0..1 (optional) */
  confidence?: number;

  /** Resource ID - REQUIRED for "View Resource" navigation */
  resource_id?: string;

  /** Concept ID - REQUIRED to auto-select node; if missing, allow fallback */
  concept_id?: string;

  /** Unified Anchor Reference (Phase C) */
  anchor?: AnchorRef;
}

/**
 * Normalize raw evidence payload from API into strict EvidenceItem[]
 * Handles various API response shapes defensively
 */
export function normalizeEvidence(raw: any): EvidenceItem[] {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];

  return raw.map((item: any, index: number): EvidenceItem => {
    // Generate stable ID: prefer existing id, then resource_id, then fallback
    const id = item.id || item.evidence_id || item.resource_id || `evidence-${index}`;

    // Normalize source_type from various possible fields
    const source = item.source || item.source_type || 'unknown';
    const source_type: EvidenceSourceType =
      ['browser_use', 'upload', 'notion', 'voice_transcript_chunk', 'quote', 'source_chunk'].includes(source)
        ? (source as EvidenceSourceType)
        : source === 'voice' ? 'voice_transcript_chunk' : 'unknown';

    // Normalize created_at - handle both string and number timestamps
    let created_at: string | undefined;
    if (item.created_at) {
      if (typeof item.created_at === 'string') {
        created_at = item.created_at;
      } else if (typeof item.created_at === 'number') {
        created_at = new Date(item.created_at).toISOString();
      }
    }

    // Normalize as_of - handle both string and number
    let as_of: string | undefined;
    if (item.as_of) {
      if (typeof item.as_of === 'string') {
        as_of = item.as_of;
      } else if (typeof item.as_of === 'number') {
        as_of = new Date(item.as_of).toISOString();
      }
    }

    // Normalize confidence - ensure it's 0..1
    let confidence: number | undefined;
    if (item.confidence !== undefined && item.confidence !== null) {
      const conf = typeof item.confidence === 'number'
        ? item.confidence
        : parseFloat(String(item.confidence));
      if (!isNaN(conf) && conf >= 0 && conf <= 1) {
        confidence = conf;
      }
    }

    return {
      id,
      title: item.title || undefined,
      url: item.url || undefined,
      snippet: item.snippet || undefined,
      source_type,
      created_at,
      as_of,
      confidence,
      resource_id: item.resource_id || undefined,
      concept_id: item.concept_id || undefined,
      anchor: item.anchor || undefined,
    };
  });
}
