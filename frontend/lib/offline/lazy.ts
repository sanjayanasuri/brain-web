/**
 * Lazy loaders for offline API wrapper. Call these when offline or as fallback
 * so the full api_wrapper (and its deps) are not pulled into the main bundle until needed.
 */

type GetResourcesForConceptOffline = (conceptId: string) => Promise<any[]>;
type GetGraphDataOffline = () => Promise<any | null>;
type GetConceptOffline = (nodeId: string) => Promise<any | null>;

let _resources: GetResourcesForConceptOffline | null = null;
let _graph: GetGraphDataOffline | null = null;
let _concept: GetConceptOffline | null = null;

export async function getResourcesForConceptOfflineLazy(): Promise<GetResourcesForConceptOffline> {
  if (_resources) return _resources;
  const m = await import('./api_wrapper');
  _resources = m.getResourcesForConceptOffline;
  return _resources;
}

export async function getGraphDataOfflineLazy(): Promise<GetGraphDataOffline> {
  if (_graph) return _graph;
  const m = await import('./api_wrapper');
  _graph = m.getGraphDataOffline;
  return _graph;
}

export async function getConceptOfflineLazy(): Promise<GetConceptOffline> {
  if (_concept) return _concept;
  const m = await import('./api_wrapper');
  _concept = m.getConceptOffline;
  return _concept;
}
