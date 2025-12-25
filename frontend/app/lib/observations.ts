/**
 * Generate system observations about concepts based on their state.
 * Observations are pattern-based, personal, and slightly surprising.
 */

import type { ConceptQuality, Concept } from '../api-client';

export interface ConceptObservation {
  text: string;
  type: 'pattern' | 'assumption' | 'clustering' | 'divergence' | 'recurrence';
}

/**
 * Generate a primary observation for a concept based on its quality metrics
 */
export function generateConceptObservation(
  concept: Concept,
  quality: ConceptQuality | null,
  evidenceCount: number,
  neighborCount: number
): ConceptObservation | null {
  if (!quality) return null;

  const { coverage_breakdown, coverage_score, freshness } = quality;
  const { has_description, evidence_count, degree } = coverage_breakdown;

  // Pattern: Frequently referenced but rarely explained
  if (!has_description && evidence_count > 0 && degree >= 3) {
    return {
      text: `You've been referencing ${concept.name} a lot, but haven't explored it directly yet. Want to dive deeper?`,
      type: 'recurrence',
    };
  }

  // Pattern: Assumed rather than explained
  if (!has_description && degree >= 2) {
    return {
      text: `You've been working with ${concept.name} recently. Want to add your own explanation?`,
      type: 'assumption',
    };
  }

  // Pattern: Bridge concept
  if (degree >= 5 && evidence_count >= 2 && !has_description) {
    return {
      text: `${concept.name} connects several areas you've been exploring. Want to see how they relate?`,
      type: 'clustering',
    };
  }

  // Pattern: High connectivity, low evidence
  if (degree >= 5 && evidence_count <= 1) {
    return {
      text: `${concept.name} seems important to your work, but you haven't added much evidence yet.`,
      type: 'pattern',
    };
  }

  // Pattern: Evidence without context
  if (evidence_count >= 2 && !has_description && degree <= 2) {
    return {
      text: `You've gathered some evidence around ${concept.name}. Want to add your own take on it?`,
      type: 'pattern',
    };
  }

  // Pattern: Stale evidence
  if (freshness.level === 'Stale' && evidence_count > 0) {
    return {
      text: `You looked into ${concept.name} a while back. Want to refresh your understanding?`,
      type: 'pattern',
    };
  }

  // Pattern: Isolated concept
  if (degree <= 1 && evidence_count === 0 && !has_description) {
    return {
      text: `${concept.name} is in your graph but hasn't connected to your other ideas yet.`,
      type: 'divergence',
    };
  }

  // Default: Low coverage observation
  if (coverage_score < 50) {
    if (!has_description && evidence_count === 0) {
      return {
        text: `You've mentioned ${concept.name} but haven't explored it yet. Want to learn more?`,
        type: 'assumption',
      };
    }
  }

  return null;
}

/**
 * Generate observation text for gaps
 */
export function generateGapObservation(
  gapName: string,
  gapType: string,
  domain?: string
): string {
  switch (gapType) {
    case 'missing_description':
      return `"${gapName}" appears without an anchor in your graph. It's referenced but lacks a clear definition.`;
    
    case 'low_connectivity':
      return `"${gapName}" is loosely connected to nearby ideas. It could benefit from stronger connections to related concepts.`;
    
    case 'high_interest_low_coverage':
      return `A bridge is forming near "${gapName}". This area is gaining attention but needs more exploration.`;
    
    default:
      return `"${gapName}" appears in your graph but remains underexplored.`;
  }
}

/**
 * Generate observation text for suggestions
 */
export function generateSuggestionObservation(
  suggestionType: string,
  conceptName: string,
  rationale?: string
): string {
  switch (suggestionType) {
    case 'GAP_DEFINE':
      return `You've been referencing ${conceptName} a lot lately. Want to dive deeper into what it means?`;
    
    case 'GAP_EVIDENCE':
      return `You've been exploring ${conceptName} recently. Want to add some examples or sources?`;
    
    case 'COVERAGE_LOW':
      return `You've mentioned ${conceptName} in several places, but haven't explored it directly yet.`;
    
    case 'EVIDENCE_STALE':
      return `You looked into ${conceptName} a while back. Want to refresh your understanding?`;
    
    case 'REVIEW_RELATIONSHIPS':
      return `There are some connections around ${conceptName} that might need your attention.`;
    
    default:
      return rationale || `Something to notice about ${conceptName}.`;
  }
}

