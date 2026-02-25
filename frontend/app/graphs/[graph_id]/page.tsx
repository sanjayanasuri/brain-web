'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  listGraphs,
  listGraphConcepts,
  getGraphRefreshDefaults,
  updateGraphRefreshDefaults,
  type GraphSummary,
  type GraphConceptItem,
  type RefreshBindingConfig,
  type RefreshCheckConfig,
} from '../../api-client';
import GlassCard from '@/app/components/ui/GlassCard';
import Button from '@/app/components/ui/Button';
import Badge from '@/app/components/ui/Badge';
import { Input, Select } from '@/app/components/ui/Input';

const PINNED_CONCEPTS_KEY = 'brainweb:pinnedConcepts';

function getPinnedConcepts(graphId: string): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(`${PINNED_CONCEPTS_KEY}:${graphId}`);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

function togglePinConcept(graphId: string, conceptId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const pinned = getPinnedConcepts(graphId);
    const isPinned = pinned.includes(conceptId);
    if (isPinned) {
      const updated = pinned.filter(id => id !== conceptId);
      localStorage.setItem(`${PINNED_CONCEPTS_KEY}:${graphId}`, JSON.stringify(updated));
    } else {
      const updated = [...pinned, conceptId];
      localStorage.setItem(`${PINNED_CONCEPTS_KEY}:${graphId}`, JSON.stringify(updated));
    }
  } catch {
    // Ignore errors
  }
}

function isConceptPinned(graphId: string, conceptId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const pinned = getPinnedConcepts(graphId);
    return pinned.includes(conceptId);
  } catch {
    return false;
  }
}

function cloneRefreshConfig(config?: RefreshBindingConfig | null): RefreshBindingConfig {
  const base: RefreshBindingConfig = config || {
    version: 1,
    enabled: false,
    inherit_workspace_defaults: true,
    triggers: ['manual'],
    ttl_seconds: 3600,
    checks: [],
  };
  return {
    version: base.version || 1,
    enabled: Boolean(base.enabled),
    inherit_workspace_defaults: base.inherit_workspace_defaults ?? true,
    triggers: Array.isArray(base.triggers) ? [...base.triggers] : ['manual'],
    ttl_seconds: typeof base.ttl_seconds === 'number' ? base.ttl_seconds : 3600,
    checks: Array.isArray(base.checks)
      ? base.checks.map((check) => ({
          check_id: check.check_id || null,
          kind: check.kind || 'exa_answer',
          query: check.query || '',
          title: check.title || '',
          enabled: check.enabled ?? true,
          params: check.params ? { ...check.params } : {},
        }))
      : [],
  };
}

