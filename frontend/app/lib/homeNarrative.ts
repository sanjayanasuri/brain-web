/**
 * Narrative model and label dictionary for Home page
 * 
 * This centralizes UI copy to ensure consistent, neutral language
 * across the Home page narrative scroll.
 */

import { generateGapObservation, generateSuggestionObservation } from './observations';

export type NarrativeSection = 'resume' | 'takingShape' | 'unsettled' | 'background';

export interface NarrativeAction {
  label: string;
  href: string;
}

export interface NarrativeItem {
  id: string;
  section: NarrativeSection;
  title: string;
  description: string;
  tag?: string;
  primaryAction: NarrativeAction;
  secondaryAction?: NarrativeAction;
  // Optional metadata for ranking
  recencyWeight?: number;
  mentionFrequency?: number;
  centralityDelta?: number;
}

/**
 * CTA Labels - Narrative language, not task language
 */
export const CTA = {
  EXPLORE: 'Explore',
  ASK_WHY: 'Ask why',
  VIEW_INTERSECTIONS: 'View intersections',
  EXPLORE_BRIDGE: 'Explore bridge',
  SEE_USAGE_CONTEXT: 'See usage context',
  EXPLORE_NEARBY: 'Explore nearby concepts',
  CONTINUE_THINKING: 'Continue thinking',
  VIEW_NEIGHBORS: 'View neighbors',
} as const;

/**
 * Neutral Tags - No task language
 */
export const TAG = {
  CONTEXT_LIGHT: 'Context-light',
  LOOSELY_GROUNDED: 'Loosely grounded',
  UNDEREXPLORED: 'Underexplored',
  EMERGING: 'Emerging',
} as const;

/**
 * Section Titles
 */
export const SECTION_TITLE = {
  WHERE_YOU_LEFT_OFF: 'Where you left off',
  WHATS_TAKING_SHAPE: "What's taking shape",
  UNSETTLED_AREAS: 'Unsettled areas',
  QUIET_BACKGROUND: 'Quiet background changes',
} as const;

/**
 * Build explorer URL with view param
 */
export function buildExplorerUrl(params: {
  conceptId?: string;
  graphId?: string;
  view?: 'overview' | 'usage' | 'neighbors' | 'bridges' | 'compare';
  chat?: string;
}): string {
  const queryParams = new URLSearchParams();
  if (params.conceptId) {
    queryParams.set('select', params.conceptId);
  }
  if (params.graphId) {
    queryParams.set('graph_id', params.graphId);
  }
  if (params.view) {
    queryParams.set('view', params.view);
  }
  if (params.chat) {
    queryParams.set('chat', params.chat);
  }
  const queryString = queryParams.toString();
  return `/${queryString ? `?${queryString}` : ''}`;
}

/**
 * Calculate narrative score for ranking
 * Higher score = more prominent placement
 */
export function calculateNarrativeScore(item: NarrativeItem): number {
  const recency = item.recencyWeight ?? 0;
  const mentions = item.mentionFrequency ?? 0;
  const centrality = item.centralityDelta ?? 0;
  
  // TODO: Tune these weights based on actual metrics
  return recency * 0.4 + mentions * 0.3 + centrality * 0.3;
}

/**
 * Map gap type to narrative framing
 */
export function mapGapToNarrative(
  gap: { node_id: string; name: string; type: string; domain?: string }
): Omit<NarrativeItem, 'id' | 'section' | 'recencyWeight' | 'mentionFrequency' | 'centralityDelta'> {
  const observation = generateGapObservation(gap.name, gap.type, gap.domain);
  
  switch (gap.type) {
    case 'missing_description':
      return {
        section: 'unsettled',
        title: observation,
        description: '',
        tag: TAG.CONTEXT_LIGHT,
        primaryAction: {
          label: CTA.SEE_USAGE_CONTEXT,
          href: buildExplorerUrl({ conceptId: gap.node_id, view: 'usage' }),
        },
        secondaryAction: {
          label: CTA.ASK_WHY,
          href: buildExplorerUrl({ conceptId: gap.node_id, chat: `Help me understand ${gap.name}.` }),
        },
      };
    
    case 'low_connectivity':
      return {
        section: 'unsettled',
        title: observation,
        description: '',
        tag: TAG.LOOSELY_GROUNDED,
        primaryAction: {
          label: CTA.EXPLORE_NEARBY,
          href: buildExplorerUrl({ conceptId: gap.node_id, view: 'neighbors' }),
        },
      };
    
    case 'high_interest_low_coverage':
      return {
        section: 'takingShape',
        title: observation,
        description: '',
        tag: TAG.UNDEREXPLORED,
        primaryAction: {
          label: CTA.EXPLORE_BRIDGE,
          href: buildExplorerUrl({ conceptId: gap.node_id, view: 'bridges' }),
        },
        secondaryAction: {
          label: CTA.VIEW_INTERSECTIONS,
          href: buildExplorerUrl({ conceptId: gap.node_id, view: 'compare' }),
        },
      };
    
    default:
      return {
        section: 'unsettled',
        title: observation,
        description: '',
        tag: TAG.UNDEREXPLORED,
        primaryAction: {
          label: CTA.EXPLORE,
          href: buildExplorerUrl({ conceptId: gap.node_id }),
        },
      };
  }
}

/**
 * Map suggestion to narrative framing
 */
export function mapSuggestionToNarrative(
  suggestion: {
    id: string;
    title: string;
    explanation?: string;
    rationale?: string;
    concept_id?: string;
    concept_name?: string;
    graph_id?: string;
    type?: string;
  }
): Omit<NarrativeItem, 'recencyWeight' | 'mentionFrequency' | 'centralityDelta'> {
  const conceptId = suggestion.concept_id;
  const conceptName = suggestion.concept_name || suggestion.title.split('"')[1] || '';
  
  // Generate observational title
  const observationTitle = conceptName && suggestion.type
    ? generateSuggestionObservation(suggestion.type, conceptName, suggestion.rationale)
    : suggestion.title;
  
  // Determine section based on suggestion type
  let section: NarrativeSection = 'takingShape';
  let tag: string | undefined;
  let primaryLabel = CTA.EXPLORE;
  
  if (suggestion.type?.startsWith('GAP_')) {
    section = 'takingShape';
    tag = TAG.CONTEXT_LIGHT;
    primaryLabel = CTA.SEE_USAGE_CONTEXT;
  } else if (suggestion.type === 'REVIEW_RELATIONSHIPS') {
    section = 'takingShape';
    primaryLabel = CTA.VIEW_INTERSECTIONS;
  } else if (suggestion.type === 'COVERAGE_LOW' || suggestion.type === 'EVIDENCE_STALE') {
    section = 'unsettled';
    tag = TAG.UNDEREXPLORED;
  }
  
  return {
    id: suggestion.id,
    section,
    title: observationTitle,
    description: '',
    tag,
    primaryAction: {
      label: primaryLabel,
      href: conceptId
        ? buildExplorerUrl({ conceptId, graphId: suggestion.graph_id })
        : buildExplorerUrl({ graphId: suggestion.graph_id }),
    },
  };
}

