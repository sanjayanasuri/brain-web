/**
 * Finance Domain Plugin
 * 
 * Provides finance-specific functionality (ticker extraction, tracking, etc.)
 * without hardcoding finance logic in the core system.
 */

'use client';

import type { DomainPlugin, DomainState, DomainActions } from './types';
import type { Concept } from '../../../api-client';
import { useFinanceState } from '../hooks/useFinanceState';
import { getFinanceTracking, type FinanceTrackingConfig } from '../../../api-client';
import { registerFinancePlugin } from './pluginRegistry';

/**
 * Extract ticker identifier from a finance concept
 */
function extractTicker(concept: Concept): string | null {
  // Check if node has ticker property
  if ((concept as any).ticker) {
    return (concept as any).ticker;
  }
  // Check if node name contains ticker in parentheses: "Company Name (TICKER)"
  const match = concept.name.match(/\(([A-Z]{1,5})\)$/);
  if (match) {
    return match[1];
  }
  // Check tags for ticker:xxx
  if (concept.tags) {
    const tickerTag = concept.tags.find(t => t.startsWith('ticker:'));
    if (tickerTag) {
      return tickerTag.split(':')[1];
    }
  }
  return null;
}

/**
 * Check if a concept is finance-related
 */
function isFinanceRelevant(concept: Concept): boolean {
  const domain = concept.domain?.toLowerCase() || '';
  if (domain.includes('finance') || domain.includes('financial')) {
    return true;
  }
  // Check if it has a ticker
  if (extractTicker(concept)) {
    return true;
  }
  // Check tags
  if (concept.tags?.some(t => t.toLowerCase().includes('ticker') || t.toLowerCase().includes('stock'))) {
    return true;
  }
  return false;
}

export const financePlugin: DomainPlugin = {
  id: 'finance',
  name: 'Finance',
  
  extractIdentifier: (concept) => {
    return extractTicker(concept as Concept);
  },
  
  getTrackingConfig: async (identifier: string) => {
    return await getFinanceTracking(identifier);
  },
  
  isRelevant: (concept) => {
    return isFinanceRelevant(concept as Concept);
  },
  
  getNodePanelTabs: () => {
    return ['overview', 'resources', 'evidence', 'finance', 'confusions'];
  },
  
  getResourceTypes: () => {
    return ['SEC', 'IR', 'NEWS'];
  },
  
  useDomainState: () => {
    const finance = useFinanceState();
    
    // Map finance state to generic domain state interface
    const domainState: DomainState = {
      enabled: finance.state.financeLensEnabled,
      selectedIdentifier: finance.state.selectedTicker,
      lens: finance.state.financeLens,
      tracking: finance.state.financeTracking,
      isLoadingTracking: finance.state.isLoadingTracking,
      isFetchingData: finance.state.isFetchingSnapshot,
      trackedIdentifiers: finance.state.trackedTickers,
      trackedItemsList: finance.state.trackedCompaniesList,
      latestData: finance.state.latestSnapshots,
      refreshingIdentifiers: finance.state.refreshingTickers,
      selectedResourceId: finance.state.financeSelectedResourceId,
      showAllItems: finance.state.showAllNews,
    };
    
    const domainActions: DomainActions = {
      setEnabled: finance.actions.setFinanceLensEnabled,
      setSelectedIdentifier: finance.actions.setSelectedTicker,
      setLens: finance.actions.setFinanceLens,
      setTracking: finance.actions.setFinanceTracking,
      setLoadingTracking: finance.actions.setLoadingTracking,
      setFetchingData: finance.actions.setFetchingSnapshot,
      setTrackedIdentifiers: finance.actions.setTrackedTickers,
      addTrackedIdentifier: finance.actions.addTrackedTicker,
      removeTrackedIdentifier: finance.actions.removeTrackedTicker,
      setTrackedItemsList: finance.actions.setTrackedCompaniesList,
      setLatestData: finance.actions.setLatestSnapshots,
      updateData: (identifier: string, data: any) => {
        finance.actions.updateSnapshot(identifier, data);
      },
      setRefreshingIdentifiers: finance.actions.setRefreshingTickers,
      addRefreshingIdentifier: finance.actions.addRefreshingTicker,
      removeRefreshingIdentifier: finance.actions.removeRefreshingTicker,
      setSelectedResourceId: finance.actions.setFinanceSelectedResourceId,
      setShowAllItems: finance.actions.setShowAllNews,
    };
    
    return { state: domainState, actions: domainActions };
  },
};

// Register the plugin
registerFinancePlugin(financePlugin);