function createWorkspaceRefreshCheck(): RefreshCheckConfig {
  return {
    check_id: `wrk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    kind: 'exa_answer',
    title: 'Workspace update check',
    query: 'latest updates about {{concept_name}}',
    enabled: true,
    params: { max_age_hours: 24 },
  };
}

const TEMPLATE_BLUEPRINTS = [
  {
    id: 'person_research',
    label: 'Person Research',
    description: 'Each node is a person. Track role changes, public activity, affiliations, and mentions.',
    defaultNodeTypes: ['Person', 'Organization', 'Project', 'Event'],
    defaultChecks: [
      'Recent mentions (Exa news)',
      'Role/org changes (Exa answer)',
      'Web search context (optional)',
    ],
    connectionPatterns: [
      'Person -> Organization (works_at, founded, joined, left)',
      'Person -> Event (spoke_at, attended, announced)',
      'Person -> Person (collaborated_with, reports_to)',
    ],
  },
  {
    id: 'company_research',
    label: 'Company Research',
    description: 'Track companies, products, competitors, leadership, and market context.',
    defaultNodeTypes: ['Company', 'Ticker', 'Product', 'Executive', 'Supplier', 'Competitor'],
    defaultChecks: [
      'Live metric snapshot (structured)',
      'Company headlines (Exa news)',
      'Org changes / strategic updates (Exa answer)',
    ],
    connectionPatterns: [
      'Company -> Company (competes_with, acquires, partners_with)',
      'Company -> Product (ships, discontinues)',
      'Executive -> Company (joins, leaves, leads)',
    ],
  },
  {
    id: 'news_event_research',
    label: 'News / Event Research',
    description: 'Track events, timelines, narratives, and the entities involved.',
    defaultNodeTypes: ['Event', 'Organization', 'Person', 'Location', 'Claim'],
    defaultChecks: [
      'Topic headline feed (Exa news)',
      'What changed summary (Exa answer)',
      'Supporting pages / background (search & fetch)',
    ],
    connectionPatterns: [
      'Event -> Organization (involves, affects)',
      'Event -> Person (announced_by, impacted)',
      'Claim -> Event (supports, disputes)',
    ],
  },
] as const;

function MiniBlueprintMap({
  nodeLabels,
  accent = '#0ea5e9',
}: {
  nodeLabels: readonly string[];
  accent?: string;
}) {
  const labels = (nodeLabels || []).slice(0, 6);
  const points = [
    { x: 30, y: 30 },
    { x: 110, y: 20 },
    { x: 190, y: 35 },
    { x: 55, y: 95 },
    { x: 145, y: 100 },
    { x: 100, y: 60 },
  ];

  return (
    <svg
      viewBox="0 0 220 130"
      width="100%"
      height="130"
      style={{
        display: 'block',
        borderRadius: '10px',
        background: 'rgba(255,255,255,0.55)',
        border: '1px solid var(--border)',
      }}
    >
      {labels.map((_, i) => {
        if (i === 0) return null;
        const a = points[0];
        const b = points[i];
        return (
          <line
            key={`edge-${i}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="rgba(100,116,139,0.45)"
            strokeWidth="1.5"
          />
        );
      })}
      {labels.length >= 4 && (
        <line
          x1={points[1].x}
          y1={points[1].y}
          x2={points[3].x}
          y2={points[3].y}
          stroke="rgba(100,116,139,0.35)"
          strokeWidth="1.2"
        />
      )}
      {labels.length >= 5 && (
        <line
          x1={points[2].x}
          y1={points[2].y}
          x2={points[4].x}
          y2={points[4].y}
          stroke="rgba(100,116,139,0.35)"
          strokeWidth="1.2"
        />
      )}

      {labels.map((label, i) => (
        <g key={`node-${i}`} transform={`translate(${points[i].x},${points[i].y})`}>
          <circle
            r={i === 0 ? 13 : 10}
            fill={i === 0 ? accent : 'white'}
            stroke={i === 0 ? accent : 'rgba(100,116,139,0.45)'}
            strokeWidth="1.5"
          />
          <text
            x={0}
            y={i === 0 ? 27 : 23}
            textAnchor="middle"
            style={{ fontSize: '8px', fill: 'var(--muted)', fontFamily: 'var(--font-mono)' }}
          >
            {label.length > 12 ? `${label.slice(0, 12)}…` : label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function GraphBrowserPage() {
  const params = useParams();
  const router = useRouter();
  const graphId = params?.graph_id as string;

  const [graph, setGraph] = useState<GraphSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'browse' | 'pinned' | 'settings' | 'template'>('browse');

  // Browse tab state
  const [concepts, setConcepts] = useState<GraphConceptItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingConcepts, setLoadingConcepts] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [domainFilter, setDomainFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [sortBy, setSortBy] = useState<'alphabetical' | 'degree' | 'recent'>('alphabetical');
  const [page, setPage] = useState(0);
  const [domains, setDomains] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const pageSize = 50;

  // Pinned tab state
  const [pinnedConceptIds, setPinnedConceptIds] = useState<string[]>([]);
  const [pinnedConcepts, setPinnedConcepts] = useState<GraphConceptItem[]>([]);
  const [loadingPinned, setLoadingPinned] = useState(false);

  // Workspace refresh settings tab state
  const [refreshDefaults, setRefreshDefaults] = useState<RefreshBindingConfig | null>(null);
  const [refreshDefaultsDraft, setRefreshDefaultsDraft] = useState<RefreshBindingConfig | null>(null);
  const [refreshDefaultsLoading, setRefreshDefaultsLoading] = useState(false);
  const [refreshDefaultsSaving, setRefreshDefaultsSaving] = useState(false);
  const [refreshDefaultsError, setRefreshDefaultsError] = useState<string | null>(null);
  const [refreshDefaultsDirty, setRefreshDefaultsDirty] = useState(false);
  const [refreshParamsJson, setRefreshParamsJson] = useState<Record<string, string>>({});
  const [refreshParamsErrors, setRefreshParamsErrors] = useState<Record<string, string>>({});

  // Load graph info
  useEffect(() => {
    async function loadGraph() {
      try {
        setLoading(true);
        const data = await listGraphs();
        const foundGraph = data.graphs?.find(g => g.graph_id === graphId);
        if (!foundGraph) {
          console.error('Graph not found:', graphId);
          return;
        }
        setGraph(foundGraph);
      } catch (err) {
        console.error('Failed to load graph:', err);
      } finally {
        setLoading(false);
      }
    }
    loadGraph();
  }, [graphId]);

  const loadWorkspaceRefreshDefaults = useCallback(async () => {
    if (!graphId) return;
    try {
      setRefreshDefaultsLoading(true);
      setRefreshDefaultsError(null);
      const response = await getGraphRefreshDefaults(graphId);
      const cfg = cloneRefreshConfig(response.refresh_defaults);
      setRefreshDefaults(cfg);
      setRefreshDefaultsDraft(cloneRefreshConfig(cfg));
      setRefreshDefaultsDirty(false);
      const nextJson: Record<string, string> = {};
      for (const check of cfg.checks || []) {
        const key = check.check_id || '';
        if (!key) continue;
        try {
          nextJson[key] = JSON.stringify(check.params || {}, null, 2);
        } catch {
          nextJson[key] = '{}';
        }
      }
      setRefreshParamsJson(nextJson);
      setRefreshParamsErrors({});
    } catch (err) {
      console.error('Failed to load workspace refresh defaults:', err);
      setRefreshDefaultsError(err instanceof Error ? err.message : 'Failed to load workspace refresh defaults');
      setRefreshDefaults(null);
      setRefreshDefaultsDraft(null);
    } finally {
      setRefreshDefaultsLoading(false);
    }
  }, [graphId]);

  useEffect(() => {
    void loadWorkspaceRefreshDefaults();
  }, [loadWorkspaceRefreshDefaults]);

  const updateRefreshDefaultsDraft = (updater: (prev: RefreshBindingConfig) => RefreshBindingConfig) => {
    setRefreshDefaultsDraft((prev) => {
      const base = cloneRefreshConfig(prev || refreshDefaults || null);
      return cloneRefreshConfig(updater(base));
    });
    setRefreshDefaultsDirty(true);
  };

  const toggleWorkspaceTrigger = (trigger: 'manual' | 'on_open' | 'scheduled') => {
    updateRefreshDefaultsDraft((draft) => {
      const set = new Set(Array.isArray(draft.triggers) ? draft.triggers : []);
      if (set.has(trigger)) set.delete(trigger);
      else set.add(trigger);
      if (set.size === 0) set.add('manual');
      return { ...draft, triggers: Array.from(set) };
    });
  };

  const updateWorkspaceCheck = (
    checkId: string | null | undefined,
    updater: (check: RefreshCheckConfig) => RefreshCheckConfig
  ) => {
    updateRefreshDefaultsDraft((draft) => ({
      ...draft,
      checks: (draft.checks || []).map((check) => {
        if ((check.check_id || null) !== (checkId || null)) return check;
        return updater({ ...check, params: check.params ? { ...check.params } : {} });
      }),
    }));
  };

  const removeWorkspaceCheck = (checkId: string | null | undefined) => {
    updateRefreshDefaultsDraft((draft) => ({
      ...draft,
      checks: (draft.checks || []).filter((check) => (check.check_id || null) !== (checkId || null)),
    }));
    const key = checkId || '';
    if (key) {
      setRefreshParamsJson((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setRefreshParamsErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const addWorkspaceCheck = () => {
    const check = createWorkspaceRefreshCheck();
    updateRefreshDefaultsDraft((draft) => ({
      ...draft,
      checks: [...(draft.checks || []), check],
    }));
    const key = check.check_id || '';
    if (key) {
      setRefreshParamsJson((prev) => ({ ...prev, [key]: JSON.stringify(check.params || {}, null, 2) }));
      setRefreshParamsErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const resetWorkspaceRefreshDefaultsDraft = () => {
    const next = cloneRefreshConfig(refreshDefaults);
    setRefreshDefaultsDraft(next);
    setRefreshDefaultsDirty(false);
    const nextJson: Record<string, string> = {};
    for (const check of next.checks || []) {
      const key = check.check_id || '';
      if (!key) continue;
      try {
        nextJson[key] = JSON.stringify(check.params || {}, null, 2);
      } catch {
        nextJson[key] = '{}';
      }
    }
    setRefreshParamsJson(nextJson);
    setRefreshParamsErrors({});
  };

  const saveWorkspaceRefreshDefaults = async () => {
    if (!graphId || !refreshDefaultsDraft) return;
    if (Object.values(refreshParamsErrors).some(Boolean)) {
      setRefreshDefaultsError('Fix invalid JSON in advanced check params before saving');
      return;
    }
    try {
      setRefreshDefaultsSaving(true);
      setRefreshDefaultsError(null);
      const normalized = cloneRefreshConfig(refreshDefaultsDraft);
      normalized.ttl_seconds = Math.max(30, Math.min(7 * 24 * 3600, Number(normalized.ttl_seconds || 3600)));
      if (!Array.isArray(normalized.triggers) || normalized.triggers.length === 0) normalized.triggers = ['manual'];
      const response = await updateGraphRefreshDefaults(graphId, normalized);
      const saved = cloneRefreshConfig(response.refresh_defaults);
      setRefreshDefaults(saved);
      setRefreshDefaultsDraft(cloneRefreshConfig(saved));
      setRefreshDefaultsDirty(false);
    } catch (err) {
      console.error('Failed to save workspace refresh defaults:', err);
      setRefreshDefaultsError(err instanceof Error ? err.message : 'Failed to save workspace refresh defaults');
    } finally {
      setRefreshDefaultsSaving(false);
    }
  };

  // Load concepts for browse tab
  const loadConcepts = useCallback(async () => {
    if (!graphId) return;
    try {
      setLoadingConcepts(true);
      const response = await listGraphConcepts(graphId, {
        query: searchQuery || undefined,
        domain: domainFilter || undefined,
        type: typeFilter || undefined,
        sort: sortBy,
        limit: pageSize,
        offset: page * pageSize,
      });
      setConcepts(response.items);
      setTotal(response.total);

      // Extract unique domains and types for filters
      const uniqueDomains = new Set<string>();
      const uniqueTypes = new Set<string>();
      response.items.forEach(item => {
        if (item.domain) uniqueDomains.add(item.domain);
        if (item.type) uniqueTypes.add(item.type);
      });
      setDomains(Array.from(uniqueDomains).sort());
      setTypes(Array.from(uniqueTypes).sort());
    } catch (err) {
      console.error('Failed to load concepts:', err);
      setConcepts([]);
      setTotal(0);
    } finally {
      setLoadingConcepts(false);
    }
  }, [graphId, searchQuery, domainFilter, typeFilter, sortBy, page]);

  useEffect(() => {
    loadConcepts();
  }, [loadConcepts]);

  // Load pinned concepts
  const loadPinnedConcepts = useCallback(async () => {
    if (!graphId) return;
    try {
      setLoadingPinned(true);
      const pinnedIds = getPinnedConcepts(graphId);
      setPinnedConceptIds(pinnedIds);

      if (pinnedIds.length === 0) {
        setPinnedConcepts([]);
        return;
      }

      // Fetch all concepts and filter to pinned ones
      const response = await listGraphConcepts(graphId, {
        limit: 500,
      });

      // Filter to only pinned concepts, maintaining order
      const pinnedMap = new Map(pinnedIds.map(id => [id, true]));
      const pinned = response.items
        .filter(item => pinnedMap.has(item.concept_id))
        .sort((a, b) => {
          const indexA = pinnedIds.indexOf(a.concept_id);
          const indexB = pinnedIds.indexOf(b.concept_id);
          return indexA - indexB;
        });
      setPinnedConcepts(pinned);
    } catch (err) {
      console.error('Failed to load pinned concepts:', err);
      setPinnedConcepts([]);
    } finally {
      setLoadingPinned(false);
    }
  }, [graphId]);

  useEffect(() => {
    if (activeTab === 'pinned') {
      loadPinnedConcepts();
    }
  }, [activeTab, loadPinnedConcepts]);

  const handleOpenInExplorer = (conceptId: string) => {
    const params = new URLSearchParams();
    params.set('graph_id', graphId);
    params.set('concept_id', conceptId);
    router.push(`/?${params.toString()}`);
  };

  const handleTogglePin = (conceptId: string) => {
    togglePinConcept(graphId, conceptId);
    if (activeTab === 'pinned') {
      loadPinnedConcepts();
    } else {
      // Also update local state for the browse tab immediately
      // Force re-render to update the pin icon
      setPinnedConceptIds(getPinnedConcepts(graphId));
    }
  };

  const formatRelativeTime = (isoString: string | null | undefined): string => {
    if (!isoString) return 'unknown';
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);

      if (diffMins < 1) return 'just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 7) return `${diffDays}d ago`;
      const diffWeeks = Math.floor(diffDays / 7);
      if (diffWeeks < 4) return `${diffWeeks}w ago`;
      const diffMonths = Math.floor(diffDays / 30);
      return `${diffMonths}mo ago`;
    } catch {
      return 'unknown';
    }
  };

  if (loading) {
    return (
      <div style={{ padding: '48px', textAlign: 'center' }}>
        <div style={{ color: 'var(--muted)', fontSize: '15px' }}>Loading graph details...</div>
      </div>
    );
  }

  if (!graph) {
    return (
      <div style={{ padding: '48px', maxWidth: '600px', margin: '0 auto' }}>
        <GlassCard>
          <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Graph not found</h1>
          <p style={{ marginBottom: '24px', color: 'var(--muted)' }}>The requested graph could not be found.</p>
          <Link href="/home">
            <Button variant="secondary">← Back to Home</Button>
          </Link>
        </GlassCard>
      </div>
    );
  }

  const nodes = graph.node_count ?? 0;
  const edges = graph.edge_count ?? 0;
  const updated = formatRelativeTime(graph.updated_at);
  const hasWorkspaceParamErrors = Object.values(refreshParamsErrors).some(Boolean);
  const focusedBlueprintId =
    graph.template_id === 'person_research'
      ? 'person_research'
      : graph.template_id === 'stock_research'
        ? 'company_research'
        : graph.template_id === 'news_tracking'
          ? 'news_event_research'
          : null;

  const workspaceSettingsContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <GlassCard>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '20px', fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>
              Workspace Refresh Defaults
            </h2>
            <p style={{ marginTop: '8px', marginBottom: 0, color: 'var(--muted)', fontSize: '13px' }}>
              These defaults apply to nodes that enable "inherit workspace defaults". Use <code>{'{{concept_name}}'}</code> in checks for reusable template behavior.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            {refreshDefaultsDirty && <Badge variant="neutral">Unsaved changes</Badge>}
            <Button variant="secondary" size="sm" onClick={resetWorkspaceRefreshDefaultsDraft} disabled={!refreshDefaultsDirty || refreshDefaultsSaving}>
              Reset
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={saveWorkspaceRefreshDefaults}
              disabled={!refreshDefaultsDirty || refreshDefaultsSaving || hasWorkspaceParamErrors}
            >
              {refreshDefaultsSaving ? 'Saving...' : 'Save Defaults'}
            </Button>
          </div>
        </div>
      </GlassCard>

      {refreshDefaultsLoading ? (
        <GlassCard>
          <div style={{ color: 'var(--muted)', fontSize: '14px' }}>Loading workspace refresh defaults...</div>
        </GlassCard>
      ) : refreshDefaultsError ? (
        <GlassCard>
          <div style={{ color: '#b91c1c', fontSize: '13px', marginBottom: '12px' }}>{refreshDefaultsError}</div>
          <Button variant="secondary" size="sm" onClick={() => void loadWorkspaceRefreshDefaults()}>
            Retry
          </Button>
        </GlassCard>
      ) : refreshDefaultsDraft ? (
        <GlassCard>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
              <label style={{ display: 'inline-flex', gap: '8px', alignItems: 'center', fontSize: '13px', color: 'var(--ink)' }}>
                <input
                  type="checkbox"
                  checked={Boolean(refreshDefaultsDraft.enabled)}
                  onChange={(e) => updateRefreshDefaultsDraft((draft) => ({ ...draft, enabled: e.target.checked }))}
                />
                Enable workspace update checks by default
              </label>
              <label style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', fontSize: '13px', color: 'var(--ink)' }}>
                TTL
                <select
                  value={String(refreshDefaultsDraft.ttl_seconds || 3600)}
                  onChange={(e) => updateRefreshDefaultsDraft((draft) => ({ ...draft, ttl_seconds: Number(e.target.value || 3600) }))}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    padding: '6px 8px',
                    background: 'var(--surface)',
                    color: 'var(--ink)',
                    fontSize: '12px',
                  }}
                >
                  <option value="300">5 min</option>
                  <option value="900">15 min</option>
                  <option value="1800">30 min</option>
                  <option value="3600">1 hour</option>
                  <option value="21600">6 hours</option>
                  <option value="43200">12 hours</option>
                  <option value="86400">1 day</option>
                </select>
              </label>
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
              {(['manual', 'on_open', 'scheduled'] as const).map((trigger) => (
                <label key={trigger} style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', fontSize: '12px', color: 'var(--ink)' }}>
                  <input
                    type="checkbox"
                    checked={Array.isArray(refreshDefaultsDraft.triggers) && refreshDefaultsDraft.triggers.includes(trigger)}
                    onChange={() => toggleWorkspaceTrigger(trigger)}
                  />
                  {trigger === 'on_open' ? 'On open' : trigger}
                </label>
              ))}
            </div>

            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
              These are workspace-level defaults. Nodes can inherit them and add their own extra checks.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {(refreshDefaultsDraft.checks || []).map((check, idx) => (
                <div
                  key={check.check_id || `workspace-check-${idx}`}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    padding: '12px',
                    background: 'var(--panel)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <label style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', fontSize: '12px', color: 'var(--ink)' }}>
                      <input
                        type="checkbox"
                        checked={check.enabled ?? true}
                        onChange={(e) => updateWorkspaceCheck(check.check_id, (current) => ({ ...current, enabled: e.target.checked }))}
                      />
                      Enabled
                    </label>
                    <select
                      value={check.kind || 'exa_answer'}
                      onChange={(e) => updateWorkspaceCheck(check.check_id, (current) => ({ ...current, kind: e.target.value }))}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        padding: '5px 8px',
                        background: 'var(--surface)',
                        color: 'var(--ink)',
                        fontSize: '12px',
                      }}
                    >
                      <option value="exa_answer">Exa answer</option>
                      <option value="exa_news">Exa news</option>
                      <option value="search_and_fetch">Web search</option>
                      <option value="live_metric">Live metric</option>
                    </select>
                    <Button variant="ghost" size="sm" onClick={() => removeWorkspaceCheck(check.check_id)} style={{ marginLeft: 'auto', color: '#b91c1c' }}>
                      Remove
                    </Button>
                  </div>

                  <Input
                    label="Title (optional)"
                    value={String(check.title || '')}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      updateWorkspaceCheck(check.check_id, (current) => ({ ...current, title: e.target.value }))
                    }
                    placeholder="e.g. Company headlines"
                  />

                  <Input
                    label="Query"
                    value={String(check.query || '')}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      updateWorkspaceCheck(check.check_id, (current) => ({ ...current, query: e.target.value }))
                    }
                    placeholder="Use {{concept_name}} for reusable workspace defaults"
                  />

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '12px', color: 'var(--muted)', fontWeight: 500 }}>Advanced params (JSON)</label>
                    <textarea
                      value={
                        refreshParamsJson[check.check_id || ''] ??
                        (() => {
                          try {
                            return JSON.stringify(check.params || {}, null, 2);
                          } catch {
                            return '{}';
                          }
                        })()
                      }
                      onChange={(e) => {
                        const key = check.check_id || '';
                        const text = e.target.value;
                        setRefreshParamsJson((prev) => ({ ...prev, [key]: text }));
                        try {
                          const parsed = text.trim() ? JSON.parse(text) : {};
                          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                            setRefreshParamsErrors((prev) => {
                              const next = { ...prev };
                              delete next[key];
                              return next;
                            });
                            updateWorkspaceCheck(check.check_id, (current) => ({ ...current, params: parsed as Record<string, any> }));
                          } else {
                            setRefreshParamsErrors((prev) => ({ ...prev, [key]: 'Params must be a JSON object' }));
                          }
                        } catch (err) {
                          setRefreshParamsErrors((prev) => ({
                            ...prev,
                            [key]: err instanceof Error ? err.message : 'Invalid JSON',
                          }));
                        }
                      }}
                      rows={5}
                      placeholder={`{\n  "max_age_hours": 6,\n  "limit": 8\n}`}
                      style={{
                        width: '100%',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        padding: '8px',
                        fontSize: '12px',
                        fontFamily: 'var(--font-mono)',
                        background: 'var(--surface)',
                        color: 'var(--ink)',
                        resize: 'vertical',
                      }}
                    />
                    {refreshParamsErrors[check.check_id || ''] && (
                      <div style={{ fontSize: '12px', color: '#b91c1c' }}>{refreshParamsErrors[check.check_id || '']}</div>
                    )}
                  </div>
                </div>
              ))}

              <Button variant="secondary" size="sm" onClick={addWorkspaceCheck} style={{ alignSelf: 'flex-start' }}>
                + Add Workspace Check
              </Button>
            </div>
          </div>
        </GlassCard>
      ) : null}
    </div>
  );

  const templateBlueprintContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <GlassCard>
        <h2 style={{ margin: 0, fontSize: '20px', fontFamily: 'var(--font-display)' }}>Template Blueprint Studio</h2>
        <p style={{ marginTop: '8px', color: 'var(--muted)', fontSize: '14px' }}>
          Three verticals, one connected research system. Use these blueprints to structure nodes, checks, and cross-entity relationships.
        </p>
        <div style={{ marginTop: '10px', fontSize: '13px', color: 'var(--muted)' }}>
          Current graph template: <strong style={{ color: 'var(--ink)' }}>{graph.template_label || graph.template_id || 'Custom / blank'}</strong>
        </div>
      </GlassCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
        {TEMPLATE_BLUEPRINTS.map((tpl) => {
          const isFocused = focusedBlueprintId === tpl.id;
          return (
            <GlassCard
              key={tpl.id}
              style={{
                border: isFocused ? '1px solid var(--accent)' : '1px solid var(--border)',
                boxShadow: isFocused ? '0 8px 24px rgba(99, 102, 241, 0.12)' : undefined,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '17px', fontFamily: 'var(--font-display)' }}>{tpl.label}</h3>
                {isFocused && <Badge variant="neutral">Selected Template</Badge>}
              </div>
              <p style={{ marginTop: '8px', color: 'var(--muted)', fontSize: '13px' }}>{tpl.description}</p>

              <div style={{ marginTop: '10px' }}>
                <MiniBlueprintMap
                  nodeLabels={tpl.defaultNodeTypes}
                  accent={
                    tpl.id === 'company_research'
                      ? '#0ea5e9'
                      : tpl.id === 'person_research'
                        ? '#2563eb'
                        : '#10b981'
                  }
                />
              </div>

              <div style={{ marginTop: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}>Typical node types</div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {tpl.defaultNodeTypes.map((nodeType) => (
                    <Badge key={nodeType} variant="outline" size="sm">{nodeType}</Badge>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}>Suggested checks</div>
                <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--muted)', fontSize: '12px', lineHeight: 1.6 }}>
                  {tpl.defaultChecks.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>

              <div style={{ marginTop: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}>Connection patterns</div>
                <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--muted)', fontSize: '12px', lineHeight: 1.6 }}>
                  {tpl.connectionPatterns.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>
            </GlassCard>
          );
        })}
      </div>

      <GlassCard>
        <h3 style={{ margin: 0, fontSize: '17px', fontFamily: 'var(--font-display)' }}>Cross-Vertical Connection Layer</h3>
        <p style={{ marginTop: '8px', color: 'var(--muted)', fontSize: '13px' }}>
          This is the differentiator: the same event/news evidence can connect people and companies, and refresh checks keep those connections current.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px', marginTop: '12px' }}>
          <div style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '12px', background: 'var(--panel)' }}>
            <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '6px' }}>Person ↔ Company</div>
            <div style={{ color: 'var(--muted)', fontSize: '12px', lineHeight: 1.6 }}>
              leadership changes, board seats, founders, hires/leaves, spokesperson relationships
            </div>
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '12px', background: 'var(--panel)' }}>
            <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '6px' }}>Company ↔ News/Event</div>
            <div style={{ color: 'var(--muted)', fontSize: '12px', lineHeight: 1.6 }}>
              earnings, launches, investigations, partnerships, incidents, policy impacts
            </div>
          </div>
          <div style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '12px', background: 'var(--panel)' }}>
            <div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '6px' }}>Person ↔ News/Event</div>
            <div style={{ color: 'var(--muted)', fontSize: '12px', lineHeight: 1.6 }}>
              interviews, statements, testimony, conference appearances, accountability chains
            </div>
          </div>
        </div>

        <div style={{ marginTop: '14px', fontSize: '12px', color: 'var(--muted)' }}>
          Recommended workflow:
          {' '}1) choose a template preset for workspace defaults,
          {' '}2) let nodes inherit refresh checks,
          {' '}3) add node-specific overrides where needed,
          {' '}4) connect entities across verticals as evidence arrives.
        </div>
      </GlassCard>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--page-bg)', paddingBottom: '48px' }}>

      {/* Header */}
      <div style={{
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'rgba(255, 255, 255, 0.8)',
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
        padding: '20px 24px',
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div
            className="responsive-header-stack"
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}
          >
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Link href="/home" style={{ color: 'var(--muted)', fontSize: '14px', fontWeight: 500 }}>Home</Link>
                <span style={{ color: 'var(--border)' }}>/</span>
                <span style={{ color: 'var(--muted)', fontSize: '14px' }}>Graphs</span>
              </div>
              <h1 style={{ fontSize: '32px', fontWeight: '700', marginBottom: '8px', fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>
                {graph.name || graph.graph_id}
              </h1>
              <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                <span>{nodes} nodes</span>
                <span>{edges} edges</span>
                <span>updated {updated}</span>
              </div>
            </div>

            <Link href="/">
              <Button variant="primary">Open in Explorer →</Button>
            </Link>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: '2px' }}>
            <Button
              variant={activeTab === 'browse' ? 'secondary' : 'ghost'}
              onClick={() => setActiveTab('browse')}
              size="sm"
              className={activeTab === 'browse' ? '!border-b-0 rounded-b-none' : ''}
            >
              Browse Concepts
            </Button>
            <Button
              variant={activeTab === 'pinned' ? 'secondary' : 'ghost'}
              onClick={() => setActiveTab('pinned')}
              size="sm"
              className={activeTab === 'pinned' ? '!border-b-0 rounded-b-none' : ''}
            >
              Pinned ({pinnedConceptIds.length})
            </Button>
            <Button
              variant={activeTab === 'settings' ? 'secondary' : 'ghost'}
              onClick={() => setActiveTab('settings')}
              size="sm"
              className={activeTab === 'settings' ? '!border-b-0 rounded-b-none' : ''}
            >
              Workspace Settings
            </Button>
            <Button
              variant={activeTab === 'template' ? 'secondary' : 'ghost'}
              onClick={() => setActiveTab('template')}
              size="sm"
              className={activeTab === 'template' ? '!border-b-0 rounded-b-none' : ''}
            >
              Template Blueprint
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: '1200px', margin: '32px auto', padding: '0 24px' }}>
        {activeTab === 'browse' ? (
          <div>
            <GlassCard className="mb-6">
              {/* Filters */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px',
                alignItems: 'end',
              }}>
                <Input
                  label="Search"
                  placeholder="Search concepts..."
                  value={searchQuery}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    setSearchQuery(e.target.value);
                    setPage(0);
                  }}
                />

                <Select
                  label="Domain"
                  value={domainFilter}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                    setDomainFilter(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">All domains</option>
                  {domains.map(domain => (
                    <option key={domain} value={domain}>{domain}</option>
                  ))}
                </Select>

                <Select
                  label="Type"
                  value={typeFilter}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                    setTypeFilter(e.target.value);
                    setPage(0);
                  }}
                >
                  <option value="">All types</option>
                  {types.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </Select>

                <Select
                  label="Sort By"
                  value={sortBy}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                    setSortBy(e.target.value as 'alphabetical' | 'degree' | 'recent');
                    setPage(0);
                  }}
                >
                  <option value="alphabetical">Alphabetical</option>
                  <option value="degree">Most connected</option>
                  <option value="recent">Recently active</option>
                </Select>
              </div>
            </GlassCard>

            {/* Results */}
            {loadingConcepts ? (
              <div style={{ textAlign: 'center', padding: '60px', color: 'var(--muted)' }}>
                <div className="spinner mb-4" />
                <p>Loading concepts...</p>
              </div>
            ) : concepts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', color: 'var(--muted)', background: 'var(--panel)', borderRadius: '16px', border: '1px dashed var(--border)' }}>
                <p>No concepts found matching your filters.</p>
                <Button variant="ghost" onClick={() => { setSearchQuery(''); setDomainFilter(''); setTypeFilter(''); }} style={{ marginTop: '12px' }}>Clear Filters</Button>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: '16px', fontSize: '13px', color: 'var(--muted)', fontWeight: 500, paddingLeft: '4px' }}>
                  Showing {concepts.length} of {total} concepts
                </div>

                <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ overflowX: 'auto', width: '100%' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '600px' }}>
                      <thead>
                        <tr style={{ backgroundColor: 'rgba(0,0,0,0.02)', borderBottom: '1px solid var(--border)' }}>
                          <th style={{ padding: '16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Concept</th>
                          <th style={{ padding: '16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Domain</th>
                          <th style={{ padding: '16px', textAlign: 'left', fontSize: '12px', fontWeight: '600', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Type</th>
                          {sortBy === 'degree' && (
                            <th style={{ padding: '16px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Connections</th>
                          )}
                          <th style={{ padding: '16px', textAlign: 'right', fontSize: '12px', fontWeight: '600', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {concepts.map((concept) => (
                          <tr
                            key={concept.concept_id}
                            style={{
                              borderBottom: '1px solid var(--border)',
                              cursor: 'pointer',
                              transition: 'background 0.1s ease'
                            }}
                            className="hover:bg-black/5 dark:hover:bg-white/5"
                            onClick={() => handleOpenInExplorer(concept.concept_id)}
                          >
                            <td style={{ padding: '16px', fontWeight: '600', color: 'var(--ink)' }}>{concept.name}</td>
                            <td style={{ padding: '16px' }}>
                              <Badge variant="neutral">{concept.domain}</Badge>
                            </td>
                            <td style={{ padding: '16px' }}>
                              <Badge variant="outline">{concept.type}</Badge>
                            </td>
                            {sortBy === 'degree' && (
                              <td style={{ padding: '16px', textAlign: 'right', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                                {concept.degree ?? 0}
                              </td>
                            )}
                            <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e: React.MouseEvent) => {
                                    e.stopPropagation();
                                    handleTogglePin(concept.concept_id);
                                  }}
                                  style={{ color: isConceptPinned(graphId, concept.concept_id) ? '#f59e0b' : 'var(--muted)' }}
                                >
                                  {isConceptPinned(graphId, concept.concept_id) ? 'Unpin' : 'Pin'}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </GlassCard>

                {/* Pagination */}
                {total > pageSize && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px' }}>
                    <Button
                      onClick={() => setPage(p => Math.max(0, p - 1))}
                      disabled={page === 0}
                      variant="secondary"
                    >
                      Previous
                    </Button>
                    <div style={{ fontSize: '14px', color: 'var(--muted)' }}>
                      Page {page + 1} of {Math.ceil(total / pageSize)}
                    </div>
                    <Button
                      onClick={() => setPage(p => p + 1)}
                      disabled={(page + 1) * pageSize >= total}
                      variant="secondary"
                    >
                      Next
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        ) : activeTab === 'pinned' ? (
          <div>
            {loadingPinned ? (
              <div style={{ textAlign: 'center', padding: '60px', color: 'var(--muted)' }}>
                Loading pinned concepts...
              </div>
            ) : pinnedConcepts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '60px', color: 'var(--muted)', background: 'var(--panel)', borderRadius: '16px' }}>
                <p>No pinned concepts yet.</p>
                <div style={{ fontSize: '13px', marginTop: '8px', opacity: 0.7 }}>Pin concepts from the Browse tab to access them quickly here.</div>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: '20px',
              }}>
                {pinnedConcepts.map((concept) => (
                  <GlassCard
                    key={concept.concept_id}
                    variant="interactive"
                    onClick={() => handleOpenInExplorer(concept.concept_id)}
                    style={{ padding: '20px' }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                      <h3 style={{ fontSize: '18px', fontWeight: '600', margin: 0, fontFamily: 'var(--font-display)' }}>{concept.name}</h3>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleTogglePin(concept.concept_id);
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: '4px',
                          color: '#f59e0b',
                          fontSize: '16px',
                          opacity: 0.8,
                          transition: 'opacity 0.2s'
                        }}
                        title="Unpin"
                      >
                        📌
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
                      <Badge variant="neutral" size="sm">{concept.domain}</Badge>
                      <Badge variant="outline" size="sm">{concept.type}</Badge>
                    </div>
                    <Button variant="primary" size="sm" style={{ width: '100%' }}>
                      Open in Explorer
                    </Button>
                  </GlassCard>
                ))}
              </div>
            )}
          </div>
        ) : activeTab === 'settings' ? (
          workspaceSettingsContent
        ) : (
          templateBlueprintContent
        )}
      </div>
    </div>
  );
}
