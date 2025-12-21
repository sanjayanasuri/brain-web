import { useCallback } from 'react';
import type { EvidenceItem } from '../types/evidence';

export interface UseEvidenceNavigationParams {
  /** Function to select a concept by ID - should result in node panel context for that node */
  selectConceptById: (id: string) => Promise<void> | void;
  
  /** Function to open the node panel */
  openNodePanel: () => void;
  
  /** Function to set the active tab in node panel */
  setNodePanelTab: (tab: 'Overview' | 'Evidence' | 'Activity' | 'Finance') => void;
  
  /** Optional function to ensure resources are loaded for a concept before scrolling */
  ensureResourcesLoadedForConcept?: (conceptId: string) => Promise<void>;
}

export interface UseEvidenceNavigationReturn {
  /** Navigate to a specific evidence resource */
  navigateToResource: (evidenceItem: EvidenceItem) => Promise<void>;
}

/**
 * Hook for navigating to evidence resources in the node panel
 * 
 * This hook provides a single, reliable pathway for "View Resource" navigation:
 * 1. Selects the concept/node if concept_id is provided
 * 2. Opens the node panel
 * 3. Switches to Evidence tab
 * 4. Scrolls to the specific resource card
 * 5. Briefly highlights the resource card
 */
export function useEvidenceNavigation(
  params: UseEvidenceNavigationParams
): UseEvidenceNavigationReturn {
  const {
    selectConceptById,
    openNodePanel,
    setNodePanelTab,
    ensureResourcesLoadedForConcept,
  } = params;

  const navigateToResource = useCallback(
    async (evidenceItem: EvidenceItem) => {
      // Step 1: Select concept if concept_id is provided
      if (evidenceItem.concept_id) {
        try {
          await selectConceptById(evidenceItem.concept_id);
        } catch (error) {
          console.warn('[EvidenceNavigation] Failed to select concept:', error);
          // Continue anyway - user might already have the node selected
        }
      } else {
        console.warn(
          '[EvidenceNavigation] EvidenceItem missing concept_id. Navigation may not work correctly.',
          evidenceItem
        );
      }

      // Step 2: Open node panel and switch to Evidence tab
      openNodePanel();
      setNodePanelTab('Evidence');

      // Step 3: Ensure resources are loaded if function provided
      if (evidenceItem.concept_id && ensureResourcesLoadedForConcept) {
        try {
          await ensureResourcesLoadedForConcept(evidenceItem.concept_id);
        } catch (error) {
          console.warn('[EvidenceNavigation] Failed to load resources:', error);
          // Continue anyway - resources might already be loaded
        }
      }

      // Step 4: Scroll to resource if resource_id is provided
      if (evidenceItem.resource_id) {
        // Wait for DOM element with retry loop
        const maxAttempts = 10;
        const delayMs = 100;
        let attempts = 0;

        const tryScroll = () => {
          attempts++;
          const elementId = `resource-${evidenceItem.resource_id}`;
          const element = document.getElementById(elementId);

          if (element) {
            // Scroll into view
            element.scrollIntoView({
              behavior: 'smooth',
              block: 'center',
            });

            // Step 5: Add pulse highlight
            element.classList.add('pulse-highlight');
            setTimeout(() => {
              element.classList.remove('pulse-highlight');
            }, 1200);
          } else if (attempts < maxAttempts) {
            // Retry after delay
            setTimeout(tryScroll, delayMs);
          } else {
            console.warn(
              `[EvidenceNavigation] Resource element not found after ${maxAttempts} attempts:`,
              elementId
            );
          }
        };

        // Start trying after a short delay to allow DOM to update
        setTimeout(tryScroll, 200);
      } else {
        console.warn(
          '[EvidenceNavigation] EvidenceItem missing resource_id. Cannot scroll to resource.',
          evidenceItem
        );
      }
    },
    [selectConceptById, openNodePanel, setNodePanelTab, ensureResourcesLoadedForConcept]
  );

  return { navigateToResource };
}

