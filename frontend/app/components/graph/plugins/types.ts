/**
 * Domain Plugin System - General-purpose architecture for domain-specific features
 * 
 * This allows the system to be extended with domain-specific functionality
 * (finance, lecture, etc.) without hardcoding domain logic in the core.
 */

export interface DomainPlugin {
  /** Unique identifier for this domain plugin */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Extract domain-specific identifier from a concept (e.g., ticker from finance concept) */
  extractIdentifier?(concept: { name: string; domain?: string; tags?: string[] | null; [key: string]: any }): string | null;
  
  /** Get domain-specific tracking/config for a concept */
  getTrackingConfig?(identifier: string): Promise<any>;
  
  /** Check if a concept is relevant to this domain */
  isRelevant?(concept: { name: string; domain?: string; tags?: string[] | null; [key: string]: any }): boolean;
  
  /** Get domain-specific tabs for the node panel */
  getNodePanelTabs?(): string[];
  
  /** Get domain-specific resource types */
  getResourceTypes?(): string[];
  
  /** Handle domain-specific ingestion */
  handleIngestion?(graphId: string, title: string, text: string, domain?: string): Promise<any>;
  
  /** Get domain-specific state management */
  useDomainState?(): { state: any; actions: any };
}

export interface DomainState {
  enabled: boolean;
  selectedIdentifier: string;
  lens: string;
  tracking: any | null;
  isLoadingTracking: boolean;
  isFetchingData: boolean;
  trackedIdentifiers: Set<string>;
  trackedItemsList: any[];
  latestData: Record<string, any>;
  refreshingIdentifiers: Set<string>;
  selectedResourceId: string | null;
  showAllItems: boolean;
}

export interface DomainActions {
  setEnabled: (enabled: boolean) => void;
  setSelectedIdentifier: (identifier: string) => void;
  setLens: (lens: string) => void;
  setTracking: (tracking: any | null) => void;
  setLoadingTracking: (loading: boolean) => void;
  setFetchingData: (fetching: boolean) => void;
  setTrackedIdentifiers: (identifiers: Set<string>) => void;
  addTrackedIdentifier: (identifier: string) => void;
  removeTrackedIdentifier: (identifier: string) => void;
  setTrackedItemsList: (items: any[]) => void;
  setLatestData: (data: Record<string, any>) => void;
  updateData: (identifier: string, data: any) => void;
  setRefreshingIdentifiers: (identifiers: Set<string>) => void;
  addRefreshingIdentifier: (identifier: string) => void;
  removeRefreshingIdentifier: (identifier: string) => void;
  setSelectedResourceId: (id: string | null) => void;
  setShowAllItems: (show: boolean) => void;
}

