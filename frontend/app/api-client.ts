/**
 * API client for communicating with the Brain Web backend
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

// Cache for auth token
let authTokenCache: { token: string; expiresAt: number } | null = null;

/**
 * Get authentication token from the Next.js API route.
 * Caches the token to avoid repeated requests.
 */
async function getAuthToken(): Promise<string | null> {
  // Check cache first
  if (authTokenCache && authTokenCache.expiresAt > Date.now()) {
    return authTokenCache.token;
  }

  try {
    const response = await fetch('/api/auth/token');
    if (!response.ok) {
      console.warn('[API Client] Failed to get auth token, continuing without auth');
      return null;
    }
    const data = await response.json();
    const token = data.token;
    
    // Cache token (expires in 30 days, but refresh after 25 days to be safe)
    authTokenCache = {
      token,
      expiresAt: Date.now() + (25 * 24 * 60 * 60 * 1000), // 25 days
    };
    
    return token;
  } catch (error) {
    console.warn('[API Client] Error getting auth token:', error);
    return null;
  }
}

/**
 * Get headers for API requests, including authentication if available.
 */
async function getApiHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  const token = await getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
}

export interface Concept {
  node_id: string;
  name: string;
  domain: string;
  type: string;
  description?: string | null;
  tags?: string[] | null;
  notes_key?: string | null;
  lecture_key?: string | null; // Deprecated: kept for backward compatibility
  url_slug?: string | null;
  
  // Multi-source tracking fields
  lecture_sources?: string[] | null;
  created_by?: string | null;
  last_updated_by?: string | null;
}

export interface Relationship {
  source_id: string;
  predicate: string;
  target_id: string;
}

export interface GraphData {
  nodes: Concept[];
  links: Array<{
    source: string;
    target: string;
    predicate: string;
    relationship_status?: string;
    relationship_confidence?: number;
    relationship_method?: string;
    rationale?: string;
    relationship_source_id?: string;
    relationship_chunk_id?: string;
  }>;
}

// ---- Branch Explorer: Graph Collections (Graphs) ----

export interface GraphSummary {
  graph_id: string;
  name?: string | null;
  description?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  node_count?: number;
  edge_count?: number;
  template_id?: string | null;
  template_label?: string | null;
  template_description?: string | null;
  template_tags?: string[] | null;
  intent?: string | null;
}

export interface GraphListResponse {
  graphs: GraphSummary[];
  active_graph_id: string;
  active_branch_id: string;
}

export interface GraphSelectResponse {
  active_graph_id: string;
  active_branch_id: string;
  graph: any;
}

export interface CreateGraphOptions {
  template_id?: string;
  template_label?: string;
  template_description?: string;
  template_tags?: string[];
  intent?: string;
}

export async function listGraphs(): Promise<GraphListResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/graphs/`);
    if (!res.ok) {
      throw new Error(`Failed to list graphs: ${res.statusText}`);
    }
    const data = await res.json();
    // Store active graph_id and branch_id for offline use
    if (typeof window !== 'undefined') {
      try {
        if (data.active_graph_id) {
          sessionStorage.setItem('brainweb:activeGraphId', data.active_graph_id);
        }
        if (data.active_branch_id) {
          sessionStorage.setItem('brainweb:activeBranchId', data.active_branch_id);
        }
      } catch {}
    }
    return data;
  } catch (error) {
    console.error('Error fetching graphs:', error);
    // Return demo graph as fallback
    return { active_graph_id: 'demo', active_branch_id: 'main', graphs: [{ graph_id: 'demo', name: 'Demo' }] };
  }
}

export async function createGraph(name: string, options?: CreateGraphOptions): Promise<GraphSelectResponse> {
  const res = await fetch(`${API_BASE_URL}/graphs/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...options }),
  });
  if (!res.ok) throw new Error(`Failed to create graph: ${res.statusText}`);
  return res.json();
}

export async function selectGraph(graphId: string): Promise<GraphSelectResponse> {
  const res = await fetch(`${API_BASE_URL}/graphs/${encodeURIComponent(graphId)}/select`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Failed to select graph: ${res.statusText}`);
  return res.json();
}

// ---- Branch Explorer: Branches ----

export interface BranchSummary {
  branch_id: string;
  graph_id: string;
  name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  source_node_id?: string | null;
}

export interface BranchListResponse {
  graph_id: string;
  active_branch_id: string;
  branches: BranchSummary[];
}

export async function listBranches(): Promise<BranchListResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/branches/`);
    if (!res.ok) {
      throw new Error(`Failed to list branches: ${res.statusText}`);
    }
    return res.json();
  } catch (error) {
    console.error('Error fetching branches:', error);
    // Return default branch as fallback
    return { graph_id: 'demo', active_branch_id: 'main', branches: [{ branch_id: 'main', graph_id: 'demo', name: 'Main' }] };
  }
}

export async function createBranch(name: string): Promise<BranchSummary> {
  const res = await fetch(`${API_BASE_URL}/branches/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Failed to create branch: ${res.statusText}`);
  return res.json();
}

export async function selectBranch(branchId: string): Promise<{ graph_id: string; active_branch_id: string }> {
  const res = await fetch(`${API_BASE_URL}/branches/${encodeURIComponent(branchId)}/select`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Failed to select branch: ${res.statusText}`);
  return res.json();
}

export async function forkBranchFromNode(
  branchId: string,
  nodeId: string,
  depth: number = 2,
): Promise<any> {
  const res = await fetch(
    `${API_BASE_URL}/branches/${encodeURIComponent(branchId)}/fork-from-node/${encodeURIComponent(nodeId)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ depth }),
    },
  );
  if (!res.ok) throw new Error(`Failed to fork branch: ${res.statusText}`);
  return res.json();
}

export interface BranchCompareResponse {
  graph_id: string;
  branch_id: string;
  other_branch_id: string;
  node_ids_only_in_branch: string[];
  node_ids_only_in_other: string[];
  links_only_in_branch: Array<{ source_id: string; predicate: string; target_id: string }>;
  links_only_in_other: Array<{ source_id: string; predicate: string; target_id: string }>;
}

export async function compareBranches(
  branchId: string,
  otherBranchId: string,
): Promise<BranchCompareResponse> {
  const res = await fetch(
    `${API_BASE_URL}/branches/${encodeURIComponent(branchId)}/compare/${encodeURIComponent(otherBranchId)}`,
    { method: 'POST' },
  );
  if (!res.ok) throw new Error(`Failed to compare branches: ${res.statusText}`);
  return res.json();
}

export interface BranchLLMCompareResponse {
  similarities: string[];
  differences: string[];
  contradictions: string[];
  missing_steps: string[];
  recommendations: string[];
}

export async function llmCompareBranches(payload: {
  branch_id: string;
  other_branch_id: string;
  question?: string | null;
}): Promise<BranchLLMCompareResponse> {
  const res = await fetch(`${API_BASE_URL}/branches/compare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Failed LLM compare: ${res.statusText}${t ? ` - ${t}` : ''}`);
  }
  return res.json();
}

// ---- Branch Explorer: Snapshots ----

export interface SnapshotSummary {
  snapshot_id: string;
  graph_id: string;
  branch_id: string;
  name: string;
  created_at: string;
  focused_node_id?: string | null;
}

export async function createSnapshot(payload: {
  name: string;
  focused_node_id?: string | null;
  layout?: any;
}): Promise<SnapshotSummary> {
  const res = await fetch(`${API_BASE_URL}/snapshots/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Failed to create snapshot: ${res.statusText}`);
  return res.json();
}

export async function listSnapshots(limit: number = 50): Promise<{ snapshots: SnapshotSummary[] }> {
  const res = await fetch(`${API_BASE_URL}/snapshots/?limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to list snapshots: ${res.statusText}`);
  return res.json();
}

