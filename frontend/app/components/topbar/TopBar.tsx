'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { listGraphs, listWorkspaceTemplates, selectGraph, createGraph, searchConcepts, searchResources, getConcept, createConcept, deleteConcept, createRelationshipByIds, updateGraphRefreshDefaults, type CreateGraphOptions, type GraphSummary, type Concept, type Resource, type RefreshBindingConfig, type WorkspaceTemplate } from '../../api-client';
import { useSidebar } from '../context-providers/SidebarContext';
import { useTheme } from '../context-providers/ThemeProvider';
import { setLastSession, getRecentConceptViews, pushRecentConceptView, getLastSession, togglePinConcept, isConceptPinned } from '../../lib/sessionState';
import { logEvent, fetchRecentEvents } from '../../lib/eventsClient';
import { fetchEvidenceForConcept } from '../../lib/evidenceFetch';
import { searchAll } from '@/lib/search/search_router';
import NewNoteModal from '../modals/NewNoteModal';

interface ConceptSearchResult {
  type: 'concept';
  concept: Concept;
}

interface EvidenceSearchResult {
  type: 'evidence';
  resource: Resource;
  concept_id?: string;
  concept_name?: string;
}

interface ActionSearchResult {
  type: 'action';
  id: string;
  label: string;
  description: string;
  command: string;
  icon?: string;
}

interface GraphSearchResult {
  type: 'graph';
  graph: GraphSummary;
}

type SearchResult = ConceptSearchResult | EvidenceSearchResult | ActionSearchResult | GraphSearchResult;

// Recent graphs tracking in localStorage
const RECENT_GRAPHS_KEY = 'brainweb:recentGraphs';
const PINNED_GRAPHS_KEY = 'brainweb:pinnedGraphIds';
const MAX_RECENT_GRAPHS = 5;
const MAX_PINNED_GRAPHS = 10;

// Omnibox recents tracking in localStorage
const OMNIBOX_RECENT_CONCEPTS_KEY = 'brainweb:omnibox:recent_concepts';
const OMNIBOX_RECENT_RESOURCES_KEY = 'brainweb:omnibox:recent_resources';
const OMNIBOX_RECENT_COMMANDS_KEY = 'brainweb:omnibox:recent_commands';

const GRAPH_TEMPLATES = [
  {
    id: 'blank',
    label: 'Blank canvas',
    description: 'Start with an empty graph and build from scratch.',
    tags: ['flexible', 'general'],
    intent: 'Explore ideas and connect concepts freely.',
    refreshPresetId: 'none',
  },
  {
    id: 'lecture',
    label: 'Lecture ingestion',
    description: 'Turn classes into connected study maps.',
    tags: ['slides', 'readings', 'definitions'],
    intent: 'Capture lecture concepts and build exam-ready connections.',
    refreshPresetId: 'none',
  },
  {
    id: 'literature',
    label: 'Literature review',
    description: 'Map papers, methods, and research gaps.',
    tags: ['citations', 'methods', 'summaries'],
    intent: 'Synthesize a research landscape and highlight gaps.',
    refreshPresetId: 'literature_review',
  },
  {
    id: 'news_tracking',
    label: 'News tracking',
    description: 'Monitor topics, people, and organizations for updates.',
    tags: ['news', 'monitoring', 'alerts'],
    intent: 'Track a topic over time and collect high-signal updates.',
    refreshPresetId: 'news_tracking',
  },
  {
    id: 'stock_research',
    label: 'Stock research',
    description: 'Track companies with live metrics, news, and organizational changes.',
    tags: ['markets', 'earnings', 'company'],
    intent: 'Build and maintain an investment/company research workspace.',
    refreshPresetId: 'stock_research',
  },
  {
    id: 'person_research',
    label: 'Person research',
    description: 'Track people, role changes, appearances, and related news.',
    tags: ['people', 'profiles', 'changes'],
    intent: 'Follow important people and how their roles and influence evolve.',
    refreshPresetId: 'person_research',
  },
];

type RefreshTemplatePresetId =
  | 'none'
  | 'literature_review'
  | 'news_tracking'
  | 'stock_research'
  | 'person_research';

const REFRESH_TEMPLATE_PRESETS: Record<
  RefreshTemplatePresetId,
  { label: string; description: string; defaults: RefreshBindingConfig | null }
> = {
  none: {
    label: 'No refresh defaults',
    description: 'New nodes will not auto-check for updates unless you enable it per node.',
    defaults: null,
  },
  literature_review: {
    label: 'Literature review updates',
    description: 'Periodic paper/news scans and summaries for each node.',
    defaults: {
      version: 1,
      enabled: true,
      inherit_workspace_defaults: true,
      triggers: ['manual', 'on_open', 'scheduled'],
      ttl_seconds: 86400,
      checks: [
        {
          check_id: 'lit-news',
          kind: 'exa_news',
          title: 'Recent headlines',
          query: '{{concept_name}} research news',
          enabled: true,
          params: { max_age_hours: 24, limit: 6 },
        },
        {
          check_id: 'lit-summary',
          kind: 'exa_answer',
          title: 'Recent developments summary',
          query: 'latest developments in {{concept_name}} research',
          enabled: true,
          params: { max_age_hours: 72 },
        },
      ],
    },
  },
  news_tracking: {
    label: 'News tracking updates',
    description: 'Headline feed + grounded summary for each node/topic.',
    defaults: {
      version: 1,
      enabled: true,
      inherit_workspace_defaults: true,
      triggers: ['manual', 'on_open', 'scheduled'],
      ttl_seconds: 3600,
      checks: [
        {
          check_id: 'news-feed',
          kind: 'exa_news',
          title: 'News feed',
          query: '{{concept_name}}',
          enabled: true,
          params: { max_age_hours: 6, limit: 8 },
        },
        {
          check_id: 'news-summary',
          kind: 'exa_answer',
          title: 'What changed',
          query: 'What are the latest relevant updates about {{concept_name}}?',
          enabled: true,
          params: { category: 'news', max_age_hours: 12 },
        },
      ],
    },
  },
  stock_research: {
    label: 'Company / stock research updates',
    description: 'Live metric snapshot, company news, and organizational changes per node.',
    defaults: {
      version: 1,
      enabled: true,
      inherit_workspace_defaults: true,
      triggers: ['manual', 'on_open', 'scheduled'],
      ttl_seconds: 1800,
      checks: [
        {
          check_id: 'live-metric',
          kind: 'live_metric',
          title: 'Live metric snapshot',
          query: '{{concept_name}} stock price',
          enabled: true,
          params: {},
        },
        {
          check_id: 'company-news',
          kind: 'exa_news',
          title: 'Company headlines',
          query: '{{concept_name}} company news',
          enabled: true,
          params: { max_age_hours: 12, limit: 8 },
        },
        {
          check_id: 'org-changes',
          kind: 'exa_answer',
          title: 'Organizational changes',
          query: 'recent organizational changes leadership changes or restructuring at {{concept_name}}',
          enabled: true,
          params: { category: 'news', max_age_hours: 72 },
        },
      ],
    },
  },
  person_research: {
    label: 'Person research updates',
    description: 'Track role changes, public appearances, and latest mentions per node.',
    defaults: {
      version: 1,
      enabled: true,
      inherit_workspace_defaults: true,
      triggers: ['manual', 'on_open', 'scheduled'],
      ttl_seconds: 21600,
      checks: [
        {
          check_id: 'person-news',
          kind: 'exa_news',
          title: 'Recent mentions',
          query: '{{concept_name}}',
          enabled: true,
          params: { max_age_hours: 24, limit: 6 },
        },
        {
          check_id: 'role-change',
          kind: 'exa_answer',
          title: 'Role and org changes',
          query: 'latest role changes title changes employer changes for {{concept_name}}',
          enabled: true,
          params: { max_age_hours: 168 },
        },
      ],
    },
  },
};

function getTemplateRefreshPresetId(templateId: string): RefreshTemplatePresetId {
  const template = GRAPH_TEMPLATES.find((item) => item.id === templateId);
  return (template?.refreshPresetId as RefreshTemplatePresetId) || 'none';
}

function cloneRefreshDefaults(config: RefreshBindingConfig | null): RefreshBindingConfig | null {
  if (!config) return null;
  return {
    version: config.version || 1,
    enabled: Boolean(config.enabled),
    inherit_workspace_defaults: config.inherit_workspace_defaults ?? true,
    triggers: Array.isArray(config.triggers) ? [...config.triggers] : ['manual'],
    ttl_seconds: typeof config.ttl_seconds === 'number' ? config.ttl_seconds : 3600,
    checks: Array.isArray(config.checks)
      ? config.checks.map((check) => ({
          check_id: check.check_id || null,
          kind: check.kind,
          query: check.query,
          title: check.title || null,
          enabled: check.enabled ?? true,
          params: check.params ? { ...check.params } : {},
        }))
      : [],
  };
}

type BuiltInGraphTemplate = (typeof GRAPH_TEMPLATES)[number];

type CreateGraphTemplateOption = {
  id: string;
  source: 'builtin' | 'custom';
  label: string;
  description: string;
  tags: string[];
  intent?: string;
  refreshPresetId?: RefreshTemplatePresetId;
  customTemplate?: WorkspaceTemplate;
};

function isCustomTemplateOptionId(value: string): boolean {
  return value.startsWith('custom:');
}

function customTemplateOptionId(templateId: string): string {
  return `custom:${templateId}`;
}

type TemplateStarterNodeSeed = {
  key: string;
  name: string;
  type?: string;
  description?: string;
  domain?: string;
};

type TemplateStarterEdgeSeed = {
  sourceKey: string;
  targetKey: string;
  predicate: string;
};

type TemplateStarterSeed = {
  nodes: TemplateStarterNodeSeed[];
  edges: TemplateStarterEdgeSeed[];
};

const BUILTIN_TEMPLATE_STARTERS: Record<string, TemplateStarterSeed> = {
  lecture: {
    nodes: [
      { key: 'course_topic', name: 'Course Topic', type: 'Topic' },
      { key: 'lecture_concept', name: 'Lecture Concept', type: 'Concept' },
      { key: 'definition', name: 'Core Definition', type: 'Definition' },
      { key: 'example', name: 'Worked Example', type: 'Example' },
    ],
    edges: [
      { sourceKey: 'course_topic', targetKey: 'lecture_concept', predicate: 'covers' },
      { sourceKey: 'lecture_concept', targetKey: 'definition', predicate: 'defines' },
      { sourceKey: 'lecture_concept', targetKey: 'example', predicate: 'illustrated_by' },
    ],
  },
  literature: {
    nodes: [
      { key: 'research_topic', name: 'Research Topic', type: 'Topic' },
      { key: 'paper_a', name: 'Reference Paper A', type: 'Paper' },
      { key: 'paper_b', name: 'Reference Paper B', type: 'Paper' },
      { key: 'method', name: 'Core Method', type: 'Method' },
    ],
    edges: [
      { sourceKey: 'paper_a', targetKey: 'research_topic', predicate: 'studies' },
      { sourceKey: 'paper_b', targetKey: 'research_topic', predicate: 'studies' },
      { sourceKey: 'paper_a', targetKey: 'method', predicate: 'uses' },
      { sourceKey: 'paper_b', targetKey: 'method', predicate: 'compares' },
    ],
  },
  news_tracking: {
    nodes: [
      { key: 'event', name: 'Tracked Event', type: 'Event' },
      { key: 'organization', name: 'Primary Organization', type: 'Organization' },
      { key: 'person', name: 'Primary Person', type: 'Person' },
      { key: 'claim', name: 'Key Claim', type: 'Claim' },
    ],
    edges: [
      { sourceKey: 'event', targetKey: 'organization', predicate: 'involves' },
      { sourceKey: 'event', targetKey: 'person', predicate: 'announced_by' },
      { sourceKey: 'claim', targetKey: 'event', predicate: 'supports' },
    ],
  },
  stock_research: {
    nodes: [
      { key: 'company', name: 'Target Company', type: 'Company' },
      { key: 'ticker', name: 'Primary Ticker', type: 'Ticker' },
      { key: 'executive', name: 'Lead Executive', type: 'Executive' },
      { key: 'product', name: 'Key Product Line', type: 'Product' },
      { key: 'competitor', name: 'Primary Competitor', type: 'Competitor' },
    ],
    edges: [
      { sourceKey: 'company', targetKey: 'ticker', predicate: 'listed_as' },
      { sourceKey: 'executive', targetKey: 'company', predicate: 'leads' },
      { sourceKey: 'company', targetKey: 'product', predicate: 'ships' },
      { sourceKey: 'company', targetKey: 'competitor', predicate: 'competes_with' },
    ],
  },
  person_research: {
    nodes: [
      { key: 'person', name: 'Target Person', type: 'Person' },
      { key: 'organization', name: 'Current Organization', type: 'Organization' },
      { key: 'project', name: 'Key Project', type: 'Project' },
      { key: 'event', name: 'Recent Event', type: 'Event' },
    ],
    edges: [
      { sourceKey: 'person', targetKey: 'organization', predicate: 'works_at' },
      { sourceKey: 'person', targetKey: 'project', predicate: 'works_on' },
      { sourceKey: 'person', targetKey: 'event', predicate: 'mentioned_in' },
      { sourceKey: 'organization', targetKey: 'event', predicate: 'announced' },
    ],
  },
};

