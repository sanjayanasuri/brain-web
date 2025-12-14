/**
 * API client for communicating with the Brain Web backend
 */

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

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
  }>;
}

// ---- Branch Explorer: Graph Collections (Graphs) ----

export interface GraphSummary {
  graph_id: string;
  name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
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

export async function listGraphs(): Promise<GraphListResponse> {
  try {
    const res = await fetch(`${API_BASE_URL}/graphs/`);
    if (!res.ok) {
      // In demo mode, return default graph if endpoint is blocked
      if (res.status === 403 || res.status === 404) {
        return { active_graph_id: 'demo', active_branch_id: 'main', graphs: [{ graph_id: 'demo', name: 'Demo' }] };
      }
      throw new Error(`Failed to list graphs: ${res.statusText}`);
    }
    return res.json();
  } catch (error) {
    console.error('Error fetching graphs:', error);
    // Return demo graph as fallback
    return { active_graph_id: 'demo', active_branch_id: 'main', graphs: [{ graph_id: 'demo', name: 'Demo' }] };
  }
}

export async function createGraph(name: string): Promise<GraphSelectResponse> {
  const res = await fetch(`${API_BASE_URL}/graphs/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
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
      // In demo mode, return default branch if endpoint is blocked
      if (res.status === 403 || res.status === 404) {
        return { graph_id: 'demo', active_branch_id: 'main', branches: [{ branch_id: 'main', name: 'Main' }] };
      }
      throw new Error(`Failed to list branches: ${res.statusText}`);
    }
    return res.json();
  } catch (error) {
    console.error('Error fetching branches:', error);
    // Return default branch as fallback
    return { graph_id: 'demo', active_branch_id: 'main', branches: [{ branch_id: 'main', name: 'Main' }] };
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
  const response = await fetch(`${API_BASE_URL}/concepts/${nodeId}`);
  if (!response.ok) {
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
 */
export async function fetchGraphData(rootNodeId: string, maxDepth: number = 2): Promise<GraphData> {
  const nodes = new Map<string, Concept>();
  const links: Array<{ source: string; target: string; predicate: string }> = [];
  const linkSet = new Set<string>(); // Track links to avoid duplicates
  const visited = new Set<string>();

  async function fetchNodeAndNeighbors(nodeId: string, depth: number) {
    if (depth > maxDepth || visited.has(nodeId)) {
      return;
    }
    visited.add(nodeId);

    try {
      // Fetch the node
      const node = await getConcept(nodeId);
      nodes.set(nodeId, node);

      // Fetch neighbors with relationships
      const neighborsWithRels = await getNeighborsWithRelationships(nodeId);
      
      for (const { concept, predicate, is_outgoing } of neighborsWithRels) {
        nodes.set(concept.node_id, concept);
        
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
          });
        }

        // Recursively fetch neighbors if we haven't reached max depth
        if (depth < maxDepth) {
          await fetchNodeAndNeighbors(concept.node_id, depth + 1);
        }
      }
    } catch (error) {
      console.error(`Error fetching node ${nodeId}:`, error);
    }
  }

  await fetchNodeAndNeighbors(rootNodeId, 0);

  return {
    nodes: Array.from(nodes.values()),
    links,
  };
}

/**
 * Fetch all graph data (nodes and relationships)
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
      })),
    };
  } catch (error) {
    console.error('Error fetching graph data:', error);
    // Return empty graph data instead of throwing to prevent UI crashes
    return { nodes: [], links: [] };
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
 * Create a new concept
 */
export async function createConcept(concept: {
  name: string;
  domain: string;
  type?: string;
  notes_key?: string | null;
  lecture_key?: string | null;
  url_slug?: string | null;
}): Promise<Concept> {
  const response = await fetch(`${API_BASE_URL}/concepts/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(concept),
  });
  if (!response.ok) {
    throw new Error(`Failed to create concept: ${response.statusText}`);
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

/**
 * Lecture ingestion response type
 */
export interface NotionSyncHistory {
  last_sync: string | null;
  recent_pages: Array<{
    page_id: string;
    page_title: string;
    last_ingested_at: string | null;
    lecture_ids: string[];
    status: 'synced' | 'not_synced';
  }>;
  total_pages?: number;
}

export async function getNotionSyncHistory(limit: number = 10): Promise<NotionSyncHistory> {
  const res = await fetch(`${API_BASE_URL}/admin/notion/sync-history?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to load Notion sync history');
  return res.json();
}

export async function triggerNotionSync(forceFull: boolean = false): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/admin/sync-notion?force_full=${forceFull}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error('Failed to trigger Notion sync');
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
  lecture_id: string;
  title: string;
  description?: string | null;
  primary_concept?: string | null;
  level?: string | null;
  estimated_time?: number | null;
  slug?: string | null;
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
 * Ingest all Notion pages
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
}

/**
 * Fetch all resources attached to a concept
 */
export async function getResourcesForConcept(conceptId: string): Promise<Resource[]> {
  const res = await fetch(`${API_BASE_URL}/resources/by-concept/${encodeURIComponent(conceptId)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch resources for concept ${conceptId}: ${res.statusText}`);
  }
  return res.json();
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

