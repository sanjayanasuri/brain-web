/**
 * Lecture Domain Plugin
 * 
 * Provides lecture/learning-specific functionality (content ingestion, etc.)
 * without hardcoding lecture logic in the core system.
 */

'use client';

import type { DomainPlugin } from './types';
import type { Concept } from '../../../api-client';
import { ingestLecture, type LectureIngestResult } from '../../../api-client';
import { registerLecturePlugin } from './pluginRegistry';

/**
 * Check if a concept is lecture/learning-related
 */
function isLectureRelevant(concept: Concept): boolean {
  const domain = concept.domain?.toLowerCase() || '';
  if (domain.includes('lecture') || domain.includes('learning') || domain.includes('education')) {
    return true;
  }
  // Check if it has lecture_key or lecture_sources
  if (concept.lecture_key || concept.lecture_sources?.length) {
    return true;
  }
  // Check tags
  if (concept.tags?.some(t => t.toLowerCase().includes('lecture') || t.toLowerCase().includes('course'))) {
    return true;
  }
  return false;
}

export const lecturePlugin: DomainPlugin = {
  id: 'lecture',
  name: 'Lecture',
  
  isRelevant: (concept) => {
    return isLectureRelevant(concept as Concept);
  },
  
  getNodePanelTabs: () => {
    return ['overview', 'resources', 'evidence', 'confusions'];
  },
  
  handleIngestion: async (graphId: string, title: string, text: string, domain?: string) => {
    return await ingestLecture(graphId, title, text, domain);
  },
};

// Register the plugin
registerLecturePlugin(lecturePlugin);