function normalizeSeedToken(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function sanitizePredicate(value: string): string {
  const normalized = normalizeSeedToken(value);
  return normalized || 'related_to';
}

function buildStarterNodeLabel(typeLabel: string, index: number): string {
  const key = normalizeSeedToken(typeLabel);
  if (!key) return `Node ${index + 1}`;
  if (key.includes('company')) return 'Target Company';
  if (key.includes('ticker')) return 'Primary Ticker';
  if (key.includes('executive')) return 'Lead Executive';
  if (key.includes('competitor')) return 'Primary Competitor';
  if (key.includes('supplier')) return 'Key Supplier';
  if (key.includes('product')) return 'Key Product';
  if (key.includes('person')) return 'Target Person';
  if (key.includes('organization') || key === 'org') return 'Primary Organization';
  if (key.includes('event')) return 'Tracked Event';
  if (key.includes('project')) return 'Key Project';
  if (key.includes('claim')) return 'Key Claim';
  if (key.includes('location')) return 'Relevant Location';
  if (key.includes('paper')) return 'Reference Paper';
  if (key.includes('method')) return 'Core Method';
  if (key.includes('topic')) return 'Research Topic';
  return `${String(typeLabel).trim() || 'Node'} ${index + 1}`;
}

function buildUniqueSeedKey(base: string, used: Set<string>, fallbackIndex: number): string {
  let key = normalizeSeedToken(base) || `node_${fallbackIndex + 1}`;
  if (!used.has(key)) {
    used.add(key);
    return key;
  }
  let n = 2;
  while (used.has(`${key}_${n}`)) n += 1;
  const next = `${key}_${n}`;
  used.add(next);
  return next;
}

function parseConnectionPattern(pattern: string): { sourceType: string; targetType: string; predicate: string } | null {
  const raw = String(pattern || '').trim();
  if (!raw) return null;

  const arrowMatch = raw.match(/^(.*?)\s*(?:<->|↔|->|→)\s*(.*)$/);
  if (!arrowMatch) return null;

  const sourceType = (arrowMatch[1] || '').trim();
  let targetPart = (arrowMatch[2] || '').trim();
  if (!sourceType || !targetPart) return null;

  let predicate = 'related_to';
  const parenMatch = targetPart.match(/\(([^)]+)\)/);
  if (parenMatch && parenMatch[1]) {
    const firstPredicate = parenMatch[1]
      .split(',')
      .map((item) => item.trim())
      .find(Boolean);
    if (firstPredicate) {
      predicate = sanitizePredicate(firstPredicate);
    }
    targetPart = targetPart.replace(parenMatch[0], '').trim();
  }

  return {
    sourceType,
    targetType: targetPart,
    predicate,
  };
}

function buildCustomTemplateStarterSeed(template: WorkspaceTemplate): TemplateStarterSeed | null {
  const typeList = Array.from(
    new Set((template.node_types || []).map((item) => String(item || '').trim()).filter(Boolean)),
  ).slice(0, 8);
  const starterNames = (template.starter_nodes || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 12);
  if (typeList.length === 0 && starterNames.length === 0) return null;

  const usedKeys = new Set<string>();
  const nodes: TemplateStarterNodeSeed[] = [];
  const maxCount = Math.max(typeList.length, starterNames.length);
  for (let index = 0; index < maxCount; index += 1) {
    const typeLabel = typeList[index];
    const starterName = starterNames[index];
    const name = starterName || (typeLabel ? buildStarterNodeLabel(typeLabel, index) : `Node ${index + 1}`);
    nodes.push({
      key: buildUniqueSeedKey(starterName || typeLabel || `node_${index + 1}`, usedKeys, index),
      name,
      type: typeLabel || undefined,
    });
  }

  const keyByType = new Map<string, string>();
  for (const node of nodes) {
    if (node.type) {
      const normalizedType = normalizeSeedToken(node.type);
      if (normalizedType && !keyByType.has(normalizedType)) {
        keyByType.set(normalizedType, node.key);
      }
    }
  }

  const edges: TemplateStarterEdgeSeed[] = [];
  const seenEdges = new Set<string>();
  for (const pattern of template.connection_patterns || []) {
    const parsed = parseConnectionPattern(pattern);
    if (!parsed) continue;
    const sourceKey = keyByType.get(normalizeSeedToken(parsed.sourceType));
    const targetKey = keyByType.get(normalizeSeedToken(parsed.targetType));
    if (!sourceKey || !targetKey || sourceKey === targetKey) continue;
    const edgeKey = `${sourceKey}|${parsed.predicate}|${targetKey}`;
    if (seenEdges.has(edgeKey)) continue;
    seenEdges.add(edgeKey);
    edges.push({ sourceKey, targetKey, predicate: parsed.predicate });
    if (edges.length >= 12) break;
  }

  if (edges.length === 0 && nodes.length > 1) {
    for (let i = 1; i < nodes.length; i += 1) {
      edges.push({
        sourceKey: nodes[0].key,
        targetKey: nodes[i].key,
        predicate: 'related_to',
      });
    }
  }

  return { nodes, edges };
}

function resolveTemplateStarterSeed(params: {
  builtInTemplate: BuiltInGraphTemplate | null;
  customTemplate: WorkspaceTemplate | null;
}): TemplateStarterSeed | null {
  const { builtInTemplate, customTemplate } = params;
  if (customTemplate) return buildCustomTemplateStarterSeed(customTemplate);
  if (builtInTemplate) return BUILTIN_TEMPLATE_STARTERS[builtInTemplate.id] || null;
  return null;
}

function deriveSeedDomain(
  builtInTemplate: BuiltInGraphTemplate | null,
  customTemplate: WorkspaceTemplate | null,
): string {
  const raw = customTemplate?.vertical || builtInTemplate?.id || 'general';
  const normalized = normalizeSeedToken(raw).replace(/_+/g, '_');
  return normalized || 'general';
}

async function seedStarterTemplateGraph(params: {
  graphId: string;
  builtInTemplate: BuiltInGraphTemplate | null;
  customTemplate: WorkspaceTemplate | null;
}): Promise<{ nodesCreated: number; edgesCreated: number }> {
  const { graphId, builtInTemplate, customTemplate } = params;
  const seed = resolveTemplateStarterSeed({ builtInTemplate, customTemplate });
  if (!seed || !seed.nodes.length) {
    return { nodesCreated: 0, edgesCreated: 0 };
  }

  const domain = deriveSeedDomain(builtInTemplate, customTemplate);
  const createdConcepts = new Map<string, Concept>();
  let nodesCreated = 0;
  let edgesCreated = 0;

  for (const node of seed.nodes.slice(0, 12)) {
    try {
      const created = await createConcept({
        name: node.name,
        domain: node.domain || domain,
        type: node.type || 'concept',
        description: node.description || null,
        graph_id: graphId,
      });
      createdConcepts.set(node.key, created);
      nodesCreated += 1;
    } catch (error) {
      console.error('Failed to create starter template node:', node, error);
    }
  }

  for (const edge of seed.edges.slice(0, 24)) {
    const source = createdConcepts.get(edge.sourceKey);
    const target = createdConcepts.get(edge.targetKey);
    if (!source || !target || source.node_id === target.node_id) continue;
    try {
      await createRelationshipByIds(source.node_id, target.node_id, sanitizePredicate(edge.predicate));
      edgesCreated += 1;
    } catch (error) {
      console.error('Failed to create starter template relationship:', edge, error);
    }
  }

  return { nodesCreated, edgesCreated };
}