export async function restoreSnapshot(snapshotId: string): Promise<any> {
  const res = await fetch(`${API_BASE_URL}/snapshots/${encodeURIComponent(snapshotId)}/restore`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Failed to restore snapshot: ${res.statusText}`);
  return res.json();
}

/**
 * Fetch a concept by its node_id
 */
export async function getConcept(nodeId: string): Promise<Concept> {
  // Try offline cache first if offline
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const { getConceptOffline } = await import('../lib/offline/api_wrapper');
    const cached = await getConceptOffline(nodeId);
    if (cached) {
      return cached;
    }
    // If no cache, throw error
    throw new Error('Concept not available offline');
  }

  const response = await fetch(`${API_BASE_URL}/concepts/${nodeId}`);
  if (!response.ok) {
    // If online request fails, try offline cache as fallback
    const { getConceptOffline } = await import('../lib/offline/api_wrapper');
    const cached = await getConceptOffline(nodeId);
    if (cached) {
      return cached;
    }
    throw new Error(`Failed to fetch concept: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch a concept by name
 */
export async function getConceptByName(name: string): Promise<Concept> {
  const encodedName = encodeURIComponent(name);
  const response = await fetch(`${API_BASE_URL}/concepts/by-name/${encodedName}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch concept: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch a concept by URL slug (Wikipedia-style)
 */
export async function getConceptBySlug(slug: string): Promise<Concept> {
  const encodedSlug = encodeURIComponent(slug);
  const response = await fetch(`${API_BASE_URL}/concepts/by-slug/${encodedSlug}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch concept by slug: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Update a concept (partial update)
 */
export async function updateConcept(
  nodeId: string,
  updates: {
    description?: string;
    tags?: string[];
    domain?: string;
    type?: string;
  }
): Promise<Concept> {
  const response = await fetch(`${API_BASE_URL}/concepts/${nodeId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!response.ok) {
    throw new Error(`Failed to update concept: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch neighbors of a concept
 */
export async function getNeighbors(nodeId: string): Promise<Concept[]> {
  const response = await fetch(`${API_BASE_URL}/concepts/${nodeId}/neighbors`);
  if (!response.ok) {
    throw new Error(`Failed to fetch neighbors: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch neighbors with their relationship types
 */
export async function getNeighborsWithRelationships(nodeId: string): Promise<Array<{
  concept: Concept;
  predicate: string;
  is_outgoing: boolean;
  relationship_status?: string;
  relationship_confidence?: number;
  relationship_method?: string;
  relationship_rationale?: string;
  relationship_source_id?: string;
  relationship_chunk_id?: string;
}>> {
  const response = await fetch(`${API_BASE_URL}/concepts/${nodeId}/neighbors-with-relationships`);
  if (!response.ok) {
    throw new Error(`Failed to fetch neighbors with relationships: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Fetch the full graph starting from a root node
 * This recursively fetches neighbors to build a complete subgraph
 * OPTIMIZED: Parallelizes fetching at each depth level for faster loading
 */
export async function fetchGraphData(rootNodeId: string, maxDepth: number = 2): Promise<GraphData> {
  const nodes = new Map<string, Concept>();
  const links: Array<{ 
    source: string; 
    target: string; 
    predicate: string;
    relationship_status?: string;
    relationship_confidence?: number;
    relationship_method?: string;
    rationale?: string;
    relationship_source_id?: string;
    relationship_chunk_id?: string;
  }> = [];
  const linkSet = new Set<string>(); // Track links to avoid duplicates
  const visited = new Set<string>();

  /**
   * Fetch a single node and its neighbors, then return the neighbor IDs for next level
   * This allows us to parallelize all fetches at the same depth
   */
  async function fetchNodeAndNeighbors(nodeId: string): Promise<string[]> {
    if (visited.has(nodeId)) {
      return [];
    }
    visited.add(nodeId);

    try {
      // Fetch node and neighbors in parallel (they're independent)
      const [node, neighborsWithRels] = await Promise.all([
        getConcept(nodeId),
        getNeighborsWithRelationships(nodeId)
      ]);
      
      nodes.set(nodeId, node);
      const neighborIds: string[] = [];
      
      // Process all neighbors
      for (const { concept, predicate, is_outgoing, relationship_status, relationship_confidence, relationship_method, relationship_rationale, relationship_source_id, relationship_chunk_id } of neighborsWithRels) {
        nodes.set(concept.node_id, concept);
        neighborIds.push(concept.node_id);
        
        // Create link with proper direction and predicate
        const linkKey = is_outgoing 
          ? `${nodeId}->${concept.node_id}:${predicate}`
          : `${concept.node_id}->${nodeId}:${predicate}`;
        
        if (!linkSet.has(linkKey)) {
          linkSet.add(linkKey);
          links.push({
            source: is_outgoing ? nodeId : concept.node_id,
            target: is_outgoing ? concept.node_id : nodeId,
            predicate,
            relationship_status,
            relationship_confidence,
            relationship_method,
            rationale: relationship_rationale,
            relationship_source_id,
            relationship_chunk_id,
          });
        }
      }
      
      return neighborIds;
    } catch (error) {
      console.error(`Error fetching node ${nodeId}:`, error);
      return [];
    }
  }

  /**
   * Fetch all nodes at a given depth level in parallel
   */
  async function fetchLevel(nodeIds: string[], depth: number): Promise<void> {
    if (depth > maxDepth || nodeIds.length === 0) {
      return;
    }

    // Fetch all nodes at this level in parallel
    const neighborIdArrays = await Promise.all(
      nodeIds.map(nodeId => fetchNodeAndNeighbors(nodeId))
    );

    // Collect all unique neighbor IDs for the next level
    const nextLevelNodeIds = new Set<string>();
    for (const neighborIds of neighborIdArrays) {
      for (const neighborId of neighborIds) {
        if (!visited.has(neighborId)) {
          nextLevelNodeIds.add(neighborId);
        }
      }
    }

    // Recursively fetch the next level
    if (nextLevelNodeIds.size > 0) {
      await fetchLevel(Array.from(nextLevelNodeIds), depth + 1);
    }
  }

  // Start fetching from the root node
  await fetchLevel([rootNodeId], 0);

  return {
    nodes: Array.from(nodes.values()),
    links,
  };
}

/**
 * Fetch all graph data (nodes and relationships)
 * NOTE: For large graphs, consider using getGraphOverview instead.
 */
export async function getAllGraphData(): Promise<GraphData> {
  try {
    const response = await fetch(`${API_BASE_URL}/concepts/all/graph`);
    if (!response.ok) {
      throw new Error(`Failed to fetch graph data: ${response.statusText}`);
    }
    const data = await response.json();
    return {
      nodes: data.nodes || [],
      links: (data.links || []).map((link: any) => ({
        source: link.source_id,
        target: link.target_id,
        predicate: link.predicate,
        relationship_status: link.status,
        relationship_confidence: link.confidence,
        relationship_method: link.method,
        rationale: link.rationale,
        relationship_source_id: link.relationship_source_id,
        relationship_chunk_id: link.chunk_id,
      })),
    };
  } catch (error) {
    console.error('Error fetching graph data:', error);
    // Return empty graph data instead of throwing to prevent UI crashes
    return { nodes: [], links: [] };
  }
}

/**
 * Fetch graph overview (lightweight subset for fast loading)
 */
export async function getGraphOverview(
  graphId: string,
  limitNodes: number = 300,
  limitEdges: number = 600
): Promise<GraphData & { meta?: { node_count?: number; edge_count?: number; sampled?: boolean } }> {
  // Try offline cache first if offline
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const { getGraphDataOffline } = await import('../lib/offline/api_wrapper');
    const cached = await getGraphDataOffline();
    if (cached) {
      return { ...cached, meta: { sampled: true } };
    }
  }

  try {
    const response = await fetch(
      `${API_BASE_URL}/graphs/${encodeURIComponent(graphId)}/overview?limit_nodes=${limitNodes}&limit_edges=${limitEdges}`
    );
    if (!response.ok) {
      // If online request fails, try offline cache as fallback
      const { getGraphDataOffline } = await import('../lib/offline/api_wrapper');
      const cached = await getGraphDataOffline();
      if (cached) {
        return { ...cached, meta: { sampled: true } };
      }
      throw new Error(`Failed to fetch graph overview: ${response.statusText}`);
    }
    const data = await response.json();
    return {
      nodes: data.nodes || [],
      links: (data.edges || []).map((link: any) => ({
        source: link.source_id,
        target: link.target_id,
        predicate: link.predicate,
        relationship_status: link.status,
        relationship_confidence: link.confidence,
        relationship_method: link.method,
        rationale: link.rationale,
        relationship_source_id: link.relationship_source_id,
        relationship_chunk_id: link.chunk_id,
      })),
      meta: data.meta,
    };
  } catch (error) {
    console.error('Error fetching graph overview:', error);
    return { nodes: [], links: [], meta: { sampled: false } };
  }
}

/**
 * Fetch neighbors of a concept within a specific graph
 */
export async function getGraphNeighbors(
  graphId: string,
  conceptId: string,
  hops: number = 1,
  limit: number = 80
): Promise<{
  center: Concept;
  nodes: Concept[];
  edges: Array<{
    source_id: string;
    target_id: string;
    predicate: string;
    status?: string;
    confidence?: number;
    method?: string;
    rationale?: string;
    relationship_source_id?: string;
    chunk_id?: string;
  }>;
}> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/graphs/${encodeURIComponent(graphId)}/neighbors?concept_id=${encodeURIComponent(conceptId)}&hops=${hops}&limit=${limit}`
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch neighbors: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching neighbors:', error);
    throw error;
  }
}

/**
 * List concepts in a graph with filtering, sorting, and pagination
 */
export interface GraphConceptItem {
  concept_id: string;
  name: string;
  domain: string;
  type: string;
  degree?: number;
}

export interface GraphConceptsResponse {
  items: GraphConceptItem[];
  total: number;
}

export async function listGraphConcepts(
  graphId: string,
  options?: {
    query?: string;
    domain?: string;
    type?: string;
    sort?: 'alphabetical' | 'degree' | 'recent';
    limit?: number;
    offset?: number;
  }
): Promise<GraphConceptsResponse> {
  try {
    const params = new URLSearchParams();
    if (options?.query) params.set('query', options.query);
    if (options?.domain) params.set('domain', options.domain);
    if (options?.type) params.set('type', options.type);
    if (options?.sort) params.set('sort', options.sort);
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.offset) params.set('offset', options.offset.toString());
    
    const response = await fetch(
      `${API_BASE_URL}/graphs/${encodeURIComponent(graphId)}/concepts?${params.toString()}`
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch concepts: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching graph concepts:', error);
    throw error;
  }
}

/**
 * Create a relationship between two nodes by their IDs
 */
export async function createRelationshipByIds(
  sourceId: string,
  targetId: string,
  predicate: string
): Promise<void> {
  const params = new URLSearchParams({
    source_id: sourceId,
    target_id: targetId,
    predicate: predicate,
  });
  const response = await fetch(`${API_BASE_URL}/concepts/relationship-by-ids?${params}`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Failed to create relationship: ${response.statusText}`);
  }
}

/**
 * Propose a relationship between two concepts (creates PROPOSED status)
 */
export async function proposeRelationship(
  sourceId: string,
  targetId: string,
  predicate: string,
  rationale?: string
): Promise<{ status: string; message: string; exists: boolean }> {
  const params = new URLSearchParams({
    source_id: sourceId,
    target_id: targetId,
    predicate: predicate,
  });
  if (rationale) {
    params.append('rationale', rationale);
  }
  const response = await fetch(`${API_BASE_URL}/concepts/relationship/propose?${params}`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `Failed to propose relationship: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Check if a relationship exists between two concepts
 */
export async function checkRelationshipExists(
  sourceId: string,
  targetId: string,
  predicate: string
): Promise<boolean> {
  const params = new URLSearchParams({
    source_id: sourceId,
    target_id: targetId,
    predicate: predicate,
  });
  const response = await fetch(`${API_BASE_URL}/concepts/relationship/check?${params}`);
  if (!response.ok) {
    throw new Error(`Failed to check relationship: ${response.statusText}`);
  }
  const data = await response.json();
  return data.exists;
}

/**
 * Create a new concept
 */
export async function createConcept(concept: {
  name: string;
  domain: string;
  type?: string;
  notes_key?: string | null;
  lecture_key?: string | null;
  url_slug?: string | null;
  graph_id?: string | null;
  add_to_global?: boolean;
}): Promise<Concept> {
  const params = new URLSearchParams();
  if (concept.graph_id) {
    params.append('graph_id', concept.graph_id);
  }
  if (concept.add_to_global) {
    params.append('add_to_global', 'true');
  }
  const url = `${API_BASE_URL}/concepts/${params.toString() ? '?' + params.toString() : ''}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: concept.name,
      domain: concept.domain,
      type: concept.type,
      notes_key: concept.notes_key,
      lecture_key: concept.lecture_key,
      url_slug: concept.url_slug,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create concept: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get all instances of a concept across all graphs by matching the concept name
 */
export async function getCrossGraphInstances(nodeId: string): Promise<{
  concept_name: string;
  instances: Array<{
    node_id: string;
    name: string;
    domain: string;
    type: string;
    description: string | null;
    graph_id: string;
    graph_name: string;
    created_by: string | null;
    last_updated_by: string | null;
  }>;
  total_instances: number;
}> {
  const response = await fetch(`${API_BASE_URL}/concepts/${encodeURIComponent(nodeId)}/cross-graph-instances`);
  if (!response.ok) {
    throw new Error(`Failed to get cross-graph instances: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Link two concept instances across graphs
 */
export async function linkCrossGraphInstances(
  sourceNodeId: string,
  targetNodeId: string,
  linkType: 'user_linked' | 'manual_merge' | 'auto_detected' = 'user_linked'
): Promise<{
  source_node_id: string;
  target_node_id: string;
  source_graph_id: string;
  target_graph_id: string;
  link_type: string;
  linked_at: string;
  linked_by: string;
}> {
  const params = new URLSearchParams();
  params.append('target_node_id', targetNodeId);
  params.append('link_type', linkType);
  const response = await fetch(
    `${API_BASE_URL}/concepts/${encodeURIComponent(sourceNodeId)}/link-cross-graph?${params.toString()}`,
    { method: 'POST' }
  );
  if (!response.ok) {
    throw new Error(`Failed to link cross-graph instances: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get all linked cross-graph instances for a concept
 */
export async function getLinkedInstances(nodeId: string): Promise<{
  instances: Array<{
    node_id: string;
    name: string;
    domain: string;
    type: string;
    description: string | null;
    graph_id: string;
    graph_name: string;
    link_type: string;
    linked_at: string;
    linked_by: string;
  }>;
  total: number;
}> {
  const response = await fetch(`${API_BASE_URL}/concepts/${encodeURIComponent(nodeId)}/linked-instances`);
  if (!response.ok) {
    throw new Error(`Failed to get linked instances: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Delete a concept
 */
export async function deleteConcept(nodeId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/concepts/${nodeId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete concept: ${response.statusText}`);
  }
}

/**
 * Delete a relationship
 */
export async function deleteRelationship(
  sourceId: string,
  targetId: string,
  predicate: string
): Promise<void> {
  const params = new URLSearchParams({
    source_id: sourceId,
    target_id: targetId,
    predicate: predicate,
  });
  const response = await fetch(`${API_BASE_URL}/concepts/relationship?${params}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete relationship: ${response.statusText}`);
  }
}

/**
 * Search for concepts by name (keyword search)
 */
export async function searchConcepts(
  query: string,
  graphId?: string,
  limit: number = 20
): Promise<{
  query: string;
  results: Concept[];
  count: number;
}> {
  const params = new URLSearchParams();
  params.set('q', query);
  if (graphId) {
    params.set('graph_id', graphId);
  }
  params.set('limit', limit.toString());
  const response = await fetch(`${API_BASE_URL}/concepts/search?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to search concepts: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Search for resources by title or caption
 */
export async function searchResources(
  query: string,
  graphIdOrLimit?: string | number,
  limit?: number
): Promise<Resource[]> {
  const params = new URLSearchParams();
  params.set('query', query);
  
  // Handle overloaded calls:
  // - searchResources(query, limit) -> graphIdOrLimit is number, limit is undefined
  // - searchResources(query, graphId, limit) -> graphIdOrLimit is string, limit is number
  let graphId: string | undefined;
  let actualLimit: number;
  
  if (typeof graphIdOrLimit === 'number') {
    // Called as searchResources(query, limit)
    actualLimit = graphIdOrLimit;
  } else if (typeof graphIdOrLimit === 'string') {
    // Called as searchResources(query, graphId, limit)
    graphId = graphIdOrLimit;
    actualLimit = limit ?? 20;
  } else {
    // Called as searchResources(query) only
    actualLimit = 20;
  }
  
  if (graphId) {
    params.set('graph_id', graphId);
  }
  params.set('limit', actualLimit.toString());
  const response = await fetch(`${API_BASE_URL}/resources/search?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to search resources: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Claim type
 */
export interface Claim {
  claim_id: string;
  text: string;
  confidence: number;
  source_id?: string | null;
  source_span?: string | null;
  method?: string | null;
  chunk_id?: string | null;
  source_type?: string | null;
  source_url?: string | null;
  doc_type?: string | null;
  company_ticker?: string | null;
}

/**
 * Source type
 */
export interface Source {
  doc_id: string;
  source_type: string;
  external_id?: string | null;
  url?: string | null;
  doc_type?: string | null;
  company_ticker?: string | null;
  published_at?: number | null;
  metadata?: any;
  chunks?: Array<{
    chunk_id: string;
    chunk_index: number;
    text_preview: string;
  }>;
  claim_count: number;
}

/**
 * Get all claims that mention a concept
 */
export async function getClaimsForConcept(nodeId: string, limit: number = 50): Promise<Claim[]> {
  const response = await fetch(`${API_BASE_URL}/concepts/${nodeId}/claims?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch claims: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get all sources (documents/chunks) that mention a concept
 */
export async function getSourcesForConcept(nodeId: string, limit: number = 100): Promise<Source[]> {
  const response = await fetch(`${API_BASE_URL}/concepts/${nodeId}/sources?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch sources: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Cleanup test data
 */
export async function cleanupTestData(): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE_URL}/concepts/cleanup-test-data`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Failed to cleanup test data: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Analogy type
 */
export interface Analogy {
  analogy_id: string;
  label: string;
  description?: string | null;
  tags?: string[] | null;
}

/**
 * Lecture Segment type
 */
export interface LectureSegment {
  segment_id: string;
  lecture_id: string;
  segment_index: number;
  start_time_sec?: number | null;
  end_time_sec?: number | null;
  text: string;
  summary?: string | null;
  style_tags?: string[] | null;
  covered_concepts: Concept[];
  analogies: Analogy[];
  lecture_title?: string | null;  // Title of the lecture this segment belongs to
}

export interface LectureBlock {
  block_id: string;
  lecture_id: string;
  block_index: number;
  block_type: string;
  text: string;
}

export interface LectureBlockUpsert {
  block_id?: string | null;
  block_index: number;
  block_type: string;
  text: string;
}

export interface LectureMention {
  mention_id: string;
  lecture_id: string;
  block_id: string;
  start_offset: number;
  end_offset: number;
  surface_text: string;
  context_note?: string | null;
  sense_label?: string | null;
  lecture_title?: string | null;
  block_text?: string | null;
  concept: Concept;
}

export interface LectureMentionCreate {
  lecture_id: string;
  block_id: string;
  start_offset: number;
  end_offset: number;
  surface_text: string;
  concept_id: string;
  context_note?: string | null;
  sense_label?: string | null;
}

export interface LectureMentionUpdate {
  concept_id?: string | null;
  start_offset?: number | null;
  end_offset?: number | null;
  surface_text?: string | null;
  context_note?: string | null;
  sense_label?: string | null;
}

export interface LectureIngestResult {
  lecture_id: string;
  nodes_created: Concept[];
  nodes_updated: Concept[];
  links_created: Array<{
    source_id: string;
    target_id: string;
    predicate: string;
  }>;
  segments: LectureSegment[];
  created_concept_ids?: string[];
  updated_concept_ids?: string[];
  created_relationship_count?: number;
  created_claim_ids?: string[];
}

/**
 * Ingest a lecture by extracting concepts and relationships using LLM
 */
export async function ingestLecture(payload: {
  lecture_title: string;
  lecture_text: string;
  domain?: string;
}): Promise<LectureIngestResult> {
  const response = await fetch(`${API_BASE_URL}/lectures/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to ingest lecture: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Fetch a lecture by ID
 */
export interface Lecture {
  segment_count?: number;  // Number of segments (for performance, included in list responses)
  lecture_id: string;
  title: string;
  description?: string | null;
  primary_concept?: string | null;
  level?: string | null;
  estimated_time?: number | null;
  slug?: string | null;
  raw_text?: string | null;
  metadata_json?: string | null;
}

/**
 * Fetch all blocks for a lecture
 */
export async function getLectureBlocks(lectureId: string): Promise<LectureBlock[]> {
  const response = await fetch(`${API_BASE_URL}/lectures/${lectureId}/blocks`);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch lecture blocks: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Upsert lecture blocks
 */
export async function upsertLectureBlocks(
  lectureId: string,
  blocks: LectureBlockUpsert[]
): Promise<LectureBlock[]> {
  const response = await fetch(`${API_BASE_URL}/lectures/${lectureId}/blocks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ blocks }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to upsert lecture blocks: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Fetch all linked mentions for a lecture
 */
export async function getLectureMentions(lectureId: string): Promise<LectureMention[]> {
  const response = await fetch(`${API_BASE_URL}/lectures/${lectureId}/mentions`);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch lecture mentions: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Create a linked mention
 */
export async function createLectureMention(payload: LectureMentionCreate): Promise<LectureMention> {
  const response = await fetch(`${API_BASE_URL}/mentions/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create lecture mention: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Update a linked mention
 */
export async function updateLectureMention(
  mentionId: string,
  payload: LectureMentionUpdate
): Promise<LectureMention> {
  const response = await fetch(`${API_BASE_URL}/mentions/${mentionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update lecture mention: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Delete a linked mention
 */
export async function deleteLectureMention(mentionId: string): Promise<{ status: string; mention_id: string }> {
  const response = await fetch(`${API_BASE_URL}/mentions/${mentionId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to delete lecture mention: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Fetch concept backlinks from lecture mentions
 */
export async function getConceptMentions(conceptId: string): Promise<LectureMention[]> {
  const response = await fetch(`${API_BASE_URL}/concepts/${conceptId}/mentions`);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch concept mentions: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * List all lectures
 */
export async function listLectures(): Promise<Lecture[]> {
  const response = await fetch(`${API_BASE_URL}/lectures/`);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to list lectures: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

export async function getLecture(lectureId: string): Promise<Lecture> {
  const response = await fetch(`${API_BASE_URL}/lectures/${lectureId}`);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch lecture: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Create a new lecture
 */
export async function createLecture(payload: {
  title: string;
  description?: string | null;
  primary_concept?: string | null;
  level?: string | null;
  estimated_time?: number | null;
  slug?: string | null;
  raw_text?: string | null;
}): Promise<Lecture> {
  const response = await fetch(`${API_BASE_URL}/lectures/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create lecture: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Update a lecture's title and/or raw_text
 */
export async function updateLecture(
  lectureId: string,
  payload: {
    title?: string | null;
    raw_text?: string | null;
    metadata_json?: string | null;
  }
): Promise<Lecture> {
  const response = await fetch(`${API_BASE_URL}/lectures/${lectureId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update lecture: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Fetch all segments for a lecture
 */
export async function getLectureSegments(lectureId: string): Promise<LectureSegment[]> {
  const response = await fetch(`${API_BASE_URL}/lectures/${lectureId}/segments`);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch lecture segments: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Update a lecture segment's text and/or other fields
 */
export async function updateSegment(
  segmentId: string,
  payload: {
    text?: string | null;
    summary?: string | null;
    start_time_sec?: number | null;
    end_time_sec?: number | null;
    style_tags?: string[] | null;
  }
): Promise<LectureSegment> {
  const response = await fetch(`${API_BASE_URL}/lectures/segments/${segmentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update segment: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Fetch segments by concept name
 */
export async function getSegmentsByConcept(conceptName: string): Promise<LectureSegment[]> {
  const encodedName = encodeURIComponent(conceptName);
  const response = await fetch(`${API_BASE_URL}/lectures/segments/by-concept/${encodedName}`);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch segments by concept: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Notion integration types
 */
export interface NotionPageSummary {
  id: string;
  title: string;
  url?: string;
}

export interface NotionDatabaseSummary {
  id: string;
  title: string;
  url?: string;
}

export interface NotionSummaryResponse {
  pages: NotionPageSummary[];
  databases: NotionDatabaseSummary[];
}

/**
 * Get summary of Notion pages and databases
 */
export async function getNotionSummary(): Promise<NotionSummaryResponse> {
  const response = await fetch(`${API_BASE_URL}/notion/summary`);
  if (!response.ok) {
    throw new Error(`Failed to fetch Notion summary: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Ingest specific Notion pages
 */
export async function ingestNotionPages(
  pageIds: string[],
  domain?: string
): Promise<LectureIngestResult[]> {
  const response = await fetch(`${API_BASE_URL}/notion/ingest-pages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      page_ids: pageIds,
      domain: domain || 'Software Engineering',
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to ingest Notion pages: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Ingest all Notion pages (original sequential method)
 */
export async function ingestAllNotionPages(
  mode: 'pages' | 'databases' | 'both' = 'pages',
  domain?: string
): Promise<LectureIngestResult[]> {
  const response = await fetch(`${API_BASE_URL}/notion/ingest-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode,
      domain: domain || 'Software Engineering',
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to ingest all Notion pages: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Progress event types for parallel ingestion
 */
export interface NotionIngestProgressEvent {
  type: 'start' | 'progress' | 'complete' | 'error';
  total?: number;
  processed?: number;
  current_page?: string;
  success?: boolean;
  message?: string;
  succeeded?: number;
  failed?: number;
  results?: LectureIngestResult[];
  summary?: {
    nodes: number;
    links: number;
    segments: number;
  };
  errors?: string[];
}

/**
 * Ingest all Notion pages with parallel processing and progress updates
 * Uses Server-Sent Events (SSE) to stream progress
 * Returns both the promise and the abort controller for cancellation
 */
export async function ingestAllNotionPagesParallel(
  mode: 'pages' | 'databases' | 'both' = 'pages',
  domain?: string,
  maxWorkers: number = 5,
  useParallel: boolean = true,
  onProgress?: (event: NotionIngestProgressEvent) => void,
  abortController?: AbortController
): Promise<LectureIngestResult[]> {
  return new Promise((resolve, reject) => {
    const controller = abortController || new AbortController();
    const results: LectureIngestResult[] = [];
    
    fetch(`${API_BASE_URL}/notion/ingest-all-parallel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode,
        domain: domain || 'Software Engineering',
        max_workers: maxWorkers,
        use_parallel: useParallel,
      }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to start parallel ingestion: ${response.statusText} - ${errorText}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        if (!reader) {
          throw new Error('Response body is not readable');
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event: NotionIngestProgressEvent = JSON.parse(line.slice(6));
                
                if (onProgress) {
                  onProgress(event);
                }

                if (event.type === 'complete') {
                  if (event.results) {
                    // Convert dict results back to LectureIngestResult objects
                    results.push(...event.results as any);
                  }
                  resolve(results);
                  return;
                } else if (event.type === 'error') {
                  reject(new Error(event.message || 'Unknown error'));
                  return;
                }
              } catch (e) {
                console.error('Failed to parse SSE event:', e, line);
              }
            }
          }
        }

        // If we exit the loop without a complete event, resolve with what we have
        resolve(results);
      })
      .catch((error) => {
        if (error.name === 'AbortError') {
          // User cancelled - resolve with partial results
          resolve(results);
        } else {
          reject(error);
        }
      });
  });
}

/**
 * Submit feedback on a Brain Web answer
 */
export async function submitFeedback(
  answerId: string,
  rating: number,
  reasoning?: string | null,
  question?: string
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/feedback/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      answer_id: answerId,
      question: question || '',
      rating,
      reasoning: reasoning || '',
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to submit feedback: ${response.statusText}`);
  }
}

// --- Preferences & Profile API helpers ---

export interface ResponseStyleProfile {
  tone: string;
  teaching_style: string;
  sentence_structure: string;
  explanation_order: string[];
  forbidden_styles: string[];
}

export interface ResponseStyleProfileWrapper {
  id: string;
  profile: ResponseStyleProfile;
}

// Dashboard API
export interface StudyTimeData {
  domain: string;
  hours: number;
  minutes: number;
  total_ms: number;
}

export interface ExamData {
  exam_id: string;
  title: string;
  date: string;
  days_until: number;
  required_concepts: string[];
  domain?: string;
}

export interface StudyRecommendation {
  concept_id: string;
  concept_name: string;
  priority: 'high' | 'medium' | 'low';
  reason: string;
  suggested_documents: Array<{
    document_id: string;
    title: string;
    section: string;
    url: string;
  }>;
  estimated_time_min: number;
}

export interface ResumePoint {
  document_id: string;
  document_title: string;
  block_id?: string;
  segment_id?: string;
  concept_id?: string;
  last_accessed: string;
  document_type: string;
  url: string;
}

export interface DashboardData {
  study_time_by_domain: StudyTimeData[];
  upcoming_exams: ExamData[];
  study_recommendations: StudyRecommendation[];
  resume_points: ResumePoint[];
  total_study_hours: number;
  days_looked_back: number;
}

export async function getDashboardData(days: number = 7): Promise<DashboardData> {
  const res = await fetch(`${API_BASE_URL}/dashboard/study-analytics?days=${days}`);
  if (!res.ok) throw new Error('Failed to load dashboard data');
  return res.json();
}

export async function createExam(payload: {
  title: string;
  exam_date: string;
  assessment_type?: string;
  required_concepts?: string[];
  domain?: string;
  description?: string;
}): Promise<ExamData> {
  const res = await fetch(`${API_BASE_URL}/exams/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to create exam');
  return res.json();
}

export async function listExams(days_ahead: number = 90): Promise<ExamData[]> {
  const res = await fetch(`${API_BASE_URL}/exams/?days_ahead=${days_ahead}`);
  if (!res.ok) throw new Error('Failed to load exams');
  return res.json();
}

export async function updateExam(examId: string, payload: {
  title?: string;
  exam_date?: string;
  required_concepts?: string[];
  domain?: string;
  description?: string;
}): Promise<ExamData> {
  const res = await fetch(`${API_BASE_URL}/exams/${examId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to update exam');
  return res.json();
}

export async function deleteExam(examId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/exams/${examId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete exam');
}

export interface FocusArea {
  id: string;
  name: string;
  description?: string | null;
  active: boolean;
}

export interface UserProfile {
  id: string;
  name: string;
  background: string[];
  interests: string[];
  weak_spots: string[];
  learning_preferences: Record<string, any>;
}

export interface ReminderPreferences {
  weekly_digest: {
    enabled: boolean;
    day_of_week: number; // 1-7 (Monday=1, Sunday=7)
    hour: number; // 0-23
  };
  review_queue: {
    enabled: boolean;
    cadence_days: number;
  };
  finance_stale: {
    enabled: boolean;
    cadence_days: number;
  };
}

export interface UIPreferences {
  active_lens: 'NONE' | 'LEARNING' | 'FINANCE';
  reminders?: ReminderPreferences;
}

// Notion config – simple version
export interface NotionConfig {
  database_ids: string[];      // which DBs to sync
  enable_auto_sync: boolean;   // background loop on/off
}

export async function getResponseStyle(): Promise<ResponseStyleProfileWrapper> {
  const res = await fetch(`${API_BASE_URL}/preferences/response-style`);
  if (!res.ok) throw new Error('Failed to load response style');
  return res.json();
}

export async function updateResponseStyle(
  wrapper: ResponseStyleProfileWrapper,
): Promise<ResponseStyleProfileWrapper> {
  const res = await fetch(`${API_BASE_URL}/preferences/response-style`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(wrapper),
  });
  if (!res.ok) throw new Error('Failed to update response style');
  return res.json();
}

export async function getFocusAreas(): Promise<FocusArea[]> {
  const res = await fetch(`${API_BASE_URL}/preferences/focus-areas`);
  if (!res.ok) throw new Error('Failed to load focus areas');
  return res.json();
}

export async function upsertFocusArea(
  area: FocusArea,
): Promise<FocusArea> {
  const res = await fetch(`${API_BASE_URL}/preferences/focus-areas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(area),
  });
  if (!res.ok) throw new Error('Failed to save focus area');
  return res.json();
}

export async function setFocusAreaActive(
  id: string,
  active: boolean,
): Promise<FocusArea> {
  const res = await fetch(
    `${API_BASE_URL}/preferences/focus-areas/${encodeURIComponent(
      id,
    )}/active?active=${active}`,
    {
      method: 'POST',
    },
  );
  if (!res.ok) throw new Error('Failed to toggle focus area');
  return res.json();
}

export async function getUserProfile(): Promise<UserProfile> {
  const res = await fetch(`${API_BASE_URL}/preferences/user-profile`);
  if (!res.ok) throw new Error('Failed to load user profile');
  return res.json();
}

export async function updateUserProfile(
  profile: UserProfile,
): Promise<UserProfile> {
  const res = await fetch(`${API_BASE_URL}/preferences/user-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  if (!res.ok) throw new Error('Failed to update user profile');
  return res.json();
}

export async function getUIPreferences(): Promise<UIPreferences> {
  const res = await fetch(`${API_BASE_URL}/preferences/ui`);
  if (!res.ok) throw new Error('Failed to load UI preferences');
  return res.json();
}

export async function updateUIPreferences(
  prefs: UIPreferences,
): Promise<UIPreferences> {
  const res = await fetch(`${API_BASE_URL}/preferences/ui`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw new Error('Failed to update UI preferences');
  return res.json();
}

// --- Notion config (align this with whatever backend you actually add) ---

export async function getNotionConfig(): Promise<NotionConfig> {
  const res = await fetch(`${API_BASE_URL}/admin/notion-config`);
  if (!res.ok) throw new Error('Failed to load Notion config');
  return res.json();
}

export async function updateNotionConfig(
  config: NotionConfig,
): Promise<NotionConfig> {
  const res = await fetch(`${API_BASE_URL}/admin/notion-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('Failed to update Notion config');
  return res.json();
}

// --- Resource API helpers ---

export interface Resource {
  resource_id: string;
  kind: 'image' | 'pdf' | 'audio' | 'web_link' | 'notion_block' | 'generated_image' | 'file' | string;
  url: string;
  title?: string | null;
  mime_type?: string | null;
  caption?: string | null;
  source?: string | null;
  metadata?: Record<string, any> | null;
  created_at?: string | null; // ISO format timestamp
}


/**
 * Fetch all resources attached to a concept
 */
export async function getResourcesForConcept(conceptId: string): Promise<Resource[]> {
  // Try offline cache first if offline
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    const { getResourcesForConceptOffline } = await import('../lib/offline/api_wrapper');
    const cached = await getResourcesForConceptOffline(conceptId);
    if (cached.length > 0) {
      return cached;
    }
    // If no cache, return empty array (don't throw - resources are optional)
    return [];
  }

  try {
    const res = await fetch(`${API_BASE_URL}/resources/by-concept/${encodeURIComponent(conceptId)}`);
    if (!res.ok) {
      // If online request fails, try offline cache as fallback
      const { getResourcesForConceptOffline } = await import('../lib/offline/api_wrapper');
      const cached = await getResourcesForConceptOffline(conceptId);
      if (cached.length > 0) {
        return cached;
      }
      throw new Error(`Failed to fetch resources for concept ${conceptId}: ${res.statusText}`);
    }
    return res.json();
  } catch {
    // Network error - try offline cache
    const { getResourcesForConceptOffline } = await import('../lib/offline/api_wrapper');
    const cached = await getResourcesForConceptOffline(conceptId);
    return cached; // Return cached or empty array
  }
}

/**
 * Upload a file and optionally attach it to a concept
 */
export async function uploadResourceForConcept(
  file: File,
  conceptId?: string,
  title?: string,
): Promise<Resource> {
  const formData = new FormData();
  formData.append('file', file);
  if (conceptId) formData.append('concept_id', conceptId);
  if (title) formData.append('title', title);

  const res = await fetch(`${API_BASE_URL}/resources/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Failed to upload resource: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Fetch confusions and pitfalls for a concept using Browser Use skill
 */
export async function fetchConfusionsForConcept(
  query: string,
  conceptId?: string,
  sources: string[] = ['stackoverflow', 'github', 'docs', 'blogs'],
  limit: number = 8,
): Promise<Resource> {
  const res = await fetch(`${API_BASE_URL}/resources/fetch/confusions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query,
      concept_id: conceptId,
      sources,
      limit,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to fetch confusions: ${res.statusText} - ${errorText}`);
  }
  return res.json();
}

// --- Finance API helpers ---

export interface FinanceTrackingConfig {
  ticker: string;
  enabled: boolean;
  cadence: 'daily' | 'weekly' | 'monthly';
}

/**
 * Fetch a finance snapshot for a ticker
 */
export async function fetchFinanceSnapshot(
  ticker: string,
  conceptId?: string,
  newsWindowDays: number = 7,
  maxNewsItems: number = 5,
): Promise<Resource> {
  const res = await fetch(`${API_BASE_URL}/finance/snapshot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ticker,
      concept_id: conceptId,
      news_window_days: newsWindowDays,
      max_news_items: maxNewsItems,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to fetch finance snapshot: ${res.statusText} - ${errorText}`);
  }
  return res.json();
}

/**
 * Get tracking configuration for a ticker
 */
export async function getFinanceTracking(ticker: string): Promise<FinanceTrackingConfig | null> {
  const res = await fetch(`${API_BASE_URL}/finance/tracking?ticker=${encodeURIComponent(ticker)}`);
  if (!res.ok) {
    if (res.status === 404) {
      return null; // No tracking config exists
    }
    throw new Error(`Failed to get finance tracking: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Set tracking configuration for a ticker
 */
export async function setFinanceTracking(config: FinanceTrackingConfig): Promise<FinanceTrackingConfig> {
  const res = await fetch(`${API_BASE_URL}/finance/tracking`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to set finance tracking: ${res.statusText} - ${errorText}`);
  }
  return res.json();
}

/**
 * List all tracked tickers
 */
export async function listFinanceTracking(): Promise<FinanceTrackingConfig[]> {
  const res = await fetch(`${API_BASE_URL}/finance/tracking/list`);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to list finance tracking: ${res.statusText} - ${errorText}`);
  }
  const data = await res.json();
  return data.tickers || [];
}

/**
 * Latest snapshot metadata for a ticker
 */
export interface LatestSnapshotMetadata {
  ticker: string;
  resource_id?: string;
  snapshot_fetched_at?: string;
  market_as_of?: string;
  company_name?: string;
}

/**
 * Get latest snapshot metadata for multiple tickers
 */
export async function getLatestFinanceSnapshots(tickers: string[]): Promise<LatestSnapshotMetadata[]> {
  if (tickers.length === 0) {
    return [];
  }
  const tickersParam = tickers.join(',');
  const res = await fetch(`${API_BASE_URL}/finance/snapshots/latest?tickers=${encodeURIComponent(tickersParam)}`);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to get latest snapshots: ${res.statusText} - ${errorText}`);
  }
  const data = await res.json();
  return data.snapshots || [];
}

// --- Teaching Style API helpers ---

export interface TeachingStyleProfile {
  id: string;
  tone: string;
  teaching_style: string;
  sentence_structure: string;
  explanation_order: string[];
  forbidden_styles: string[];
}

export async function getTeachingStyle(): Promise<TeachingStyleProfile> {
  const res = await fetch(`${API_BASE_URL}/teaching-style`);
  if (!res.ok) throw new Error('Failed to load teaching style');
  return res.json();
}

export async function recomputeTeachingStyle(limit: number = 5): Promise<TeachingStyleProfile> {
  const res = await fetch(`${API_BASE_URL}/teaching-style/recompute?limit=${limit}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to recompute teaching style');
  return res.json();
}

// --- Gaps API helpers ---

export interface GapsOverview {
  missing_descriptions: Array<{
    node_id: string;
    name: string;
    domain: string;
  }>;
  low_connectivity: Array<{
    node_id: string;
    name: string;
    degree: number;
    domain: string;
  }>;
  high_interest_low_coverage: Array<{
    node_id: string;
    name: string;
    question_count: number;
    lecture_count: number;
    domain: string;
  }>;
}

export async function getGapsOverview(limit: number = 10): Promise<GapsOverview> {
  const res = await fetch(`${API_BASE_URL}/gaps/overview?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to load gaps overview');
  return res.json();
}

// --- Suggestions API helpers ---

export type SuggestionType = 'GAP_DEFINE' | 'GAP_EVIDENCE' | 'REVIEW_RELATIONSHIPS' | 'STALE_EVIDENCE' | 'RECENT_LOW_COVERAGE' | 'COVERAGE_LOW' | 'EVIDENCE_STALE' | 'GRAPH_HEALTH_ISSUE' | 'REVIEW_BACKLOG';

export type SuggestionActionKind = 'OPEN_CONCEPT' | 'OPEN_REVIEW' | 'FETCH_EVIDENCE' | 'OPEN_GAPS' | 'OPEN_DIGEST';

export type SuggestionSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface SuggestionAction {
  label?: string;
  kind: SuggestionActionKind;
  href?: string;
  payload?: any;
}

export interface Suggestion {
  id: string;
  type: SuggestionType;
  title: string;
  rationale: string;
  priority: number;
  concept_id?: string;
  concept_name?: string;
  resource_id?: string;
  graph_id?: string;
  // Quality suggestion fields (optional for backward compatibility)
  kind?: string;
  explanation?: string;  // 1-sentence why (for quality suggestions)
  severity?: SuggestionSeverity;  // LOW | MEDIUM (no HIGH in v1)
  primary_action?: SuggestionAction;
  secondary_action?: SuggestionAction;
  action: SuggestionAction;
}

export async function getSuggestions(
  limit: number = 20,
  graphId?: string,
  recentConcepts?: string[],
  conceptId?: string
): Promise<Suggestion[]> {
  const params = new URLSearchParams();
  params.set('limit', limit.toString());
  if (graphId) {
    params.set('graph_id', graphId);
  }
  if (recentConcepts && recentConcepts.length > 0) {
    params.set('recent_concepts', recentConcepts.join(','));
  }
  if (conceptId) {
    params.set('concept_id', conceptId);
  }
  const res = await fetch(`${API_BASE_URL}/suggestions?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to load suggestions');
  return res.json();
}

// --- Review API helpers ---

export interface RelationshipReviewItem {
  src_node_id: string;
  src_name: string;
  dst_node_id: string;
  dst_name: string;
  rel_type: string;
  confidence: number;
  method: string;
  rationale?: string | null;
  source_id?: string | null;
  chunk_id?: string | null;
  claim_id?: string | null;
  model_version?: string | null;
  created_at?: number | null;
  updated_at?: number | null;
  reviewed_at?: number | null;
  reviewed_by?: string | null;
}

export interface RelationshipReviewListResponse {
  relationships: RelationshipReviewItem[];
  total: number;
  graph_id: string;
  status: string;
}

export interface RelationshipReviewActionResponse {
  status: string;
  action: string;
  count: number;
  graph_id: string;
}

export async function listProposedRelationships(
  graphId: string,
  status: string = 'PROPOSED',
  limit: number = 50,
  offset: number = 0,
  ingestionRunId?: string
): Promise<RelationshipReviewListResponse> {
  const params = new URLSearchParams({
    graph_id: graphId,
    status,
    limit: limit.toString(),
    offset: offset.toString(),
  });
  if (ingestionRunId) {
    params.append('ingestion_run_id', ingestionRunId);
  }
  const res = await fetch(
    `${API_BASE_URL}/review/relationships?${params.toString()}`
  );
  if (!res.ok) throw new Error('Failed to load relationships for review');
  return res.json();
}

export async function acceptRelationships(
  graphId: string | null,
  edges: Array<{ src_node_id: string; dst_node_id: string; rel_type: string }>,
  reviewedBy?: string
): Promise<RelationshipReviewActionResponse> {
  const res = await fetch(`${API_BASE_URL}/review/relationships/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graph_id: graphId,
      edges,
      reviewed_by: reviewedBy,
    }),
  });
  if (!res.ok) throw new Error('Failed to accept relationships');
  return res.json();
}

export async function rejectRelationships(
  graphId: string | null,
  edges: Array<{ src_node_id: string; dst_node_id: string; rel_type: string }>,
  reviewedBy?: string
): Promise<RelationshipReviewActionResponse> {
  const res = await fetch(`${API_BASE_URL}/review/relationships/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graph_id: graphId,
      edges,
      reviewed_by: reviewedBy,
    }),
  });
  if (!res.ok) throw new Error('Failed to reject relationships');
  return res.json();
}

export async function editRelationship(
  graphId: string | null,
  srcNodeId: string,
  dstNodeId: string,
  oldRelType: string,
  newRelType: string,
  reviewedBy?: string
): Promise<RelationshipReviewActionResponse> {
  const res = await fetch(`${API_BASE_URL}/review/relationships/edit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      graph_id: graphId,
      src_node_id: srcNodeId,
      dst_node_id: dstNodeId,
      old_rel_type: oldRelType,
      new_rel_type: newRelType,
      reviewed_by: reviewedBy,
    }),
  });
  if (!res.ok) throw new Error('Failed to edit relationship');
  return res.json();
}

// ---------- Ingestion Run APIs ----------

export interface IngestionRun {
  run_id: string;
  graph_id: string;
  source_type: string;
  source_label?: string | null;
  status: string;
  started_at: string;
  completed_at?: string | null;
  summary_counts?: {
    concepts_created?: number;
    concepts_updated?: number;
    resources_created?: number;
    relationships_proposed?: number;
  } | null;
  error_count?: number | null;
  errors?: string[] | null;
  undone_at?: string | null;
  undo_mode?: string | null;
  undo_summary?: {
    archived?: {
      relationships?: number;
      concepts?: number;
      resources?: number;
    };
    skipped?: {
      concepts?: Array<{ concept_id: string; reason: string }>;
      resources?: Array<{ resource_id: string; reason: string }>;
      relationships?: Array<{ relationship_id: string; reason: string }>;
    };
  } | null;
  restored_at?: string | null;
}

export interface IngestionRunChanges {
  run: IngestionRun;
  concepts_created: Array<{
    concept_id: string;
    name: string;
    domain: string;
    type: string;
  }>;
  concepts_updated: Array<{
    concept_id: string;
    name: string;
    domain: string;
    type: string;
  }>;
  resources_created: Array<{
    resource_id: string;
    title: string;
    source_type: string;
    concept_id?: string | null;
  }>;
  relationships_proposed: Array<{
    relationship_id: string;
    from_concept_id: string;
    to_concept_id: string;
    predicate: string;
    status: string;
  }>;
}

export async function listIngestionRuns(
  limit: number = 20,
  offset: number = 0
): Promise<IngestionRun[]> {
  const res = await fetch(
    `${API_BASE_URL}/ingestion/runs?limit=${limit}&offset=${offset}`
  );
  if (!res.ok) throw new Error('Failed to load ingestion runs');
  return res.json();
}

export async function getIngestionRun(runId: string): Promise<IngestionRun> {
  const res = await fetch(`${API_BASE_URL}/ingestion/runs/${encodeURIComponent(runId)}`);
  if (!res.ok) throw new Error('Failed to load ingestion run');
  return res.json();
}

export async function getIngestionRunChanges(runId: string): Promise<IngestionRunChanges> {
  const res = await fetch(`${API_BASE_URL}/ingestion/runs/${encodeURIComponent(runId)}/changes`);
  if (!res.ok) throw new Error('Failed to load ingestion run changes');
  return res.json();
}

export interface UndoRunRequest {
  mode: 'SAFE' | 'RELATIONSHIPS_ONLY';
}

export interface UndoRunResponse {
  run_id: string;
  archived: {
    relationships: number;
    concepts: number;
    resources: number;
  };
  skipped: {
    concepts: Array<{ concept_id: string; reason: string }>;
    resources: Array<{ resource_id: string; reason: string }>;
    relationships: Array<{ relationship_id: string; reason: string }>;
  };
}

export async function undoIngestionRun(
  runId: string,
  mode: 'SAFE' | 'RELATIONSHIPS_ONLY' = 'SAFE'
): Promise<UndoRunResponse> {
  const res = await fetch(`${API_BASE_URL}/ingestion/runs/${encodeURIComponent(runId)}/undo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to undo ingestion run: ${res.statusText} - ${errorText}`);
  }
  return res.json();
}

export interface RestoreRunResponse {
  run_id: string;
  restored: {
    relationships: number;
    concepts: number;
    resources: number;
  };
  skipped: {
    concepts: Array<{ concept_id: string; reason: string }>;
    resources: Array<{ resource_id: string; reason: string }>;
    relationships: Array<{ relationship_id: string; reason: string }>;
  };
}

export async function restoreIngestionRun(runId: string): Promise<RestoreRunResponse> {
  const res = await fetch(`${API_BASE_URL}/ingestion/runs/${encodeURIComponent(runId)}/restore`, {
    method: 'POST',
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to restore ingestion run: ${res.statusText} - ${errorText}`);
  }
  return res.json();
}

// ---- Suggested Paths ----

export interface PathStep {
  concept_id: string;
  name: string;
  domain?: string;
  type?: string;
}

export interface SuggestedPath {
  path_id: string;
  title: string;
  rationale: string;
  steps: PathStep[];
  start_concept_id: string;
}

export async function getSuggestedPaths(
  graphId: string,
  conceptId?: string,
  limit: number = 10
): Promise<SuggestedPath[]> {
  const params = new URLSearchParams();
  params.set('graph_id', graphId);
  if (conceptId) {
    params.set('concept_id', conceptId);
  }
  params.set('limit', limit.toString());
  
  const res = await fetch(`${API_BASE_URL}/paths/suggested?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to get suggested paths: ${res.statusText}`);
  }
  return res.json();
}

// --- Quality API helpers ---

export interface ConceptQuality {
  concept_id: string;
  coverage_score: number;
  coverage_breakdown: {
    has_description: boolean;
    evidence_count: number;
    degree: number;
    reviewed_ratio?: number | null;
  };
  freshness: {
    level: 'Fresh' | 'Aging' | 'Stale' | 'No evidence';
    newest_evidence_at?: string | null;
  };
}

export interface GraphQuality {
  graph_id: string;
  health: 'HEALTHY' | 'NEEDS_ATTENTION' | 'POOR';
  stats: {
    concepts_total: number;
    missing_description_pct: number;
    no_evidence_pct: number;
    stale_evidence_pct: number;
    proposed_relationships_count: number;
  };
}

export async function getConceptQuality(
  conceptId: string,
  graphId?: string
): Promise<ConceptQuality> {
  const params = new URLSearchParams();
  if (graphId) {
    params.set('graph_id', graphId);
  }
  const res = await fetch(
    `${API_BASE_URL}/quality/concepts/${encodeURIComponent(conceptId)}?${params.toString()}`
  );
  if (!res.ok) {
    throw new Error(`Failed to get concept quality: ${res.statusText}`);
  }
  return res.json();
}

export async function getGraphQuality(graphId: string): Promise<GraphQuality> {
  const res = await fetch(`${API_BASE_URL}/quality/graphs/${encodeURIComponent(graphId)}`);
  if (!res.ok) {
    throw new Error(`Failed to get graph quality: ${res.statusText}`);
  }
  return res.json();
}

export interface NarrativeMetrics {
  recencyWeight: number;
  mentionFrequency: number;
  centralityDelta: number;
}

export interface NarrativeMetricsResponse {
  [conceptId: string]: NarrativeMetrics;
}

export async function getNarrativeMetrics(
  conceptIds: string[],
  graphId?: string
): Promise<NarrativeMetricsResponse> {
  if (conceptIds.length === 0) {
    return {};
  }
  const params = new URLSearchParams();
  if (graphId) {
    params.set('graph_id', graphId);
  }
  const res = await fetch(`${API_BASE_URL}/quality/narrative-metrics?${params.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ concept_ids: conceptIds }),
  });
  if (!res.ok) {
    throw new Error(`Failed to get narrative metrics: ${res.statusText}`);
  }
  return res.json();
}

// --- Graph Files API helpers ---

export interface GraphFile {
  name: string;
  path: string;
  size: number;
  size_formatted: string;
  modified: string;
  modified_formatted: string;
  type: string;
  description: string;
  graph_id?: string | null;
  graph_name?: string | null;
  recently_changed?: boolean;
}

export interface FilePreviewResponse {
  filename: string;
  total_lines: number;
  preview_lines: string[][];
  headers: string[] | null;
  previewed_lines: number;
}

export interface GraphFilesResponse {
  status: string;
  graph_dir?: string;
  files: GraphFile[];
  total_files: number;
  total_size: number;
  total_size_formatted: string;
  message?: string;
}

export async function getGraphFiles(): Promise<GraphFilesResponse> {
  const res = await fetch(`${API_BASE_URL}/admin/graph-files`);
  if (!res.ok) {
    throw new Error(`Failed to get graph files: ${res.statusText}`);
  }
  return res.json();
}

export async function previewGraphFile(filename: string, lines: number = 10): Promise<FilePreviewResponse> {
  const res = await fetch(`${API_BASE_URL}/admin/graph-files/preview/${encodeURIComponent(filename)}?lines=${lines}`);
  if (!res.ok) {
    throw new Error(`Failed to preview file: ${res.statusText}`);
  }
  return res.json();
}

export function downloadGraphFile(filename: string): void {
  const url = `${API_BASE_URL}/admin/graph-files/download/${encodeURIComponent(filename)}`;
  window.open(url, '_blank');
}

export async function triggerExport(perGraph: boolean = true): Promise<{ status: string; detail: string }> {
  const res = await fetch(`${API_BASE_URL}/admin/export?per_graph=${perGraph}`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(`Failed to trigger export: ${res.statusText}`);
  }
  return res.json();
}

// ---- Trails API ----

export interface TrailStep {
  step_id: string;
  index: number;
  kind: string;
  ref_id: string;
  title?: string | null;
  note?: string | null;
  meta?: Record<string, any> | null;
  created_at?: number | null;
}

export interface Trail {
  trail_id: string;
  title: string;
  status: string;
  pinned: boolean;
  created_at: number;
  updated_at: number;
  steps: TrailStep[];
}

export interface TrailSummary {
  trail_id: string;
  title: string;
  status: string;
  pinned: boolean;
  created_at: number;
  updated_at: number;
  step_count: number;
}

export async function listTrails(status?: string, limit: number = 10): Promise<{ trails: TrailSummary[] }> {
  const params = new URLSearchParams();
  if (status) params.append('status', status);
  params.append('limit', limit.toString());
  
  const res = await fetch(`${API_BASE_URL}/trails?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to list trails: ${res.statusText}`);
  }
  return res.json();
}

export async function getTrail(trailId: string): Promise<Trail> {
  const res = await fetch(`${API_BASE_URL}/trails/${trailId}`);
  if (!res.ok) {
    throw new Error(`Failed to get trail: ${res.statusText}`);
  }
  return res.json();
}

export async function createTrail(title: string, pinned: boolean = false): Promise<{ trail_id: string; title: string; status: string }> {
  const res = await fetch(`${API_BASE_URL}/trails/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, pinned }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create trail: ${res.statusText}`);
  }
  return res.json();
}

export async function resumeTrail(trailId: string): Promise<{ trail_id: string; status: string; last_step_id?: string; last_step_index?: number; last_step_kind?: string; last_step_ref_id?: string }> {
  const res = await fetch(`${API_BASE_URL}/trails/${trailId}/resume`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(`Failed to resume trail: ${res.statusText}`);
  }
  return res.json();
}

export async function archiveTrail(trailId: string): Promise<any> {
  const res = await fetch(`${API_BASE_URL}/trails/${trailId}/archive`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(`Failed to archive trail: ${res.statusText}`);
  }
  return res.json();
}

export async function appendTrailStep(
  trailId: string,
  kind: string,
  refId: string,
  title?: string,
  note?: string,
  meta?: Record<string, any>
): Promise<{ step_id: string; index: number }> {
  const res = await fetch(`${API_BASE_URL}/trails/${trailId}/append`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, ref_id: refId, title, note, meta }),
  });
  if (!res.ok) {
    throw new Error(`Failed to append step: ${res.statusText}`);
  }
  return res.json();
}

// ---- Voice API ----

export interface VoiceCaptureRequest {
  transcript: string;
  block_id?: string;
  concept_id?: string;
  classification?: 'reflection' | 'confusion' | 'explanation';
  document_id?: string;
}

export interface VoiceCommandRequest {
  transcript: string;
  intent: 'generate_answers' | 'summarize' | 'explain' | 'gap_analysis' | 'retrieve_context' | 'extract_concepts';
  params?: Record<string, any>;
  document_id?: string;
  block_id?: string;
  concept_id?: string;
}

export interface VoiceCommandResponse {
  status: string;
  signal_id: string;
  task_id: string;
  task_type: string;
  message: string;
}

// Signal interface moved below to merge with complete definition

/**
 * Send voice capture (Mode A: Passive transcription for learning state)
 */
export async function sendVoiceCapture(payload: VoiceCaptureRequest): Promise<Signal> {
  const res = await fetch(`${API_BASE_URL}/voice/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to send voice capture: ${res.statusText} - ${errorText}`);
  }
  return res.json();
}

/**
 * Send voice command (Mode B: Active control for system orchestration)
 */
export async function sendVoiceCommand(payload: VoiceCommandRequest): Promise<VoiceCommandResponse> {
  const res = await fetch(`${API_BASE_URL}/voice/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to send voice command: ${res.statusText} - ${errorText}`);
  }
  return res.json();
}

/**
 * Get task status
 */
// ---- Smart Scheduler API ----

export interface Task {
  id: string;
  title: string;
  notes?: string | null;
  estimated_minutes: number;
  due_date?: string | null;
  priority: string;
  energy: string;
  tags: string[];
  preferred_time_windows?: string[] | null;
  dependencies: string[];
  location?: string | null;
  location_lat?: number | null;
  location_lon?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface TaskCreate {
  title: string;
  notes?: string | null;
  estimated_minutes: number;
  due_date?: string | null;
  priority?: string;
  energy?: string;
  tags?: string[] | null;
  preferred_time_windows?: string[] | null;
  dependencies?: string[] | null;
  location?: string | null;
  location_lat?: number | null;
  location_lon?: number | null;
}

export interface TaskUpdate {
  title?: string | null;
  notes?: string | null;
  estimated_minutes?: number | null;
  due_date?: string | null;
  priority?: string | null;
  energy?: string | null;
  tags?: string[] | null;
  preferred_time_windows?: string[] | null;
  dependencies?: string[] | null;
  location?: string | null;
  location_lat?: number | null;
  location_lon?: number | null;
}

export interface PlanSuggestion {
  id: string;
  task_id: string;
  task_title: string;
  start: string;
  end: string;
  confidence: number;
  reasons: string[];
  status: string;
  created_at?: string | null;
}

export interface SuggestionGroupedByDay {
  date: string;
  suggestions: PlanSuggestion[];
}

export interface SuggestionsResponse {
  suggestions_by_day: SuggestionGroupedByDay[];
  total: number;
}

export interface FreeBlock {
  start: string;
  end: string;
  duration_minutes: number;
  date: string;
}

export interface FreeBlocksResponse {
  blocks: FreeBlock[];
  total: number;
}

export interface TaskListResponse {
  tasks: Task[];
  total: number;
}

/**
 * List tasks
 */
export async function listTasks(rangeDays: number = 7): Promise<TaskListResponse> {
  const headers = await getApiHeaders();
  const response = await fetch(`${API_BASE_URL}/tasks?range=${rangeDays}`, { headers });
  if (!response.ok) {
    throw new Error(`Failed to list tasks: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Create a task
 */
export async function createTask(payload: TaskCreate): Promise<Task> {
  const headers = await getApiHeaders();
  const response = await fetch(`${API_BASE_URL}/tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create task: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Update a task
 */
export async function updateTask(taskId: string, payload: TaskUpdate): Promise<Task> {
  const headers = await getApiHeaders();
  const response = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update task: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Delete a task
 */
export async function deleteTask(taskId: string): Promise<{ status: string; task_id: string }> {
  const headers = await getApiHeaders();
  const response = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to delete task: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * List free time blocks
 */
export async function listFreeBlocks(start: string, end: string): Promise<FreeBlocksResponse> {
  const headers = await getApiHeaders();
  const response = await fetch(`${API_BASE_URL}/schedule/free-blocks?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, { headers });
  if (!response.ok) {
    throw new Error(`Failed to list free blocks: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Generate plan suggestions
 */
export async function generateSuggestions(start: string, end: string): Promise<SuggestionsResponse> {
  const headers = await getApiHeaders();
  const response = await fetch(`${API_BASE_URL}/schedule/suggestions?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
    method: 'POST',
    headers,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to generate suggestions: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * List existing suggestions
 */
export async function listSuggestions(start: string, end: string): Promise<SuggestionsResponse> {
  const headers = await getApiHeaders();
  const response = await fetch(`${API_BASE_URL}/schedule/suggestions?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, { headers });
  if (!response.ok) {
    throw new Error(`Failed to list suggestions: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Accept a suggestion
 */
export async function acceptSuggestion(suggestionId: string): Promise<{ status: string; suggestion_id: string }> {
  const headers = await getApiHeaders();
  const response = await fetch(`${API_BASE_URL}/schedule/suggestions/${suggestionId}/accept`, {
    method: 'POST',
    headers,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to accept suggestion: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Reject a suggestion
 */
export async function rejectSuggestion(suggestionId: string): Promise<{ status: string; suggestion_id: string }> {
  const headers = await getApiHeaders();
  const response = await fetch(`${API_BASE_URL}/schedule/suggestions/${suggestionId}/reject`, {
    method: 'POST',
    headers,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to reject suggestion: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

/**
 * Mark a suggestion as completed
 */
export async function completeSuggestion(suggestionId: string): Promise<{ status: string; suggestion_id: string }> {
  const headers = await getApiHeaders();
  const response = await fetch(`${API_BASE_URL}/schedule/suggestions/${suggestionId}/complete`, {
    method: 'POST',
    headers,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to complete suggestion: ${response.statusText} - ${errorText}`);
  }
  return response.json();
}

export interface BackgroundTask {
  task_id: string;
  task_type: string;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'CANCELLED';
  created_at: number;
  started_at?: number;
  completed_at?: number;
  result?: Record<string, any>;
  error?: string;
}

export async function getTask(taskId: string): Promise<BackgroundTask> {
  const res = await fetch(`${API_BASE_URL}/tasks/${taskId}`);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to get task: ${res.statusText} - ${errorText}`);
  }
  return res.json();
}

// ---- Signals API ----

export type SignalType = 
  | 'TEXT_AUTHORING'
  | 'SPAN_LINK'
  | 'EMPHASIS'
  | 'FILE_INGESTION'
  | 'VOICE_CAPTURE'
  | 'VOICE_COMMAND'
  | 'QUESTION'
  | 'TIME'
  | 'ASSESSMENT';

export interface Signal {
  signal_id: string;
  signal_type: SignalType;
  timestamp: number; // Unix timestamp in milliseconds
  graph_id: string;
  branch_id: string;
  document_id?: string | null;
  block_id?: string | null;
  concept_id?: string | null;
  payload: Record<string, any>;
  session_id?: string | null;
  user_id?: string | null;
  created_at?: string | null; // ISO timestamp
}

export interface SignalListResponse {
  signals: Signal[];
  total: number;
}

export interface ListSignalsOptions {
  signal_type?: SignalType;
  document_id?: string;
  block_id?: string;
  concept_id?: string;
  limit?: number;
  offset?: number;
}

export async function listSignals(options: ListSignalsOptions = {}): Promise<SignalListResponse> {
  const params = new URLSearchParams();
  if (options.signal_type) params.append('signal_type', options.signal_type);
  if (options.document_id) params.append('document_id', options.document_id);
  if (options.block_id) params.append('block_id', options.block_id);
  if (options.concept_id) params.append('concept_id', options.concept_id);
  if (options.limit) params.append('limit', options.limit.toString());
  if (options.offset) params.append('offset', options.offset.toString());

  const res = await fetch(`${API_BASE_URL}/signals/?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to list signals: ${res.statusText}`);
  }
  return res.json();
}

// ---- Workflows API ----

export interface WorkflowStatus {
  available: boolean;
  types: string[];
  graph_id: string;
  branch_id: string;
}

export interface WorkflowStatusResponse {
  capture: WorkflowStatus;
  explore: WorkflowStatus;
  synthesize: WorkflowStatus;
}

export async function getWorkflowStatus(): Promise<WorkflowStatusResponse> {
  const res = await fetch(`${API_BASE_URL}/workflows/status`);
  if (!res.ok) {
    throw new Error(`Failed to get workflow status: ${res.statusText}`);
  }
  return res.json();
}

// ---- Calendar API ----

export interface CalendarEvent {
  event_id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  start_date: string; // ISO date string (YYYY-MM-DD)
  end_date?: string | null; // ISO date string (YYYY-MM-DD)
  start_time?: string | null; // ISO time string (HH:MM) or full datetime
  end_time?: string | null; // ISO time string (HH:MM) or full datetime
  all_day: boolean;
  color?: string | null; // Hex color code
  created_at?: string | null; // ISO timestamp
  updated_at?: string | null; // ISO timestamp
}

export interface CalendarEventCreate {
  title: string;
  description?: string | null;
  location?: string | null;
  start_date: string;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  all_day?: boolean;
  color?: string | null;
}

export interface CalendarEventUpdate {
  title?: string | null;
  description?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  all_day?: boolean | null;
  color?: string | null;
}

export interface CalendarEventListResponse {
  events: CalendarEvent[];
  total: number;
}

export interface ListCalendarEventsOptions {
  start_date?: string; // YYYY-MM-DD
  end_date?: string; // YYYY-MM-DD
}

export async function listCalendarEvents(options: ListCalendarEventsOptions = {}): Promise<CalendarEventListResponse> {
  const params = new URLSearchParams();
  if (options.start_date) params.append('start_date', options.start_date);
  if (options.end_date) params.append('end_date', options.end_date);

  const headers = await getApiHeaders();
  const res = await fetch(`${API_BASE_URL}/calendar/events?${params.toString()}`, {
    headers,
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to list calendar events: ${res.statusText} - ${errorText}`);
  }
  return res.json();
}

export async function getCalendarEvent(eventId: string): Promise<CalendarEvent> {
  const headers = await getApiHeaders();
  const res = await fetch(`${API_BASE_URL}/calendar/events/${eventId}`, {
    headers,
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to get calendar event: ${res.statusText} - ${errorText}`);
  }
  return res.json();
}

export async function createCalendarEvent(event: CalendarEventCreate): Promise<CalendarEvent> {
  const headers = await getApiHeaders();
  const res = await fetch(`${API_BASE_URL}/calendar/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to create calendar event: ${res.statusText} - ${errorText}`);
  }
  return res.json();
}

export async function updateCalendarEvent(eventId: string, event: CalendarEventUpdate): Promise<CalendarEvent> {
  const headers = await getApiHeaders();
  const res = await fetch(`${API_BASE_URL}/calendar/events/${eventId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(event),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to update calendar event: ${res.statusText} - ${errorText}`);
  }
  return res.json();
}

export async function deleteCalendarEvent(eventId: string): Promise<{ status: string; event_id: string }> {
  const headers = await getApiHeaders();
  const res = await fetch(`${API_BASE_URL}/calendar/events/${eventId}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to delete calendar event: ${res.statusText} - ${errorText}`);
  }
  return res.json();
}

export interface LocationSuggestion {
  name: string;
  full_address?: string | null; // Full address for geocoded locations
  distance?: number | null; // Distance in miles
  lat?: number;
  lon?: number;
  type?: string; // "geocoded" for real locations, "common" for predefined
}

export interface LocationSuggestionsResponse {
  suggestions: LocationSuggestion[];
}

export interface GetLocationSuggestionsOptions {
  query?: string;
  context?: string; // e.g., 'purdue', 'default'
  currentLat?: number;
  currentLon?: number;
}

export async function getLocationSuggestions(options: GetLocationSuggestionsOptions = {}): Promise<LocationSuggestionsResponse> {
  const params = new URLSearchParams();
  if (options.query) params.append('query', options.query);
  if (options.context) params.append('context', options.context);
  if (options.currentLat !== undefined) params.append('current_lat', options.currentLat.toString());
  if (options.currentLon !== undefined) params.append('current_lon', options.currentLon.toString());

  // Location suggestions work without auth, but include it if available
  const headers = await getApiHeaders();
  const res = await fetch(`${API_BASE_URL}/calendar/locations/suggestions?${params.toString()}`, {
    headers,
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Failed to get location suggestions: ${res.statusText} - ${errorText}`);
  }
  return res.json();
}