function MiniStarterSeedPreview({
  seed,
  templateLabel,
}: {
  seed: TemplateStarterSeed | null;
  templateLabel?: string;
}) {
  if (!seed || !seed.nodes.length) {
    return (
      <div
        style={{
          border: '1px dashed var(--border)',
          borderRadius: '8px',
          padding: '10px',
          color: 'var(--muted)',
          fontSize: '12px',
          background: 'rgba(255,255,255,0.55)',
        }}
      >
        No starter nodes for this template. This workspace will start empty.
      </div>
    );
  }

  const visibleNodes = seed.nodes.slice(0, 6);
  const points = [
    { x: 26, y: 28 },
    { x: 94, y: 18 },
    { x: 160, y: 28 },
    { x: 52, y: 92 },
    { x: 128, y: 94 },
    { x: 94, y: 58 },
  ];
  const pointByKey = new Map(visibleNodes.map((node, idx) => [node.key, points[idx]] as const));
  const visibleEdges = (seed.edges || []).filter((edge) => pointByKey.has(edge.sourceKey) && pointByKey.has(edge.targetKey)).slice(0, 12);

  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '10px',
        background: 'rgba(255,255,255,0.6)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink)' }}>
          Starter seed preview{templateLabel ? ` · ${templateLabel}` : ''}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
          {seed.nodes.length} topics · {seed.edges.length} connections
        </div>
      </div>

      <svg
        viewBox="0 0 186 118"
        width="100%"
        height="118"
        style={{ display: 'block', borderRadius: '8px', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.7)' }}
      >
        {visibleEdges.length > 0
          ? visibleEdges.map((edge, index) => {
              const a = pointByKey.get(edge.sourceKey);
              const b = pointByKey.get(edge.targetKey);
              if (!a || !b) return null;
              return (
                <line
                  key={`${edge.sourceKey}-${edge.predicate}-${edge.targetKey}-${index}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="rgba(99,102,241,0.28)"
                  strokeWidth="1.4"
                />
              );
            })
          : visibleNodes.map((_, idx) => {
              if (idx === 0) return null;
              return (
                <line
                  key={`fallback-${idx}`}
                  x1={points[0].x}
                  y1={points[0].y}
                  x2={points[idx].x}
                  y2={points[idx].y}
                  stroke="rgba(100,116,139,0.28)"
                  strokeWidth="1.3"
                />
              );
            })}

        {visibleNodes.map((node, idx) => (
          <g key={node.key} transform={`translate(${points[idx].x},${points[idx].y})`}>
            <circle r={idx === 0 ? 12 : 9.5} fill={idx === 0 ? 'rgba(99,102,241,0.18)' : 'white'} stroke="rgba(99,102,241,0.55)" strokeWidth="1.2" />
            <text x={0} y={idx === 0 ? 25 : 22} textAnchor="middle" style={{ fontSize: '7px', fill: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
              {node.name.length > 12 ? `${node.name.slice(0, 12)}…` : node.name}
            </text>
          </g>
        ))}
      </svg>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '4px' }}>
        {seed.nodes.slice(0, 5).map((node) => (
          <div key={`seed-node-${node.key}`} style={{ fontSize: '11px', color: 'var(--muted)' }}>
            <span style={{ color: 'var(--ink)' }}>{node.name}</span>
            {node.type ? <span> · {node.type}</span> : null}
          </div>
        ))}
        {seed.nodes.length > 5 && (
          <div style={{ fontSize: '11px', color: 'var(--muted)' }}>+ {seed.nodes.length - 5} more starter nodes</div>
        )}
      </div>

      {seed.edges.length > 0 && (
        <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
          Link predicates: {Array.from(new Set(seed.edges.slice(0, 6).map((edge) => edge.predicate))).join(', ')}
          {seed.edges.length > 6 ? ', …' : ''}
        </div>
      )}
    </div>
  );
}

interface RecentConcept {
  node_id: string;
  name: string;
  domain?: string;
  type?: string;
  ts: number;
}

interface RecentResource {
  resource_id: string;
  title?: string;
  kind?: string;
  concept_id?: string;
  concept_name?: string;
  ts: number;
}

interface RecentCommand {
  id: string;
  label: string;
  command: string;
  ts: number;
}

function getOmniboxRecentConcepts(): RecentConcept[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(OMNIBOX_RECENT_CONCEPTS_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

function addOmniboxRecentConcept(concept: { node_id: string; name: string; domain?: string; type?: string }): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = getOmniboxRecentConcepts();
    const filtered = existing.filter(c => c.node_id !== concept.node_id);
    const updated: RecentConcept[] = [
      { ...concept, ts: Date.now() },
      ...filtered,
    ].slice(0, 6);
    localStorage.setItem(OMNIBOX_RECENT_CONCEPTS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore errors
  }
}

function getOmniboxRecentResources(): RecentResource[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(OMNIBOX_RECENT_RESOURCES_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

function addOmniboxRecentResource(resource: { resource_id: string; title?: string; kind?: string; concept_id?: string; concept_name?: string }): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = getOmniboxRecentResources();
    const filtered = existing.filter(r => r.resource_id !== resource.resource_id);
    const updated: RecentResource[] = [
      { ...resource, ts: Date.now() },
      ...filtered,
    ].slice(0, 4);
    localStorage.setItem(OMNIBOX_RECENT_RESOURCES_KEY, JSON.stringify(updated));
  } catch {
    // Ignore errors
  }
}

function getOmniboxRecentCommands(): RecentCommand[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(OMNIBOX_RECENT_COMMANDS_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

function addOmniboxRecentCommand(command: { id: string; label: string; command: string }): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = getOmniboxRecentCommands();
    const filtered = existing.filter(c => c.id !== command.id);
    const updated: RecentCommand[] = [
      { ...command, ts: Date.now() },
      ...filtered,
    ].slice(0, 3);
    localStorage.setItem(OMNIBOX_RECENT_COMMANDS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore errors
  }
}

function getRecentGraphs(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(RECENT_GRAPHS_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

function addRecentGraph(graphId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const recent = getRecentGraphs();
    const filtered = recent.filter(id => id !== graphId);
    const updated = [graphId, ...filtered].slice(0, MAX_RECENT_GRAPHS);
    localStorage.setItem(RECENT_GRAPHS_KEY, JSON.stringify(updated));
  } catch {
    // Ignore errors
  }
}

function getPinnedGraphs(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(PINNED_GRAPHS_KEY);
    if (!stored) return [];
    return JSON.parse(stored);
  } catch {
    return [];
  }
}

function togglePinGraph(graphId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const pinned = getPinnedGraphs();
    const isPinned = pinned.includes(graphId);
    if (isPinned) {
      const updated = pinned.filter(id => id !== graphId);
      localStorage.setItem(PINNED_GRAPHS_KEY, JSON.stringify(updated));
    } else {
      const updated = [...pinned, graphId].slice(0, MAX_PINNED_GRAPHS);
      localStorage.setItem(PINNED_GRAPHS_KEY, JSON.stringify(updated));
    }
  } catch {
    // Ignore errors
  }
}

function isGraphPinned(graphId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const pinned = getPinnedGraphs();
    return pinned.includes(graphId);
  } catch {
    return false;
  }
}

// Render grouped search results
function renderGroupedResults(
  results: SearchResult[],
  selectedIndex: number,
  onSelect: (result: SearchResult) => void,
  setSelectedIndex: (index: number) => void,
  isRecents: boolean = false
) {
  // Order: Commands, Concepts, Evidence, Graphs, Actions
  const commands = results.filter((r): r is ActionSearchResult => r.type === 'action' && r.command.startsWith('/'));
  const concepts = results.filter((r): r is ConceptSearchResult => r.type === 'concept');
  const evidence = results.filter((r): r is EvidenceSearchResult => r.type === 'evidence');
  const graphs = results.filter((r): r is GraphSearchResult => r.type === 'graph');
  const actions = results.filter((r): r is ActionSearchResult => r.type === 'action' && !r.command.startsWith('/'));

  let currentIndex = 0;

  return (
    <>
      {commands.length > 0 && (
        <>
          <div style={{
            padding: '6px 16px',
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            Commands
          </div>
          {commands.map((result) => {
            const idx = currentIndex++;
            return (
              <div
                key={`command-${result.id}`}
                onClick={() => onSelect(result)}
                style={{
                  padding: '10px 16px',
                  cursor: 'pointer',
                  backgroundColor: idx === selectedIndex ? 'var(--panel)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  transition: 'background-color 0.1s',
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span style={{ fontSize: '16px' }}></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ink)' }}>
                    {result.label}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                    {result.description}
                  </div>
                </div>
                {result.command && (
                  <div style={{
                    fontSize: '11px',
                    color: 'var(--muted)',
                    fontFamily: 'monospace',
                    padding: '2px 6px',
                    backgroundColor: 'var(--background)',
                    borderRadius: '4px',
                  }}>
                    {result.command}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {concepts.length > 0 && (
        <>
          <div style={{
            padding: '6px 16px',
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            {isRecents ? 'Recent Concepts' : 'Concepts'}
          </div>
          {concepts.map((result) => {
            const idx = currentIndex++;
            return (
              <div
                key={`concept-${result.concept.node_id}`}
                onClick={() => onSelect(result)}
                style={{
                  padding: '10px 16px',
                  cursor: 'pointer',
                  backgroundColor: idx === selectedIndex ? 'var(--panel)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  transition: 'background-color 0.1s',
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span style={{ fontSize: '16px', color: 'var(--accent)' }}>■</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ink)' }}>
                    {result.concept.name}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                    {result.concept.domain} • {result.concept.type}
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}

      {evidence.length > 0 && (
        <>
          {(commands.length > 0 || concepts.length > 0) && <div style={{ height: '8px' }} />}
          <div style={{
            padding: '6px 16px',
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            {isRecents ? 'Recent Resources' : 'Evidence'}
          </div>
          {evidence.map((result) => {
            const idx = currentIndex++;
            return (
              <div
                key={`evidence-${result.resource.resource_id}`}
                onClick={() => onSelect(result)}
                style={{
                  padding: '10px 16px',
                  cursor: 'pointer',
                  backgroundColor: idx === selectedIndex ? 'var(--panel)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  transition: 'background-color 0.1s',
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span style={{ fontSize: '16px' }}></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ink)' }}>
                    {result.resource.title || 'Untitled Resource'}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                    {result.resource.kind} {result.resource.source ? `• ${result.resource.source}` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}

      {graphs.length > 0 && (
        <>
          {(commands.length > 0 || concepts.length > 0 || evidence.length > 0) && <div style={{ height: '8px' }} />}
          <div style={{
            padding: '6px 16px',
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            Graphs
          </div>
          {graphs.map((result) => {
            const idx = currentIndex++;
            const graph = result.graph;
            const nc = graph.node_count ?? 0;
            const ec = graph.edge_count ?? 0;
            const metaLine = `${nc} topic${nc !== 1 ? 's' : ''} · ${ec} connection${ec !== 1 ? 's' : ''}`;
            return (
              <div
                key={`graph-${graph.graph_id}`}
                onClick={() => onSelect(result)}
                style={{
                  padding: '10px 16px',
                  cursor: 'pointer',
                  backgroundColor: idx === selectedIndex ? 'var(--panel)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  transition: 'background-color 0.1s',
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span style={{ fontSize: '16px' }}></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ink)' }}>
                    {graph.name || graph.graph_id}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                    {metaLine}
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}

      {actions.length > 0 && (
        <>
          {(commands.length > 0 || concepts.length > 0 || evidence.length > 0 || graphs.length > 0) && <div style={{ height: '8px' }} />}
          <div style={{
            padding: '6px 16px',
            fontSize: '11px',
            fontWeight: 600,
            color: 'var(--muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            {isRecents ? 'Recent Commands' : 'Actions'}
          </div>
          {actions.map((result) => {
            const idx = currentIndex++;
            return (
              <div
                key={`action-${result.id}`}
                onClick={() => onSelect(result)}
                style={{
                  padding: '10px 16px',
                  cursor: 'pointer',
                  backgroundColor: idx === selectedIndex ? 'var(--panel)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  transition: 'background-color 0.1s',
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
              >
                <span style={{ fontSize: '16px' }}></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ink)' }}>
                    {result.label}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                    {result.description}
                  </div>
                </div>
                {result.command && (
                  <div style={{
                    fontSize: '11px',
                    color: 'var(--muted)',
                    fontFamily: 'monospace',
                    padding: '2px 6px',
                    backgroundColor: 'var(--background)',
                    borderRadius: '4px',
                  }}>
                    {result.command}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}
    </>
  );
}

function formatRelativeTime(isoString: string | null | undefined): string {
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
}

// Preview panel component
function renderPreviewPanel(
  selectedResult: SearchResult | null,
  previewConcept: Concept | null,
  previewLoading: boolean,
  onPrimaryAction: () => void,
  onSecondaryAction?: () => void,
  onPinAction?: () => void,
  isPinned?: boolean
) {
  if (!selectedResult) return null;

  if (selectedResult.type === 'concept') {
    const concept = previewConcept || selectedResult.concept;
    const description = concept.description || '';
    const truncatedDesc = description.length > 150 ? description.slice(0, 150) + '...' : description;

    return (
      <div style={{
        width: '300px',
        borderLeft: '1px solid var(--border)',
        padding: '16px',
        backgroundColor: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px' }}>
            {concept.name}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>
            {concept.domain} • {concept.type}
          </div>
          {truncatedDesc && (
            <div style={{ fontSize: '13px', color: 'var(--ink)', lineHeight: '1.5', marginTop: '8px' }}>
              {truncatedDesc}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 'auto' }}>
          <button
            onClick={onPrimaryAction}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--accent)',
              color: 'white',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--accent)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--accent)'}
          >
            Open
          </button>
          {onSecondaryAction && (
            <button
              onClick={onSecondaryAction}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                backgroundColor: 'transparent',
                color: 'var(--ink)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--panel)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              Fetch evidence
            </button>
          )}
          {onPinAction && (
            <button
              onClick={onPinAction}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                backgroundColor: 'transparent',
                color: 'var(--ink)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--panel)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              {isPinned ? 'Unpin' : 'Pin concept'}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (selectedResult.type === 'evidence') {
    const resource = selectedResult.resource;
    const snippet = resource.metadata?.snippet || resource.caption || '';
    const truncatedSnippet = snippet.length > 150 ? snippet.slice(0, 150) + '...' : snippet;

    return (
      <div style={{
        width: '300px',
        borderLeft: '1px solid var(--border)',
        padding: '16px',
        backgroundColor: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px' }}>
            {resource.title || 'Untitled Resource'}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>
            {resource.kind} {resource.source ? `• ${resource.source}` : ''}
          </div>
          {selectedResult.concept_id && (
            <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>
              Concept: {selectedResult.concept_name || selectedResult.concept_id}
            </div>
          )}
          {truncatedSnippet && (
            <div style={{ fontSize: '13px', color: 'var(--ink)', lineHeight: '1.5', marginTop: '8px' }}>
              {truncatedSnippet}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 'auto' }}>
          <button
            onClick={onPrimaryAction}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--accent)',
              color: 'white',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--accent)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--accent)'}
          >
            Open evidence
          </button>
          {onSecondaryAction && (
            <button
              onClick={onSecondaryAction}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                backgroundColor: 'transparent',
                color: 'var(--ink)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--panel)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              Open concept
            </button>
          )}
        </div>
      </div>
    );
  }

  if (selectedResult.type === 'action') {
    return (
      <div style={{
        width: '300px',
        borderLeft: '1px solid var(--border)',
        padding: '16px',
        backgroundColor: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px' }}>
            {selectedResult.label}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--ink)', lineHeight: '1.5', marginTop: '8px' }}>
            {selectedResult.description}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 'auto' }}>
          <button
            onClick={onPrimaryAction}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--accent)',
              color: 'white',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--accent)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--accent)'}
          >
            Run
          </button>
        </div>
      </div>
    );
  }

  if (selectedResult.type === 'graph') {
    const graph = selectedResult.graph;
    const _nc = graph.node_count ?? 0;
    const _ec = graph.edge_count ?? 0;
    const metaLine = `${_nc} topic${_nc !== 1 ? 's' : ''} · ${_ec} connection${_ec !== 1 ? 's' : ''}`;
    const updated = formatRelativeTime(graph.updated_at);

    return (
      <div style={{
        width: '300px',
        borderLeft: '1px solid var(--border)',
        padding: '16px',
        backgroundColor: 'var(--surface)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px' }}>
            {graph.name || graph.graph_id}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '8px' }}>
            {metaLine} · updated {updated}
          </div>
          {graph.description && (
            <div style={{ fontSize: '13px', color: 'var(--ink)', lineHeight: '1.5', marginTop: '8px' }}>
              {graph.description}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: 'auto' }}>
          <button
            onClick={onPrimaryAction}
            style={{
              padding: '8px 12px',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--accent)',
              color: 'white',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'background-color 0.2s',
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--accent)'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--accent)'}
          >
            Open explorer
          </button>
          {onSecondaryAction && (
            <button
              onClick={onSecondaryAction}
              style={{
                padding: '8px 12px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                backgroundColor: 'transparent',
                color: 'var(--ink)',
                fontSize: '13px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--panel)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              Graph Details
            </button>
          )}
        </div>
      </div>
    );
  }

  return null;
}

export default function TopBar() {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { setIsMobileSidebarOpen } = useSidebar();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const [graphs, setGraphs] = useState<GraphSummary[]>([]);
  const [activeGraphId, setActiveGraphId] = useState<string>('');
  const [loadingGraphs, setLoadingGraphs] = useState(true);

  // Scope state for omnibox
  const [searchScope, setSearchScope] = useState<'current' | 'all' | string>('current'); // 'current', 'all', or graph_id
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false);
  const [scopePickerOpen, setScopePickerOpen] = useState(false);
  const scopeMenuRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedResultIndex, setSelectedResultIndex] = useState(-1);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const createGraphInputRef = useRef<HTMLInputElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const searchAbortControllerRef = useRef<AbortController | null>(null);

  // Preview panel state
  const [previewConcept, setPreviewConcept] = useState<Concept | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const conceptCacheRef = useRef<Map<string, Concept>>(new Map());

  const [graphSwitcherOpen, setGraphSwitcherOpen] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [createGraphOpen, setCreateGraphOpen] = useState(false);
  const [createGraphName, setCreateGraphName] = useState('');
  const [createGraphError, setCreateGraphError] = useState<string | null>(null);
  const [createGraphLoading, setCreateGraphLoading] = useState(false);
  const [createGraphTemplateId, setCreateGraphTemplateId] = useState('blank');
  const [createGraphIntent, setCreateGraphIntent] = useState('');
  const [createGraphApplyRefreshDefaults, setCreateGraphApplyRefreshDefaults] = useState(false);
  const [createGraphRefreshPresetId, setCreateGraphRefreshPresetId] = useState<RefreshTemplatePresetId>('none');
  const [customTemplates, setCustomTemplates] = useState<WorkspaceTemplate[]>([]);
  const [customTemplatesLoading, setCustomTemplatesLoading] = useState(false);
  const [graphSearchQuery, setGraphSearchQuery] = useState('');
  const [scopePickerSearchQuery, setScopePickerSearchQuery] = useState('');
  const graphSwitcherRef = useRef<HTMLDivElement>(null);
  const newMenuRef = useRef<HTMLDivElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const createGraphDeepLinkHandledRef = useRef<string | null>(null);
  const [isNewNoteModalOpen, setNewNoteModalOpen] = useState(false);


  // Load graphs on mount
  useEffect(() => {
    async function loadGraphs() {
      try {
        setLoadingGraphs(true);
        const data = await listGraphs();
        setGraphs(data.graphs || []);
        setActiveGraphId(data.active_graph_id || '');

        // Track current graph as recent
        if (data.active_graph_id) {
          addRecentGraph(data.active_graph_id);
        }
      } catch (err) {
        console.error('Failed to load graphs:', err);
        setGraphs([]);
      } finally {
        setLoadingGraphs(false);
      }
    }
    loadGraphs();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadCustomTemplates() {
      try {
        setCustomTemplatesLoading(true);
        const response = await listWorkspaceTemplates();
        if (!cancelled) {
          setCustomTemplates(Array.isArray(response.templates) ? response.templates : []);
        }
      } catch (err) {
        console.warn('Failed to load custom templates:', err);
        if (!cancelled) {
          setCustomTemplates([]);
        }
      } finally {
        if (!cancelled) {
          setCustomTemplatesLoading(false);
        }
      }
    }
    void loadCustomTemplates();
    return () => {
      cancelled = true;
    };
  }, []);

  // Update active graph when URL changes - sync with URL param
  useEffect(() => {
    const graphIdParam = searchParams?.get('graph_id');
    if (graphIdParam) {
      if (graphIdParam !== activeGraphId) {
        setActiveGraphId(graphIdParam);
        addRecentGraph(graphIdParam);
      }
      // Reset scope to current when graph changes
      if (searchScope === 'current' || searchScope === graphIdParam) {
        setSearchScope('current');
      }
    } else {
      // If no graph_id in URL, use 'default' or keep current
      if (!activeGraphId) {
        setActiveGraphId('default');
      }
    }
  }, [searchParams]);

  // Get effective graph_id for search based on scope
  const getSearchGraphId = (): string | undefined => {
    if (searchScope === 'current') {
      return activeGraphId || undefined;
    } else if (searchScope === 'all') {
      return undefined; // All graphs (disabled in v1)
    } else {
      return searchScope; // Specific graph_id
    }
  };

  // Get scope display name
  const getScopeDisplayName = (): string => {
    if (searchScope === 'current') {
      return 'This graph';
    } else if (searchScope === 'all') {
      return 'All graphs';
    } else {
      const graph = graphs.find(g => g.graph_id === searchScope);
      return graph?.name || searchScope;
    }
  };

  // Cmd/Ctrl+K shortcut to focus omnibox
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setSearchFocused(true);
        // Log telemetry
        logEvent({ type: 'GRAPH_SWITCHED', payload: { event: 'OMNIBOX_OPENED' } }).catch(() => { });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Log omnibox opened when focused
  useEffect(() => {
    if (searchFocused) {
      // Use a generic event type since OMNIBOX_OPENED is not in the EventType union
      logEvent({ type: 'GRAPH_SWITCHED', payload: { event: 'OMNIBOX_OPENED' } }).catch(() => { });
    }
  }, [searchFocused]);

  // Load recents when query is empty
  const loadRecents = useCallback(async () => {
    try {
      // Get recent concepts from localStorage (fallback to event log)
      const recentConceptViews = getRecentConceptViews().slice(0, 6);
      const recentConcepts: ConceptSearchResult[] = [];

      // Try to get concepts from event log first
      try {
        const events = await fetchRecentEvents({ limit: 20, graph_id: activeGraphId || undefined });
        const conceptEvents = events
          .filter(e => e.type === 'CONCEPT_VIEWED' && e.concept_id)
          .slice(0, 6)
          .map(e => ({
            type: 'concept' as const,
            concept: {
              node_id: e.concept_id!,
              name: e.payload?.concept_name || 'Unknown',
              domain: '',
              type: '',
            } as Concept,
          }));

        if (conceptEvents.length > 0) {
          recentConcepts.push(...conceptEvents);
        } else {
          // Fallback to localStorage
          for (const view of recentConceptViews) {
            recentConcepts.push({
              type: 'concept',
              concept: {
                node_id: view.id,
                name: view.name,
                domain: '',
                type: '',
              } as Concept,
            });
          }
        }
      } catch {
        // Fallback to localStorage
        for (const view of recentConceptViews) {
          recentConcepts.push({
            type: 'concept',
            concept: {
              node_id: view.id,
              name: view.name,
              domain: '',
              type: '',
            } as Concept,
          });
        }
      }

      // Get recent resources from localStorage
      const recentResources = getOmniboxRecentResources().slice(0, 4).map(r => ({
        type: 'evidence' as const,
        resource: {
          resource_id: r.resource_id,
          title: r.title || 'Untitled Resource',
          kind: r.kind || 'file',
          url: '',
        } as Resource,
        concept_id: r.concept_id,
        concept_name: r.concept_name,
      }));

      // Get recent commands from localStorage
      const recentCommands = getOmniboxRecentCommands().slice(0, 3).map(c => ({
        type: 'action' as const,
        id: c.id,
        label: c.label,
        description: '',
        command: c.command,
      }));

      setSearchResults([...recentConcepts, ...recentResources, ...recentCommands]);
      setSelectedResultIndex(-1);
    } catch (err) {
      console.error('Failed to load recents:', err);
      setSearchResults([]);
    }
  }, [activeGraphId]);

  useEffect(() => {
    if (!searchQuery.trim() && searchFocused) {
      loadRecents();
    }
  }, [searchQuery, searchFocused, loadRecents]);

  // Omnibox search with debounce and cancellation
  useEffect(() => {
    if (!searchQuery.trim()) {
      // Don't clear results if focused - show recents instead
      if (!searchFocused) {
        setSearchResults([]);
      }
      setSearchLoading(false);
      return;
    }

    // Cancel previous request
    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
    }

    // Create new abort controller
    const abortController = new AbortController();
    searchAbortControllerRef.current = abortController;

    setSearchLoading(true);

    const timeoutId = setTimeout(async () => {
      try {
        const query = searchQuery.trim();
        const isCommand = query.startsWith('/') || query.startsWith('>');

        // Get actions (frontend-defined)
        const actions = getActionsForQuery(query, activeGraphId);

        // If it's a command, only show actions
        if (isCommand) {
          setSearchResults(actions);
          setSelectedResultIndex(-1);
          setSearchLoading(false);
          return;
        }

        // Check if query matches graph patterns
        const queryLower = query.toLowerCase();
        const isGraphQuery = queryLower.startsWith('g ') || queryLower.startsWith('graph ') ||
          graphs.some(g => (g.name || '').toLowerCase().includes(queryLower) ||
            g.graph_id.toLowerCase().includes(queryLower));

        // Get graph results if relevant
        let graphResults: GraphSearchResult[] = [];
        if (isGraphQuery) {
          const matchedGraphs = graphs
            .filter(g => {
              const nameMatch = (g.name || '').toLowerCase().includes(queryLower);
              const idMatch = g.graph_id.toLowerCase().includes(queryLower);
              return nameMatch || idMatch;
            })
            .slice(0, 6)
            .map((g): GraphSearchResult => ({
              type: 'graph',
              graph: g,
            }));
          graphResults = matchedGraphs;
        }

        // Get effective graph_id for search
        const searchGraphId = getSearchGraphId();
        const lastSession = getLastSession();
        const branchId = typeof window !== 'undefined'
          ? sessionStorage.getItem('brainweb:activeBranchId') || 'main'
          : 'main';

        // Check if offline search is enabled
        const offlineSearchEnabled = typeof window !== 'undefined'
          ? localStorage.getItem('brainweb:offlineSearchEnabled') !== 'false'
          : true;

        // Try offline search first if enabled
        let offlineResources: any[] = [];
        if (offlineSearchEnabled) {
          try {
            const offlineResult = await searchAll({
              query,
              offlineSearchEnabled: true,
              graph_id: searchGraphId,
              branch_id: branchId,
            });
            if (offlineResult.mode === 'offline' || offlineResult.mode === 'hybrid') {
              offlineResources = offlineResult.results || [];
            }
          } catch (err) {
            console.warn('Offline search failed:', err);
          }
        }

        // Search concepts and resources in parallel (fallback to server if offline search didn't return enough)
        const shouldUseServerSearch = !offlineSearchEnabled || offlineResources.length < 6;
        const [conceptsData, resourcesData] = await Promise.all([
          searchConcepts(query, searchGraphId, 8).catch(() => ({ results: [], count: 0 })),
          shouldUseServerSearch
            ? searchResources(query, searchGraphId, 6).catch(() => [])
            : Promise.resolve([]),
        ]);

        if (abortController.signal.aborted) return;

        // Build results in order: Commands, Concepts, Evidence, Graphs, Actions
        const results: SearchResult[] = [
          // Commands (already filtered)
          ...actions.filter(a => a.command.startsWith('/')),
          // Concepts
          ...(conceptsData.results || []).map((c: Concept): ConceptSearchResult => ({
            type: 'concept',
            concept: c,
          })),
          // Evidence/Resources (prefer offline results if available, otherwise server results)
          ...(offlineResources.length > 0 ? offlineResources : (resourcesData || [])).map((r: Resource | any): EvidenceSearchResult => ({
            type: 'evidence',
            resource: r,
            concept_id: r.metadata?._concept_id as string | undefined,
            concept_name: r.metadata?._concept_name as string | undefined,
          })),
          // Graphs
          ...graphResults,
          // Actions (non-command actions)
          ...actions.filter(a => !a.command.startsWith('/')).slice(0, 3),
        ].slice(0, 12); // Limit to 12 total results

        setSearchResults(results);
        setSelectedResultIndex(-1);
      } catch (err) {
        if (abortController.signal.aborted) return;
        console.error('Search failed:', err);
        setSearchResults([]);
      } finally {
        if (!abortController.signal.aborted) {
          setSearchLoading(false);
        }
      }
    }, 250); // 250ms debounce

    return () => {
      clearTimeout(timeoutId);
      if (searchAbortControllerRef.current) {
        searchAbortControllerRef.current.abort();
      }
    };
  }, [searchQuery, activeGraphId, searchScope]);

  // Helper function to get actions based on query
  function getActionsForQuery(query: string, graphId: string): ActionSearchResult[] {
    const normalizedQuery = query.toLowerCase().trim();
    const isCommand = normalizedQuery.startsWith('/') || normalizedQuery.startsWith('>');
    const commandPart = isCommand ? normalizedQuery.slice(1).trim() : normalizedQuery;

    // Parse command with optional arguments (e.g., "/lens learning", "/review proposed")
    const [baseCommand, ...args] = commandPart.split(/\s+/);
    const argString = args.join(' ');

    const allActions: ActionSearchResult[] = [
      {
        type: 'action',
        id: 'digest',
        label: 'Open Digest',
        description: 'View weekly digest and suggestions',
        command: '/digest',
        icon: '📊',
      },
      {
        type: 'action',
        id: 'saved',
        label: 'Open Saved',
        description: 'View saved items',
        command: '/saved',
        icon: '⭐',
      },
      {
        type: 'action',
        id: 'review',
        label: 'Review proposed relationships',
        description: 'Review and accept/reject proposed connections',
        command: '/review',
        icon: '✓',
      },
      {
        type: 'action',
        id: 'ingest',
        label: 'Import Content',
        description: 'Import new content into your knowledge graph',
        command: '/ingest',
        icon: '📥',
      },
      {
        type: 'action',
        id: 'browse-graph',
        label: 'Graph Details',
        description: 'Open graph browse page',
        command: '/browse-graph',
        icon: '📊',
      },
      {
        type: 'action',
        id: 'switch-graph',
        label: 'Switch Graph',
        description: 'Open graph picker',
        command: '/switch-graph',
        icon: '🔄',
      },
      {
        type: 'action',
        id: 'lens-none',
        label: 'Set Lens: None',
        description: 'Clear lens filter',
        command: '/lens none',
        icon: '👁️',
      },
      {
        type: 'action',
        id: 'lens-learning',
        label: 'Set Lens: Learning',
        description: 'Apply learning lens',
        command: '/lens learning',
        icon: '📚',
      },
      {
        type: 'action',
        id: 'clear-highlights',
        label: 'Clear Highlights',
        description: 'Clear all highlights',
        command: '/clear-highlights',
        icon: '🧹',
      },
      {
        type: 'action',
        id: 'fetch-evidence',
        label: 'Fetch evidence',
        description: 'Fetch evidence for a concept',
        command: '/fetch-evidence',
        icon: '🔍',
      },
      {
        type: 'action',
        id: 'paths',
        label: 'Start a suggested path',
        description: 'Browse and start learning paths',
        command: '/paths',
        icon: '🛤️',
      },
      {
        type: 'action',
        id: 'add-node',
        label: 'Add node',
        description: 'Add a new node to the graph (e.g., /add node "Concept Name")',
        command: '/add node',
        icon: '➕',
      },
      {
        type: 'action',
        id: 'link-node',
        label: 'Link nodes',
        description: 'Link two nodes together (e.g., /link "Source" to "Target")',
        command: '/link',
        icon: '🔗',
      },
      {
        type: 'action',
        id: 'remove-node',
        label: 'Remove node',
        description: 'Remove a node from the graph (e.g., /remove node "Concept Name")',
        command: '/remove node',
        icon: '🗑️',
      },
    ];

    if (!isCommand && normalizedQuery.length === 0) {
      return allActions;
    }

    // Special handling for lens command
    if (baseCommand === 'lens' || baseCommand === '') {
      if (argString === '' || argString === 'none' || argString === 'learning') {
        return allActions.filter(a => a.id.startsWith('lens-'));
      }
    }

    // Special handling for add/link/remove commands - show them when user types the base command
    if (baseCommand === 'add' || baseCommand === 'link' || baseCommand === 'remove' || baseCommand === 'delete') {
      if (baseCommand === 'add') {
        return allActions.filter(a => a.id === 'add-node');
      } else if (baseCommand === 'link') {
        return allActions.filter(a => a.id === 'link-node');
      } else if (baseCommand === 'remove' || baseCommand === 'delete') {
        return allActions.filter(a => a.id === 'remove-node');
      }
    }

    // Filter actions based on query
    return allActions.filter(action => {
      const matchLabel = action.label.toLowerCase().includes(commandPart);
      const matchDesc = action.description.toLowerCase().includes(commandPart);
      const matchCommand = action.command.toLowerCase().includes(normalizedQuery);
      const matchBase = baseCommand && action.command.toLowerCase().includes(`/${baseCommand}`);
      return matchLabel || matchDesc || matchCommand || matchBase;
    });
  }

  // Load preview when selected index changes
  useEffect(() => {
    if (selectedResultIndex >= 0 && searchResults[selectedResultIndex]) {
      const result = searchResults[selectedResultIndex];
      if (result.type === 'concept') {
        // Check cache first
        const cached = conceptCacheRef.current.get(result.concept.node_id);
        if (cached) {
          setPreviewConcept(cached);
          setPreviewLoading(false);
        } else if (result.concept.description) {
          // Use description from search result if available
          setPreviewConcept(result.concept);
          setPreviewLoading(false);
        } else {
          // Fetch full concept only if needed
          setPreviewLoading(true);
          getConcept(result.concept.node_id)
            .then(concept => {
              conceptCacheRef.current.set(concept.node_id, concept);
              setPreviewConcept(concept);
              setPreviewLoading(false);
            })
            .catch(() => {
              setPreviewConcept(result.concept);
              setPreviewLoading(false);
            });
        }
      } else {
        setPreviewConcept(null);
        setPreviewLoading(false);
      }
    } else {
      setPreviewConcept(null);
      setPreviewLoading(false);
    }
  }, [selectedResultIndex, searchResults]);

  // Define these callbacks first (in dependency order)
  const handleFetchEvidence = useCallback(async (conceptId: string, conceptName: string) => {
    try {
      const result = await fetchEvidenceForConcept(conceptId, conceptName, activeGraphId || undefined);
      if (result.error) {
        console.error('Failed to fetch evidence:', result.error);
        alert(`Failed to fetch evidence: ${result.error}`);
      } else {
        // Navigate to explorer with concept selected to show new evidence
        const params = new URLSearchParams();
        params.set('select', conceptId);
        if (activeGraphId) {
          params.set('graph_id', activeGraphId);
        }
        router.push(`/?${params.toString()}`);
      }
    } catch (error) {
      console.error('Error fetching evidence:', error);
      alert('Failed to fetch evidence');
    }
  }, [router, activeGraphId]);

  const executeAction = useCallback(async (actionId: string, command: string, graphId: string) => {
    const params = new URLSearchParams();
    if (graphId) {
      params.set('graph_id', graphId);
    }

    // Parse command arguments - handle quoted strings
    const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
    const baseCommand = parts[0]?.slice(1).toLowerCase() || '';
    const args = parts.slice(1).map(arg => arg.replace(/^"|"$/g, ''));

    switch (actionId) {
      case 'digest':
        router.push('/digest');
        break;
      case 'saved':
        router.push('/saved');
        break;
      case 'review':
        params.set('status', 'PROPOSED');
        router.push(`/review?${params.toString()}`);
        break;
      case 'ingest':
        router.push('/source-management');
        break;
      case 'browse-graph':
        if (graphId) {
          router.push(`/graphs/${graphId}`);
        } else {
          router.push('/');
        }
        break;
      case 'switch-graph':
        setGraphSwitcherOpen(true);
        break;
      case 'clear-highlights':
        // Clear highlights - this would need to be implemented in the graph visualization
        console.log('Clear highlights - to be implemented');
        break;
      case 'fetch-evidence':
        // Navigate to explorer - user can select concept and fetch evidence
        router.push(`/?${params.toString()}`);
        break;
      case 'paths':
        // Navigate to home page where paths are shown
        router.push(`/home?${params.toString()}`);
        break;
      case 'add-node': {
        // Parse: /add node "Name" [domain] or /add "Name" [domain] or /add node Name [domain]
        let nodeName = '';
        let domain = 'general';

        if (baseCommand === 'add' && args.length > 0) {
          // Check if first arg is "node"
          if (args[0]?.toLowerCase() === 'node' && args.length > 1) {
            nodeName = args[1];
            domain = args[2] || 'general';
          } else {
            // First arg is the node name
            nodeName = args[0];
            domain = args[1] || 'general';
          }
        }

        if (!nodeName) {
          // Prompt user for node name
          const name = prompt('Enter node name:');
          if (!name) return;
          nodeName = name.trim();
          const domainInput = prompt('Enter domain (optional, default: general):');
          if (domainInput) domain = domainInput.trim();
        }

        if (nodeName && graphId) {
          try {
            await selectGraph(graphId);
            const newConcept = await createConcept({
              name: nodeName,
              domain: domain,
              type: 'concept',
              graph_id: graphId,
            });
            // Navigate to the new node
            params.set('select', newConcept.node_id);
            router.push(`/?${params.toString()}`);
          } catch (err) {
            console.error('Failed to add node:', err);
            alert(`Failed to add node: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        } else if (!graphId) {
          alert('Please select a graph first');
        }
        break;
      }
      case 'link-node': {
        // Parse: /link "Source" to "Target" or /link "Source" "Target" or /link Source Target
        let sourceName = '';
        let targetName = '';

        if (args.length >= 2) {
          sourceName = args[0];
          // Check if second arg is "to"
          if (args[1]?.toLowerCase() === 'to' && args.length >= 3) {
            targetName = args[2];
          } else {
            targetName = args[1];
          }
        }

        if (!sourceName || !targetName) {
          const sourceInput = prompt('Enter source node name:');
          if (!sourceInput) return;
          sourceName = sourceInput.trim();

          const targetInput = prompt('Enter target node name:');
          if (!targetInput) return;
          targetName = targetInput.trim();
        }

        if (sourceName && targetName && graphId) {
          try {
            await selectGraph(graphId);
            // Search for both concepts
            const [sourceResults, targetResults] = await Promise.all([
              searchConcepts(sourceName, graphId, 5),
              searchConcepts(targetName, graphId, 5),
            ]);

            const sourceConcept = sourceResults.results.find(c =>
              c.name.toLowerCase() === sourceName.toLowerCase()
            ) || sourceResults.results[0];

            const targetConcept = targetResults.results.find(c =>
              c.name.toLowerCase() === targetName.toLowerCase()
            ) || targetResults.results[0];

            if (!sourceConcept) {
              alert(`Source node "${sourceName}" not found`);
              return;
            }
            if (!targetConcept) {
              alert(`Target node "${targetName}" not found`);
              return;
            }

            // Create relationship (default predicate: "related_to")
            await createRelationshipByIds(
              sourceConcept.node_id,
              targetConcept.node_id,
              'related_to'
            );

            // Navigate to show the link
            params.set('select', sourceConcept.node_id);
            router.push(`/?${params.toString()}`);
          } catch (err) {
            console.error('Failed to link nodes:', err);
            alert(`Failed to link nodes: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        } else if (!graphId) {
          alert('Please select a graph first');
        }
        break;
      }
      case 'remove-node': {
        // Parse: /remove node "Name" or /delete node "Name" or /remove "Name" or /delete "Name"
        let nodeName = '';

        if (args.length > 0) {
          // Check if first arg is "node"
          if (args[0]?.toLowerCase() === 'node' && args.length > 1) {
            nodeName = args[1];
          } else {
            nodeName = args[0];
          }
        }

        if (!nodeName) {
          const name = prompt('Enter node name to remove:');
          if (!name) return;
          nodeName = name.trim();
        }

        if (nodeName && graphId) {
          try {
            await selectGraph(graphId);
            // Search for the concept
            const searchResults = await searchConcepts(nodeName, graphId, 5);
            const concept = searchResults.results.find(c =>
              c.name.toLowerCase() === nodeName.toLowerCase()
            ) || searchResults.results[0];

            if (!concept) {
              alert(`Node "${nodeName}" not found`);
              return;
            }

            // Confirm deletion
            if (!confirm(`Are you sure you want to delete "${concept.name}"? This will remove the node and all its relationships.`)) {
              return;
            }

            await deleteConcept(concept.node_id);
            // Dispatch event for confirmation button
            window.dispatchEvent(new CustomEvent('graph-action', { detail: { type: 'deleted' } }));
            // Navigate back to explorer
            router.push(`/?${params.toString()}`);
          } catch (err) {
            console.error('Failed to remove node:', err);
            alert(`Failed to remove node: ${err instanceof Error ? err.message : 'Unknown error'}`);
          }
        } else if (!graphId) {
          alert('Please select a graph first');
        }
        break;
      }
      default:
        console.warn('Unknown action:', actionId);
    }
  }, [router]);

  const handleSelectResult = useCallback((result: SearchResult, isSecondary: boolean = false) => {
    // Log telemetry
    logEvent({
      type: 'GRAPH_SWITCHED',
      payload: {
        event: 'OMNIBOX_RESULT_SELECTED',
        kind: result.type,
        id: result.type === 'concept' ? result.concept.node_id :
          result.type === 'evidence' ? result.resource.resource_id :
            result.type === 'graph' ? result.graph.graph_id :
              result.id,
      },
    }).catch(() => { });

    if (result.type === 'concept') {
      if (isSecondary) {
        // Secondary action: Fetch evidence
        handleFetchEvidence(result.concept.node_id, result.concept.name);
      } else {
        // Primary action: Open concept
        addOmniboxRecentConcept({
          node_id: result.concept.node_id,
          name: result.concept.name,
          domain: result.concept.domain,
          type: result.concept.type,
        });
        pushRecentConceptView({ id: result.concept.node_id, name: result.concept.name });

        const params = new URLSearchParams();
        params.set('select', result.concept.node_id);
        const graphId = getSearchGraphId() || activeGraphId;
        if (graphId) {
          params.set('graph_id', graphId);
        }
        router.push(`/?${params.toString()}`);
      }
    } else if (result.type === 'evidence') {
      if (isSecondary && result.concept_id) {
        // Secondary action: Open concept
        const params = new URLSearchParams();
        params.set('select', result.concept_id);
        const graphId = getSearchGraphId() || activeGraphId;
        if (graphId) {
          params.set('graph_id', graphId);
        }
        router.push(`/?${params.toString()}`);
      } else {
        // Primary action: Open resource
        addOmniboxRecentResource({
          resource_id: result.resource.resource_id,
          title: result.resource.title || undefined,
          kind: result.resource.kind,
          concept_id: result.concept_id,
          concept_name: result.concept_name,
        });

        const params = new URLSearchParams();
        params.set('resource_id', result.resource.resource_id);
        if (result.concept_id) {
          params.set('concept_id', result.concept_id);
        }
        const graphId = getSearchGraphId() || activeGraphId;
        if (graphId) {
          params.set('graph_id', graphId);
        }
        router.push(`/reader?${params.toString()}`);
      }
    } else if (result.type === 'graph') {
      if (isSecondary) {
        // Secondary action: Browse graph
        router.push(`/graphs/${result.graph.graph_id}`);
      } else {
        // Primary action: Open explorer for that graph
        const params = new URLSearchParams(window.location.search);
        params.set('graph_id', result.graph.graph_id);
        const targetPath = pathname === '/' ? '/home' : pathname;
        router.push(`${targetPath}?${params.toString()}`);
      }
    } else if (result.type === 'action') {
      // Execute action - use the full search query if it's a command, otherwise use the base command
      const fullCommand = searchQuery.trim().startsWith('/') || searchQuery.trim().startsWith('>')
        ? searchQuery.trim()
        : result.command;
      addOmniboxRecentCommand({
        id: result.id,
        label: result.label,
        command: fullCommand,
      });
      executeAction(result.id, fullCommand, activeGraphId);
    }
    setSearchFocused(false);
    setSearchQuery('');
    setSearchResults([]);
    setPreviewConcept(null);
    searchInputRef.current?.blur();
  }, [router, activeGraphId, searchQuery, executeAction, handleFetchEvidence]);

  // Keyboard navigation in search
  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedResultIndex(prev =>
        prev < searchResults.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedResultIndex(prev => prev > -1 ? prev - 1 : -1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const isSecondary = e.metaKey || e.ctrlKey;
      if (selectedResultIndex >= 0 && searchResults[selectedResultIndex]) {
        handleSelectResult(searchResults[selectedResultIndex], isSecondary);
      } else if (searchResults.length > 0) {
        // Select first result if none selected
        handleSelectResult(searchResults[0], isSecondary);
      }
    } else if (e.key === 'Escape') {
      setSearchFocused(false);
      setSearchQuery('');
      setSearchResults([]);
      setPreviewConcept(null);
      searchInputRef.current?.blur();
    }
  }, [searchResults, selectedResultIndex, handleSelectResult]);

  const handlePinConcept = useCallback((concept: Concept) => {
    togglePinConcept({ id: concept.node_id, name: concept.name }, activeGraphId || undefined);
  }, [activeGraphId]);

  // Graph switching
  const handleSelectGraph = useCallback(async (graphId: string) => {
    try {
      await selectGraph(graphId);
      setActiveGraphId(graphId);
      addRecentGraph(graphId);

      // Update session state
      const graph = graphs.find(g => g.graph_id === graphId);
      setLastSession({
        graph_id: graphId,
        graph_name: graph?.name || graphId,
      });

      // Log graph switched event
      logEvent({
        type: 'GRAPH_SWITCHED',
        graph_id: graphId,
      });

      // Navigate to current content with new graph_id
      const params = new URLSearchParams(window.location.search);
      params.set('graph_id', graphId);
      // If we're on root, go to /home (which is where root redirects anyway)
      const targetPath = pathname === '/' ? '/home' : pathname;
      router.push(`${targetPath}?${params.toString()}`);

      setGraphSwitcherOpen(false);
    } catch (err) {
      console.error('Failed to switch graph:', err);
    }
  }, [graphs, router, pathname]);

  const handleCreateGraph = useCallback(() => {
    setCreateGraphName('');
    setCreateGraphError(null);
    setCreateGraphTemplateId('blank');
    setCreateGraphIntent('');
    setCreateGraphRefreshPresetId('none');
    setCreateGraphApplyRefreshDefaults(false);
    setCreateGraphOpen(true);
    setNewMenuOpen(false);
    setGraphSwitcherOpen(false);
  }, []);

  const handleConfirmCreateGraph = useCallback(async () => {
    const name = createGraphName.trim();
    if (!name) {
      setCreateGraphError('Please enter a graph name.');
      return;
    }

    const selectedBuiltInTemplate = GRAPH_TEMPLATES.find(template => template.id === createGraphTemplateId);
    const selectedCustomTemplate = isCustomTemplateOptionId(createGraphTemplateId)
      ? customTemplates.find((template) => customTemplateOptionId(template.template_id) === createGraphTemplateId)
      : null;
    const options: CreateGraphOptions = {};

    if (selectedBuiltInTemplate && selectedBuiltInTemplate.id !== 'blank') {
      options.template_id = selectedBuiltInTemplate.id;
      options.template_label = selectedBuiltInTemplate.label;
      options.template_description = selectedBuiltInTemplate.description;
      options.template_tags = selectedBuiltInTemplate.tags;
    } else if (selectedCustomTemplate) {
      options.template_id = selectedCustomTemplate.template_id;
      options.template_label = selectedCustomTemplate.label;
      options.template_description = selectedCustomTemplate.description || undefined;
      options.template_tags = selectedCustomTemplate.tags || [];
      if (!createGraphIntent.trim() && selectedCustomTemplate.intent) {
        options.intent = selectedCustomTemplate.intent;
      }
    }

    if (createGraphIntent.trim()) {
      options.intent = createGraphIntent.trim();
    }

    setCreateGraphLoading(true);
    setCreateGraphError(null);
    try {
      const result = await createGraph(name, Object.keys(options).length ? options : undefined);

      if (createGraphApplyRefreshDefaults) {
        const defaults = selectedCustomTemplate?.refresh_defaults
          ? cloneRefreshDefaults(selectedCustomTemplate.refresh_defaults)
          : cloneRefreshDefaults(REFRESH_TEMPLATE_PRESETS[createGraphRefreshPresetId]?.defaults || null);
        if (defaults) {
          try {
            await updateGraphRefreshDefaults(result.active_graph_id, defaults);
          } catch (refreshDefaultsErr) {
            console.error('Failed to apply workspace refresh defaults:', refreshDefaultsErr);
          }
        }
      }

      try {
        await selectGraph(result.active_graph_id);
        const seeded = await seedStarterTemplateGraph({
          graphId: result.active_graph_id,
          builtInTemplate: selectedBuiltInTemplate && selectedBuiltInTemplate.id !== 'blank' ? selectedBuiltInTemplate : null,
          customTemplate: selectedCustomTemplate || null,
        });
        if (seeded.nodesCreated || seeded.edgesCreated) {
          console.info('Seeded starter workspace graph from template', {
            graph_id: result.active_graph_id,
            nodes_created: seeded.nodesCreated,
            edges_created: seeded.edgesCreated,
            template_id: selectedCustomTemplate?.template_id || selectedBuiltInTemplate?.id || null,
          });
        }
      } catch (seedErr) {
        console.error('Failed to generate starter node/check set from template:', seedErr);
      }

      setActiveGraphId(result.active_graph_id);
      addRecentGraph(result.active_graph_id);

      // Refresh graphs list
      const data = await listGraphs();
      setGraphs(data.graphs || []);

      // Navigate to current context with new graph
      const params = new URLSearchParams(window.location.search);
      params.set('graph_id', result.active_graph_id);
      const targetPath = pathname === '/' ? '/home' : pathname;
      router.push(`${targetPath}?${params.toString()}`);

      setCreateGraphOpen(false);
      setCreateGraphName('');
    } catch (err) {
      console.error('Failed to create graph:', err);
      setCreateGraphError('Failed to create graph.');
    } finally {
      setCreateGraphLoading(false);
    }
  }, [createGraphName, createGraphApplyRefreshDefaults, createGraphRefreshPresetId, createGraphTemplateId, createGraphIntent, customTemplates, pathname, router]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (graphSwitcherRef.current && !graphSwitcherRef.current.contains(event.target as Node)) {
        setGraphSwitcherOpen(false);
      }
      if (newMenuRef.current && !newMenuRef.current.contains(event.target as Node)) {
        setNewMenuOpen(false);
      }
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setProfileMenuOpen(false);
      }
      if (scopeMenuRef.current && !scopeMenuRef.current.contains(event.target as Node)) {
        setScopeMenuOpen(false);
        setScopePickerOpen(false);
      }
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(event.target as Node) &&
        searchInputRef.current && !searchInputRef.current.contains(event.target as Node)) {
        setSearchFocused(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (createGraphOpen) {
      createGraphInputRef.current?.focus();
    }
  }, [createGraphOpen]);

  useEffect(() => {
    const createGraphFlag = searchParams?.get('create_graph');
    if (createGraphFlag !== '1') return;

    const templateSource = (searchParams?.get('template_source') || 'builtin').toLowerCase();
    const templateIdParam = (searchParams?.get('template_id') || '').trim();
    const key = `${searchParams?.toString() || ''}|custom_count=${customTemplates.length}|loading=${customTemplatesLoading ? 1 : 0}`;
    if (createGraphDeepLinkHandledRef.current === key) return;

    if (templateSource === 'custom' && customTemplatesLoading) {
      return;
    }

    handleCreateGraph();

    if (templateIdParam) {
      if (templateSource === 'custom') {
        const customTemplate = customTemplates.find((t) => t.template_id === templateIdParam);
        if (customTemplate) {
          setCreateGraphTemplateId(customTemplateOptionId(customTemplate.template_id));
          setCreateGraphApplyRefreshDefaults(Boolean(customTemplate.refresh_defaults));
          setCreateGraphRefreshPresetId('none');
          if (!createGraphName.trim()) {
            setCreateGraphName(customTemplate.label);
          }
          if (customTemplate.intent) {
            setCreateGraphIntent(customTemplate.intent);
          }
        }
      } else {
        const builtin = GRAPH_TEMPLATES.find((t) => t.id === templateIdParam);
        if (builtin) {
          setCreateGraphTemplateId(builtin.id);
          const recommendedPreset = getTemplateRefreshPresetId(builtin.id);
          setCreateGraphRefreshPresetId(recommendedPreset);
          setCreateGraphApplyRefreshDefaults(recommendedPreset !== 'none');
          if (!createGraphName.trim()) {
            setCreateGraphName(builtin.label);
          }
          if (builtin.intent) {
            setCreateGraphIntent(builtin.intent);
          }
        }
      }
    }

    createGraphDeepLinkHandledRef.current = key;
  }, [searchParams, customTemplates, customTemplatesLoading, handleCreateGraph]);

  const recentGraphIds = getRecentGraphs();
  const pinnedGraphIds = getPinnedGraphs();

  // Filter graphs by search query
  const filteredGraphs = graphs.filter(g => {
    if (!graphSearchQuery.trim()) return true;
    const query = graphSearchQuery.toLowerCase();
    return (g.name || '').toLowerCase().includes(query) ||
      (g.graph_id || '').toLowerCase().includes(query);
  });

  const pinnedGraphs = pinnedGraphIds
    .map(id => filteredGraphs.find(g => g.graph_id === id))
    .filter((g): g is GraphSummary => !!g);

  const recentGraphs = recentGraphIds
    .filter(id => !pinnedGraphIds.includes(id))
    .map(id => filteredGraphs.find(g => g.graph_id === id))
    .filter((g): g is GraphSummary => !!g);

  const otherGraphs = filteredGraphs.filter(g =>
    !pinnedGraphIds.includes(g.graph_id) && !recentGraphIds.includes(g.graph_id)
  );

  const currentGraph = graphs.find(g => g.graph_id === activeGraphId);
  const createGraphTemplateOptions = useMemo<CreateGraphTemplateOption[]>(() => {
    const builtins: CreateGraphTemplateOption[] = GRAPH_TEMPLATES.map((template) => ({
      id: template.id,
      source: 'builtin',
      label: template.label,
      description: template.description,
      tags: [...template.tags],
      intent: template.intent,
      refreshPresetId: template.refreshPresetId as RefreshTemplatePresetId,
    }));
    const customs: CreateGraphTemplateOption[] = (customTemplates || []).map((template) => ({
      id: customTemplateOptionId(template.template_id),
      source: 'custom',
      label: template.label,
      description: template.description || 'Custom template',
      tags: Array.isArray(template.tags) ? template.tags : [],
      intent: template.intent || undefined,
      customTemplate: template,
    }));
    return [...builtins, ...customs];
  }, [customTemplates]);
  const selectedCreateTemplateOption = createGraphTemplateOptions.find((t) => t.id === createGraphTemplateId) || null;
  const createGraphStarterSeedPreview = useMemo(() => {
    if (!selectedCreateTemplateOption) return null;
    const builtInTemplate =
      selectedCreateTemplateOption.source === 'builtin'
        ? (GRAPH_TEMPLATES.find((template) => template.id === selectedCreateTemplateOption.id) || null)
        : null;
    const customTemplate =
      selectedCreateTemplateOption.source === 'custom'
        ? (selectedCreateTemplateOption.customTemplate || null)
        : null;
    return resolveTemplateStarterSeed({ builtInTemplate, customTemplate });
  }, [selectedCreateTemplateOption]);
  const graphDisplayName = currentGraph?.name || activeGraphId || 'My Study Map';

  // Format metadata line for graph
  const getGraphMetaLine = (graph: GraphSummary): string => {
    const nodes = graph.node_count ?? 0;
    const edges = graph.edge_count ?? 0;
    const updated = formatRelativeTime(graph.updated_at);
    return `${nodes} topic${nodes !== 1 ? 's' : ''} · ${edges} connection${edges !== 1 ? 's' : ''} · updated ${updated}`;
  };

  return (
    <>
      <div style={{
        height: '56px',
        borderBottom: '1px solid var(--border)',
        backgroundColor: 'var(--surface)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
      }}>
        {/* Left: Hamburger (mobile) + Logo + Explorer link */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: isMobile ? '12px' : '16px',
          flexShrink: 0,
        }}>
          {isMobile && (pathname === '/' || pathname === '/home') && (
            <button
              onClick={() => setIsMobileSidebarOpen(true)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '10px',
                borderRadius: '4px',
                color: 'var(--ink)',
                fontSize: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: '44px',
                minHeight: '44px',
              }}
              aria-label="Open sidebar"
              title="Open sidebar"
            >
              ☰
            </button>
          )}
          <div style={{ width: '12px' }} />
          {!isMobile && (
            <>
              <Link
                href="/home"
                onClick={(e) => {
                  if (pathname === '/home') {
                    window.dispatchEvent(new CustomEvent('brainweb:resetHome'));
                  }
                }}
                style={{
                  fontSize: '14px',
                  color: pathname === '/home' ? 'var(--ink)' : 'var(--muted)',
                  textDecoration: 'none',
                  transition: 'all 0.2s',
                  fontWeight: pathname === '/home' ? 600 : 500,
                  padding: '6px 12px',
                  borderRadius: '6px',
                  backgroundColor: pathname === '/home' ? 'var(--panel)' : 'transparent',
                }}
              >
                Home
              </Link>
              <Link href={`/explorer?graph_id=${activeGraphId || 'default'}`} style={{
                fontSize: '14px',
                color: pathname === '/explorer' ? 'var(--ink)' : 'var(--muted)',
                textDecoration: 'none',
                transition: 'all 0.2s',
                fontWeight: pathname === '/explorer' ? 600 : 500,
                padding: '6px 12px',
                borderRadius: '6px',
                backgroundColor: pathname === '/explorer' ? 'var(--panel)' : 'transparent',
              }}
              >
                Explorer
              </Link>
              <Link href="/lecture-studio" style={{
                fontSize: '14px',
                color: pathname === '/lecture-studio' ? 'var(--ink)' : 'var(--muted)',
                textDecoration: 'none',
                transition: 'all 0.2s',
                fontWeight: pathname === '/lecture-studio' ? 600 : 500,
                padding: '6px 12px',
                borderRadius: '6px',
                backgroundColor: pathname === '/lecture-studio' ? 'var(--panel)' : 'transparent',
              }}
              >
                Studio
              </Link>
            </>
          )}
        </div>

        {/* Center: Empty - search moved to ExplorerToolbar */}
        <div style={{ flex: 1 }} />

        {/* Right: Graph switcher + New + Profile */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '300px', justifyContent: 'flex-end' }}>
          {/* Graph Switcher */}
          <div ref={graphSwitcherRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setGraphSwitcherOpen(!graphSwitcherOpen)}
              style={{
                height: '36px',
                padding: '0 12px',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface)',
                fontSize: '14px',
                fontWeight: 500,
                color: 'var(--ink)',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                justifyContent: 'center',
                gap: '2px',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--panel)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'var(--surface)'}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
                <span>{graphDisplayName}</span>
                <span style={{ fontSize: '12px', color: 'var(--muted)' }}>▼</span>
              </div>
              {currentGraph && (
                <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 400 }}>
                  {getGraphMetaLine(currentGraph)}
                </span>
              )}
            </button>

            {graphSwitcherOpen && (
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: '4px',
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
                minWidth: '320px',
                maxWidth: '400px',
                maxHeight: '500px',
                overflowY: 'auto',
                zIndex: 1001,
              }}>
                {/* Search input */}
                <div style={{ padding: '8px', borderBottom: '1px solid var(--border)' }}>
                  <input
                    type="text"
                    placeholder="Search graphs..."
                    value={graphSearchQuery}
                    onChange={(e) => setGraphSearchQuery(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: '100%',
                      height: '32px',
                      padding: '0 12px',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      backgroundColor: 'var(--background)',
                      fontSize: '14px',
                      fontFamily: 'inherit',
                      outline: 'none',
                    }}
                  />
                </div>

                {/* Pinned Graphs */}
                {pinnedGraphs.length > 0 && (
                  <>
                    <div style={{
                      padding: '8px 16px',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      borderBottom: '1px solid var(--border)',
                    }}>
                      Pinned
                    </div>
                    {pinnedGraphs.map(graph => (
                      <div
                        key={graph.graph_id}
                        style={{
                          padding: '10px 16px',
                          cursor: 'pointer',
                          backgroundColor: graph.graph_id === activeGraphId ? 'var(--panel)' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          transition: 'background-color 0.1s',
                        }}
                        onMouseEnter={(e) => {
                          if (graph.graph_id !== activeGraphId) {
                            e.currentTarget.style.backgroundColor = 'var(--panel)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (graph.graph_id !== activeGraphId) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }
                        }}
                      >
                        <div
                          style={{ flex: 1, cursor: 'pointer' }}
                          onClick={() => handleSelectGraph(graph.graph_id)}
                        >
                          <div style={{ fontSize: '14px', fontWeight: graph.graph_id === activeGraphId ? 600 : 500, color: 'var(--ink)' }}>
                            {graph.name || graph.graph_id}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                            {getGraphMetaLine(graph)}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePinGraph(graph.graph_id);
                            // Force re-render by updating state
                            setGraphs([...graphs]);
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '4px 8px',
                            color: isGraphPinned(graph.graph_id) ? 'var(--accent-2)' : 'var(--muted)',
                            fontSize: '16px',
                          }}
                          title={isGraphPinned(graph.graph_id) ? 'Unpin' : 'Pin'}
                        >
                          {isGraphPinned(graph.graph_id) ? '📌' : '📍'}
                        </button>
                      </div>
                    ))}
                  </>
                )}

                {/* Recent Graphs */}
                {recentGraphs.length > 0 && (
                  <>
                    <div style={{
                      padding: '8px 16px',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      borderTop: pinnedGraphs.length > 0 ? '1px solid var(--border)' : 'none',
                      borderBottom: '1px solid var(--border)',
                    }}>
                      Recent
                    </div>
                    {recentGraphs.map(graph => (
                      <div
                        key={graph.graph_id}
                        style={{
                          padding: '10px 16px',
                          cursor: 'pointer',
                          backgroundColor: graph.graph_id === activeGraphId ? 'var(--panel)' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          transition: 'background-color 0.1s',
                        }}
                        onMouseEnter={(e) => {
                          if (graph.graph_id !== activeGraphId) {
                            e.currentTarget.style.backgroundColor = 'var(--panel)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (graph.graph_id !== activeGraphId) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }
                        }}
                      >
                        <div
                          style={{ flex: 1, cursor: 'pointer' }}
                          onClick={() => handleSelectGraph(graph.graph_id)}
                        >
                          <div style={{ fontSize: '14px', fontWeight: graph.graph_id === activeGraphId ? 600 : 500, color: 'var(--ink)' }}>
                            {graph.name || graph.graph_id}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                            {getGraphMetaLine(graph)}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePinGraph(graph.graph_id);
                            setGraphs([...graphs]);
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '4px 8px',
                            color: isGraphPinned(graph.graph_id) ? 'var(--accent-2)' : 'var(--muted)',
                            fontSize: '16px',
                          }}
                          title={isGraphPinned(graph.graph_id) ? 'Unpin' : 'Pin'}
                        >
                          {isGraphPinned(graph.graph_id) ? '📌' : '📍'}
                        </button>
                      </div>
                    ))}
                  </>
                )}

                {/* All Graphs - only show during search as per user request */}
                {otherGraphs.length > 0 && graphSearchQuery.trim() !== "" && (
                  <>
                    <div style={{
                      padding: '8px 16px',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      borderTop: (pinnedGraphs.length > 0 || recentGraphs.length > 0) ? '1px solid var(--border)' : 'none',
                      borderBottom: '1px solid var(--border)',
                    }}>
                      Other Graphs
                    </div>
                    {otherGraphs.map(graph => (
                      <div
                        key={graph.graph_id}
                        style={{
                          padding: '10px 16px',
                          cursor: 'pointer',
                          backgroundColor: graph.graph_id === activeGraphId ? 'var(--panel)' : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          transition: 'background-color 0.1s',
                        }}
                        onMouseEnter={(e) => {
                          if (graph.graph_id !== activeGraphId) {
                            e.currentTarget.style.backgroundColor = 'var(--panel)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (graph.graph_id !== activeGraphId) {
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }
                        }}
                      >
                        <div
                          style={{ flex: 1, cursor: 'pointer' }}
                          onClick={() => handleSelectGraph(graph.graph_id)}
                        >
                          <div style={{ fontSize: '14px', fontWeight: graph.graph_id === activeGraphId ? 600 : 500, color: 'var(--ink)' }}>
                            {graph.name || graph.graph_id}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                            {getGraphMetaLine(graph)}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePinGraph(graph.graph_id);
                            setGraphs([...graphs]);
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: '4px 8px',
                            color: isGraphPinned(graph.graph_id) ? 'var(--accent-2)' : 'var(--muted)',
                            fontSize: '16px',
                          }}
                          title={isGraphPinned(graph.graph_id) ? 'Unpin' : 'Pin'}
                        >
                          {isGraphPinned(graph.graph_id) ? '📌' : '📍'}
                        </button>
                      </div>
                    ))}
                  </>
                )}

                {/* Actions */}
                <div style={{ borderTop: '1px solid var(--border)', marginTop: '4px' }}>
                  {activeGraphId && (
                    <Link
                      href={`/graphs/${activeGraphId}`}
                      onClick={() => setGraphSwitcherOpen(false)}
                      style={{
                        display: 'block',
                        padding: '10px 16px',
                        cursor: 'pointer',
                        transition: 'background-color 0.1s',
                        textDecoration: 'none',
                        color: 'var(--ink)',
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--panel)'}
                      onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                    >
                      Graph Details
                    </Link>
                  )}
                  <div
                    onClick={handleCreateGraph}
                    style={{
                      padding: '10px 16px',
                      cursor: 'pointer',
                      transition: 'background-color 0.1s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--panel)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    + Create Graph
                  </div>
                  <div
                    onClick={() => {
                      router.push('/control-panel');
                      setGraphSwitcherOpen(false);
                    }}
                    style={{
                      padding: '10px 16px',
                      cursor: 'pointer',
                      transition: 'background-color 0.1s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--panel)'}
                    onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    Workspace Library
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* New Menu */}
          <div ref={newMenuRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setNewMenuOpen(!newMenuOpen)}
              style={{
                height: '36px',
                padding: '0 16px',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: 'var(--accent)',
                color: 'white',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(37, 99, 235, 0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(37, 99, 235, 0.2)';
              }}
            >
              <span>+</span> New
            </button>

            {newMenuOpen && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                boxShadow: '0 12px 32px rgba(0, 0, 0, 0.1)',
                minWidth: '200px',
                zIndex: 1001,
                padding: '6px',
                animation: 'fadeInScale 0.15s ease-out',
                backdropFilter: 'blur(10px)',
              }}>
                <div
                  onClick={() => {
                    router.push('/ingest');
                    setNewMenuOpen(false);
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    transition: 'all 0.1s',
                  }}
                  className="menu-item-hover"
                >
                  <span style={{ fontSize: '16px' }}>📄</span> Import Document
                </div>
                <div
                  onClick={() => {
                    router.push('/lecture-editor');
                    setNewMenuOpen(false);
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    transition: 'all 0.1s',
                  }}
                  className="menu-item-hover"
                >
                  <span style={{ fontSize: '16px' }}>📝</span> Write Notes
                </div>
                <div
                  onClick={() => {
                    setNewNoteModalOpen(true);
                    setNewMenuOpen(false);
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    transition: 'all 0.1s',
                  }}
                  className="menu-item-hover"
                >
                  <span style={{ fontSize: '16px' }}>✍️</span> Quick Concept
                </div>
                <div
                  onClick={() => {
                    router.push('/');
                    setNewMenuOpen(false);
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    transition: 'all 0.1s',
                  }}
                  className="menu-item-hover"
                >
                  <span style={{ fontSize: '16px' }}>📸</span> Create Snapshot
                </div>

                <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />

                <div
                  onClick={handleCreateGraph}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    transition: 'all 0.1s',
                  }}
                  className="menu-item-hover"
                >
                  <span style={{ fontSize: '16px' }}>🕸️</span> New Study Map
                </div>
                <div
                  onClick={() => {
                    router.push('/offline-settings');
                    setNewMenuOpen(false);
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    transition: 'all 0.1s',
                  }}
                  className="menu-item-hover"
                >
                  <span style={{ fontSize: '16px' }}>⚙️</span> Workspace Settings
                </div>
              </div>
            )}
            <style jsx>{`
              .menu-item-hover:hover {
                background-color: var(--panel);
                color: var(--accent);
              }
              @keyframes fadeInScale {
                from { opacity: 0; transform: scale(0.95) translateY(-10px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
              }
            `}</style>
          </div>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            style={{
              padding: '10px',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              background: 'var(--panel)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink)',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--accent)';
              e.currentTarget.style.color = 'white';
              e.currentTarget.style.borderColor = 'var(--accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--panel)';
              e.currentTarget.style.color = 'var(--ink)';
              e.currentTarget.style.borderColor = 'var(--border)';
            }}
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            suppressHydrationWarning
          >
            {theme === 'light' ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
            )}
          </button >

          {/* Profile menu */}
          <div ref={profileMenuRef} style={{ position: 'relative' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                backgroundColor: profileMenuOpen ? 'var(--accent, #3b82f6)' : 'var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                fontSize: '16px',
                color: profileMenuOpen ? '#fff' : 'var(--muted)',
                transition: 'all 0.15s',
              }}
              onClick={() => setProfileMenuOpen(!profileMenuOpen)}
            >
              👤
            </div>
            {profileMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '12px',
                  padding: '6px',
                  minWidth: '180px',
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.15)',
                  zIndex: 1100,
                }}
              >
                <div
                  onClick={() => {
                    router.push('/profile-customization');
                    setProfileMenuOpen(false);
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    transition: 'all 0.1s',
                  }}
                  className="menu-item-hover"
                >
                  <span style={{ fontSize: '16px' }}>⚙️</span> Settings
                </div>
                <div
                  onClick={() => {
                    router.push('/source-management');
                    setProfileMenuOpen(false);
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    transition: 'all 0.1s',
                  }}
                  className="menu-item-hover"
                >
                  <span style={{ fontSize: '16px' }}>📄</span> Sources
                </div>
                <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                <div
                  onClick={async () => {
                    setProfileMenuOpen(false);
                    const { signOut } = await import('next-auth/react');
                    signOut({ callbackUrl: '/welcome' });
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 500,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    transition: 'all 0.1s',
                    color: '#ef4444',
                  }}
                  className="menu-item-hover"
                >
                  <span style={{ fontSize: '16px' }}>🚪</span> Sign Out
                </div>
              </div>
            )}
          </div>
        </div >
      </div >
      {createGraphOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 2000,
            padding: '24px',
          }}
          onClick={() => {
            if (!createGraphLoading) setCreateGraphOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-graph-title"
            style={{
              backgroundColor: 'var(--surface)',
              borderRadius: '12px',
              border: '1px solid var(--border)',
              boxShadow: '0 16px 40px rgba(15, 23, 42, 0.2)',
              width: '100%',
              maxWidth: '620px',
              maxHeight: 'calc(100vh - 48px)',
              overflowY: 'auto',
              padding: '20px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div
                id="create-graph-title"
                style={{ fontSize: '16px', fontWeight: 600, color: 'var(--ink)' }}
              >
                Create a new graph
              </div>
              <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
                Give this workspace a name to get started.
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                Pick a starting point
              </div>
              {customTemplatesLoading && (
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Loading custom templates...</div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {createGraphTemplateOptions.map((template) => {
                  const isSelected = createGraphTemplateId === template.id;
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => {
                        setCreateGraphTemplateId(template.id);
                        if (template.source === 'builtin') {
                          const recommendedPreset = getTemplateRefreshPresetId(template.id);
                          setCreateGraphRefreshPresetId(recommendedPreset);
                          setCreateGraphApplyRefreshDefaults(recommendedPreset !== 'none');
                        } else {
                          setCreateGraphRefreshPresetId('none');
                          setCreateGraphApplyRefreshDefaults(Boolean(template.customTemplate?.refresh_defaults));
                        }
                        if (!createGraphIntent.trim() && template.intent) {
                          setCreateGraphIntent(template.intent);
                        }
                      }}
                      style={{
                        flex: '1 1 160px',
                        minWidth: '160px',
                        borderRadius: '10px',
                        border: isSelected ? '1px solid #6366f1' : '1px solid var(--border)',
                        backgroundColor: isSelected ? 'var(--panel)' : 'var(--surface)',
                        padding: '10px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        color: 'var(--ink)',
                      }}
                    >
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>{template.label}</div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px' }}>
                        {template.description}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--accent)', marginTop: '6px' }}>
                        {[...(template.tags || []), template.source === 'custom' ? 'custom' : 'built-in'].join(' · ')}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            {selectedCreateTemplateOption && (
              <div
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  background: 'var(--panel)',
                  padding: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                  Preview of starter nodes/links created from the selected template.
                </div>
                <MiniStarterSeedPreview seed={createGraphStarterSeedPreview} templateLabel={selectedCreateTemplateOption.label} />
                {selectedCreateTemplateOption.source === 'custom' && selectedCreateTemplateOption.customTemplate && (
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    {selectedCreateTemplateOption.customTemplate.starter_nodes?.length
                      ? 'Using explicit starter node names from this custom template.'
                      : 'No explicit starter node names set; preview is derived from node types and connection patterns.'}
                  </div>
                )}
              </div>
            )}
            <input
              ref={createGraphInputRef}
              type="text"
              value={createGraphName}
              placeholder="e.g. Q4 research map"
              onChange={(event) => setCreateGraphName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleConfirmCreateGraph();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  if (!createGraphLoading) setCreateGraphOpen(false);
                }
              }}
              style={{
                width: '100%',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '14px',
                color: 'var(--ink)',
                backgroundColor: 'white',
              }}
            />
            <input
              type="text"
              value={createGraphIntent}
              placeholder="What are you hoping to use this graph for?"
              onChange={(event) => setCreateGraphIntent(event.target.value)}
              style={{
                width: '100%',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '13px',
                color: 'var(--ink)',
                backgroundColor: 'white',
              }}
            />
            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '10px',
                background: 'var(--panel)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: 'var(--ink)' }}>
                <input
                  type="checkbox"
                  checked={createGraphApplyRefreshDefaults}
                  onChange={(event) => setCreateGraphApplyRefreshDefaults(event.target.checked)}
                />
                {selectedCreateTemplateOption?.source === 'custom'
                  ? 'Apply custom template refresh defaults'
                  : 'Apply workspace update-check defaults'}
              </label>

              {selectedCreateTemplateOption?.source === 'custom' && selectedCreateTemplateOption.customTemplate ? (
                <>
                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    Uses refresh defaults defined in custom template: <strong style={{ color: 'var(--ink)' }}>{selectedCreateTemplateOption.customTemplate.label}</strong>
                  </div>
                  {createGraphApplyRefreshDefaults && selectedCreateTemplateOption.customTemplate.refresh_defaults && (
                    <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                      Triggers: {(selectedCreateTemplateOption.customTemplate.refresh_defaults.triggers || []).join(', ')} · TTL:{' '}
                      {Math.round((selectedCreateTemplateOption.customTemplate.refresh_defaults.ttl_seconds || 0) / 60)} min · Checks:{' '}
                      {selectedCreateTemplateOption.customTemplate.refresh_defaults.checks?.length || 0}
                    </div>
                  )}
                  {!selectedCreateTemplateOption.customTemplate.refresh_defaults && (
                    <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                      This custom template has no saved workspace refresh defaults.
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', color: 'var(--muted)' }}>Preset</span>
                    <select
                      value={createGraphRefreshPresetId}
                      onChange={(event) => {
                        setCreateGraphRefreshPresetId(event.target.value as RefreshTemplatePresetId);
                        if (event.target.value === 'none') setCreateGraphApplyRefreshDefaults(false);
                      }}
                      style={{
                        flex: '1 1 220px',
                        border: '1px solid var(--border)',
                        borderRadius: '6px',
                        padding: '6px 8px',
                        fontSize: '12px',
                        color: 'var(--ink)',
                        background: 'white',
                      }}
                    >
                      {Object.entries(REFRESH_TEMPLATE_PRESETS).map(([id, preset]) => (
                        <option key={id} value={id}>{preset.label}</option>
                      ))}
                    </select>
                  </div>

                  <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
                    {REFRESH_TEMPLATE_PRESETS[createGraphRefreshPresetId]?.description}
                  </div>

                  {createGraphApplyRefreshDefaults && REFRESH_TEMPLATE_PRESETS[createGraphRefreshPresetId]?.defaults && (
                    <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                      Triggers: {REFRESH_TEMPLATE_PRESETS[createGraphRefreshPresetId].defaults?.triggers.join(', ')} · TTL:{' '}
                      {Math.round((REFRESH_TEMPLATE_PRESETS[createGraphRefreshPresetId].defaults?.ttl_seconds || 0) / 60)} min · Checks:{' '}
                      {REFRESH_TEMPLATE_PRESETS[createGraphRefreshPresetId].defaults?.checks.length || 0}
                    </div>
                  )}
                </>
              )}
              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                <Link href="/templates" style={{ color: 'var(--accent)' }}>
                  Open template blueprints
                </Link>
                {' '}to design how person/company/news-event templates connect.
              </div>
            </div>
            {createGraphError && (
              <div style={{ color: '#b91c1c', fontSize: '12px' }}>{createGraphError}</div>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setCreateGraphOpen(false)}
                disabled={createGraphLoading}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  backgroundColor: 'transparent',
                  color: 'var(--ink)',
                  cursor: createGraphLoading ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmCreateGraph}
                disabled={createGraphLoading}
                style={{
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: 'var(--accent)',
                  color: 'white',
                  fontWeight: 600,
                  cursor: createGraphLoading ? 'not-allowed' : 'pointer',
                  opacity: createGraphLoading ? 0.7 : 1,
                }}
              >
                {createGraphLoading ? 'Creating...' : 'Create graph'}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* New Note Modal */}
      <NewNoteModal
        isOpen={isNewNoteModalOpen}
        onClose={() => setNewNoteModalOpen(false)}
        onCreated={(concept) => {
          pushRecentConceptView(concept);
        }}
        graphId={activeGraphId || 'default'}
      />
    </>
  );
}
