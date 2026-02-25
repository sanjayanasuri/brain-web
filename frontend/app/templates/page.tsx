'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import Link from 'next/link';
import {
  cloneWorkspaceTemplate,
  createWorkspaceTemplate,
  deleteWorkspaceTemplate,
  exportWorkspaceTemplate,
  importWorkspaceTemplate,
  listWorkspaceTemplates,
  updateWorkspaceTemplate,
  type RefreshBindingConfig,
  type WorkspaceTemplate,
} from '@/app/api-client';
import GlassCard from '@/app/components/ui/GlassCard';
import Button from '@/app/components/ui/Button';
import Badge from '@/app/components/ui/Badge';

type Blueprint = {
  id: string;
  label: string;
  description: string;
  nodes: string[];
  starterNodes: string[];
  checks: string[];
  connections: string[];
  createTemplateId: string;
  starterRefreshDefaults: RefreshBindingConfig;
  vertical: string;
};

const BUILTIN_BLUEPRINTS: Blueprint[] = [
  {
    id: 'person_research',
    label: 'Person Research',
    description: 'Use people as primary nodes and continuously track role changes, affiliations, and public activity.',
    nodes: ['Person', 'Organization', 'Project', 'Event'],
    starterNodes: ['Target Person', 'Primary Organization', 'Key Project', 'Recent Event'],
    checks: ['Exa news mentions', 'Exa answer role-change summary', 'Optional web background search'],
    connections: ['Person -> Organization', 'Person -> Event', 'Person -> Person'],
    createTemplateId: 'person_research',
    vertical: 'person',
    starterRefreshDefaults: {
      version: 1,
      enabled: true,
      inherit_workspace_defaults: true,
      triggers: ['manual', 'on_open', 'scheduled'],
      ttl_seconds: 21600,
      checks: [
        { check_id: 'person-news', kind: 'exa_news', title: 'Recent mentions', query: '{{concept_name}}', enabled: true, params: { max_age_hours: 24, limit: 6 } },
        { check_id: 'role-change', kind: 'exa_answer', title: 'Role changes', query: 'latest role changes for {{concept_name}}', enabled: true, params: { max_age_hours: 168 } },
      ],
    },
  },
  {
    id: 'company_research',
    label: 'Company Research',
    description: 'Use companies as primary nodes and combine structured live metrics with web/news updates.',
    nodes: ['Company', 'Ticker', 'Product', 'Executive', 'Competitor'],
    starterNodes: ['Target Company', 'Primary Ticker', 'Key Product Line', 'Lead Executive', 'Primary Competitor'],
    checks: ['Live metric snapshot', 'Exa company headlines', 'Exa answer org/strategy changes'],
    connections: ['Company -> Product', 'Company -> Company', 'Executive -> Company'],
    createTemplateId: 'stock_research',
    vertical: 'company',
    starterRefreshDefaults: {
      version: 1,
      enabled: true,
      inherit_workspace_defaults: true,
      triggers: ['manual', 'on_open', 'scheduled'],
      ttl_seconds: 1800,
      checks: [
        { check_id: 'live-metric', kind: 'live_metric', title: 'Live metric', query: '{{concept_name}} stock price', enabled: true, params: {} },
        { check_id: 'company-news', kind: 'exa_news', title: 'Company headlines', query: '{{concept_name}} company news', enabled: true, params: { max_age_hours: 12, limit: 8 } },
      ],
    },
  },
  {
    id: 'news_event_research',
    label: 'News / Event Research',
    description: 'Track events and claims over time, then connect them to people and organizations.',
    nodes: ['Event', 'Organization', 'Person', 'Claim'],
    starterNodes: ['Tracked Event', 'Primary Organization', 'Primary Person', 'Key Claim'],
    checks: ['Exa news feed', 'Exa answer "what changed"', 'Search-and-fetch supporting pages'],
    connections: ['Event -> Organization', 'Event -> Person', 'Claim -> Event'],
    createTemplateId: 'news_tracking',
    vertical: 'news_event',
    starterRefreshDefaults: {
      version: 1,
      enabled: true,
      inherit_workspace_defaults: true,
      triggers: ['manual', 'on_open', 'scheduled'],
      ttl_seconds: 3600,
      checks: [
        { check_id: 'news-feed', kind: 'exa_news', title: 'News feed', query: '{{concept_name}}', enabled: true, params: { max_age_hours: 6, limit: 8 } },
        { check_id: 'what-changed', kind: 'exa_answer', title: 'What changed', query: 'What are the latest updates about {{concept_name}}?', enabled: true, params: { category: 'news', max_age_hours: 12 } },
      ],
    },
  },
];

type TemplateFormState = {
  label: string;
  description: string;
  vertical: string;
  tagsText: string;
  intent: string;
  nodeTypesText: string;
  starterNodesText: string;
  nodeLayoutText: string;
  defaultChecksText: string;
  connectionPatternsText: string;
  refreshDefaultsText: string;
};

function splitLinesOrComma(value: string): string[] {
  return value
    .replace(/\r/g, '\n')
    .replace(/,/g, '\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

function stringifyRefreshDefaults(value?: RefreshBindingConfig | null): string {
  if (!value) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function stringifyJsonObject(value?: Record<string, any> | null): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function makeEmptyForm(): TemplateFormState {
  return {
    label: '',
    description: '',
    vertical: '',
    tagsText: '',
    intent: '',
    nodeTypesText: '',
    starterNodesText: '',
    nodeLayoutText: '',
    defaultChecksText: '',
    connectionPatternsText: '',
    refreshDefaultsText: '',
  };
}

function formFromTemplate(template: WorkspaceTemplate): TemplateFormState {
  return {
    label: template.label || '',
    description: template.description || '',
    vertical: template.vertical || '',
    tagsText: (template.tags || []).join('\n'),
    intent: template.intent || '',
    nodeTypesText: (template.node_types || []).join('\n'),
    starterNodesText: (template.starter_nodes || []).join('\n'),
    nodeLayoutText: stringifyJsonObject((template.node_layout as Record<string, any> | null) || null),
    defaultChecksText: (template.default_checks || []).join('\n'),
    connectionPatternsText: (template.connection_patterns || []).join('\n'),
    refreshDefaultsText: stringifyRefreshDefaults(template.refresh_defaults || null),
  };
}

function formFromBlueprint(blueprint: Blueprint): TemplateFormState {
  return {
    label: `${blueprint.label} (Custom)`,
    description: blueprint.description,
    vertical: blueprint.vertical,
    tagsText: [blueprint.id, 'custom-template'].join('\n'),
    intent: `Build a ${blueprint.label.toLowerCase()} workspace and connect it to adjacent entities.`,
    nodeTypesText: blueprint.nodes.join('\n'),
    starterNodesText: blueprint.starterNodes.join('\n'),
    nodeLayoutText: '',
    defaultChecksText: blueprint.checks.join('\n'),
    connectionPatternsText: blueprint.connections.join('\n'),
    refreshDefaultsText: stringifyRefreshDefaults(blueprint.starterRefreshDefaults),
  };
}

function buildTemplatePayload(form: TemplateFormState) {
  const label = form.label.trim();
  if (!label) throw new Error('Template name is required');

  let refreshDefaults: Record<string, any> | null = null;
  const raw = form.refreshDefaultsText.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        refreshDefaults = parsed;
      } else {
        throw new Error('Refresh defaults JSON must be an object');
      }
    } catch (e) {
      throw new Error(`Invalid refresh defaults JSON: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  let nodeLayout: Record<string, any> | null = null;
  const rawNodeLayout = form.nodeLayoutText.trim();
  if (rawNodeLayout) {
    try {
      const parsed = JSON.parse(rawNodeLayout);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        nodeLayout = parsed as Record<string, any>;
      } else {
        throw new Error('Node layout JSON must be an object');
      }
    } catch (e) {
      throw new Error(`Invalid node layout JSON: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  return {
    label,
    description: form.description.trim() || null,
    vertical: form.vertical.trim() || null,
    tags: splitLinesOrComma(form.tagsText),
    intent: form.intent.trim() || null,
    node_types: splitLinesOrComma(form.nodeTypesText),
    starter_nodes: splitLinesOrComma(form.starterNodesText),
    node_layout: nodeLayout,
    default_checks: splitLinesOrComma(form.defaultChecksText),
    connection_patterns: splitLinesOrComma(form.connectionPatternsText),
    refresh_defaults: refreshDefaults,
  };
}

type VisualTemplateNode = {
  id: string;
  name: string;
  type: string;
};

type VisualTemplateEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  predicate: string;
};

type VisualTemplateGraphModel = {
  nodes: VisualTemplateNode[];
  edges: VisualTemplateEdge[];
};

function normalizeVisualKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildVisualNodeId(name: string, type: string, index: number): string {
  const base = normalizeVisualKey(name) || normalizeVisualKey(type) || `node_${index + 1}`;
  return `${base}_${index + 1}`;
}

function parseEdgePredicate(targetPart: string): { targetLabel: string; predicate: string } {
  const text = String(targetPart || '').trim();
  if (!text) return { targetLabel: '', predicate: 'related_to' };
  const parenMatch = text.match(/\(([^)]+)\)/);
  if (!parenMatch) return { targetLabel: text, predicate: 'related_to' };
  const firstPredicate = (parenMatch[1] || '')
    .split(',')
    .map((item) => item.trim())
    .find(Boolean);
  return {
    targetLabel: text.replace(parenMatch[0], '').trim(),
    predicate: firstPredicate || 'related_to',
  };
}

function parseVisualTemplateGraphFromForm(form: TemplateFormState): VisualTemplateGraphModel {
  const nodeTypes = splitLinesOrComma(form.nodeTypesText);
  const starterNames = splitLinesOrComma(form.starterNodesText);
  const nodeCount = Math.max(nodeTypes.length, starterNames.length);
  const nodes: VisualTemplateNode[] = Array.from({ length: nodeCount }).map((_, index) => {
    const type = nodeTypes[index] || '';
    const name = starterNames[index] || type || `Node ${index + 1}`;
    return {
      id: buildVisualNodeId(name, type, index),
      name,
      type,
    };
  });

  const byType = new Map<string, VisualTemplateNode>();
  const byName = new Map<string, VisualTemplateNode>();
  for (const node of nodes) {
    const typeKey = normalizeVisualKey(node.type);
    const nameKey = normalizeVisualKey(node.name);
    if (typeKey && !byType.has(typeKey)) byType.set(typeKey, node);
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, node);
  }

  const edges: VisualTemplateEdge[] = [];
  const rawPatterns = splitLinesOrComma(form.connectionPatternsText);
  rawPatterns.forEach((pattern, index) => {
    const arrowMatch = pattern.match(/^(.*?)\s*(?:<->|↔|->|→)\s*(.*)$/);
    if (!arrowMatch) return;
    const sourceLabel = (arrowMatch[1] || '').trim();
    const { targetLabel, predicate } = parseEdgePredicate(arrowMatch[2] || '');
    if (!sourceLabel || !targetLabel) return;
    const sourceNode =
      byType.get(normalizeVisualKey(sourceLabel)) ||
      byName.get(normalizeVisualKey(sourceLabel));
    const targetNode =
      byType.get(normalizeVisualKey(targetLabel)) ||
      byName.get(normalizeVisualKey(targetLabel));
    if (!sourceNode || !targetNode) return;
    edges.push({
      id: `edge_${index + 1}`,
      sourceId: sourceNode.id,
      targetId: targetNode.id,
      predicate: predicate || 'related_to',
    });
  });

  return { nodes, edges };
}

function serializeVisualTemplateGraphToForm(
  currentForm: TemplateFormState,
  model: VisualTemplateGraphModel
): TemplateFormState {
  const nodes = model.nodes || [];
  const edges = (model.edges || []).filter(
    (edge) => edge.sourceId && edge.targetId && edge.sourceId !== edge.targetId
  );
  const nodeById = new Map(nodes.map((node) => [node.id, node] as const));

  const nodeTypesText = nodes.map((node) => node.type.trim() || node.name.trim()).filter(Boolean).join('\n');
  const starterNodesText = nodes.map((node) => node.name.trim()).filter(Boolean).join('\n');
  const connectionPatternsText = edges
    .map((edge) => {
      const source = nodeById.get(edge.sourceId);
      const target = nodeById.get(edge.targetId);
      if (!source || !target) return null;
      const sourceLabel = source.type.trim() || source.name.trim();
      const targetLabel = target.type.trim() || target.name.trim();
      const predicate = (edge.predicate || 'related_to').trim();
      if (!sourceLabel || !targetLabel) return null;
      return `${sourceLabel} -> ${targetLabel} (${predicate || 'related_to'})`;
    })
    .filter((line): line is string => Boolean(line))
    .join('\n');

  return {
    ...currentForm,
    nodeTypesText,
    starterNodesText,
    connectionPatternsText,
  };
}

function buildDefaultCanvasPositions(nodes: VisualTemplateNode[]): Record<string, { x: number; y: number }> {
  const slots = [
    { x: 42, y: 34 },
    { x: 200, y: 28 },
    { x: 358, y: 34 },
    { x: 88, y: 128 },
    { x: 250, y: 128 },
    { x: 412, y: 128 },
    { x: 150, y: 210 },
    { x: 320, y: 210 },
  ];
  const out: Record<string, { x: number; y: number }> = {};
  nodes.forEach((node, idx) => {
    const slot = slots[idx] || {
      x: 40 + (idx % 4) * 120,
      y: 34 + Math.floor(idx / 4) * 86,
    };
    out[node.id] = slot;
  });
  return out;
}

function parseNodeLayoutText(text: string, validNodeIds: string[]): Record<string, { x: number; y: number }> {
  const validIds = new Set(validNodeIds);
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, { x: number; y: number }> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, any>)) {
      if (!validIds.has(key) || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const x = Number((value as any).x);
      const y = Number((value as any).y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      out[key] = { x, y };
    }
    return out;
  } catch {
    return {};
  }
}

function serializeNodeLayoutText(
  positions: Record<string, { x: number; y: number }>,
  orderedNodeIds: string[]
): string {
  const layout: Record<string, { x: number; y: number }> = {};
  for (const nodeId of orderedNodeIds) {
    const pos = positions[nodeId];
    if (!pos) continue;
    layout[nodeId] = {
      x: Math.round(Number(pos.x) || 0),
      y: Math.round(Number(pos.y) || 0),
    };
  }
  if (Object.keys(layout).length === 0) return '';
  try {
    return JSON.stringify(layout, null, 2);
  } catch {
    return '';
  }
}

function VisualTemplateBuilder({
  form,
  setForm,
}: {
  form: TemplateFormState;
  setForm: Dispatch<SetStateAction<TemplateFormState>>;
}) {
  const model = useMemo(() => parseVisualTemplateGraphFromForm(form), [form.nodeTypesText, form.starterNodesText, form.connectionPatternsText]);
  const persistedLayout = useMemo(
    () => parseNodeLayoutText(form.nodeLayoutText || '', model.nodes.map((node) => node.id)),
    [form.nodeLayoutText, model.nodes]
  );
  const canvasRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [dragState, setDragState] = useState<{ nodeId: string; dx: number; dy: number } | null>(null);

  useEffect(() => {
    setPositions((prev) => {
      const next = { ...prev };
      const defaults = buildDefaultCanvasPositions(model.nodes);
      const liveIds = new Set(model.nodes.map((node) => node.id));
      for (const node of model.nodes) {
        const persisted = persistedLayout[node.id];
        if (persisted) {
          next[node.id] = persisted;
        } else if (!next[node.id]) {
          next[node.id] = defaults[node.id];
        }
      }
      for (const key of Object.keys(next)) {
        if (!liveIds.has(key)) delete next[key];
      }
      return next;
    });
  }, [model.nodes, persistedLayout]);

  useEffect(() => {
    if (!dragState) return;
    const onMouseMove = (event: MouseEvent) => {
      const el = canvasRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = Math.max(12, Math.min(rect.width - 100, event.clientX - rect.left - dragState.dx));
      const y = Math.max(12, Math.min(rect.height - 44, event.clientY - rect.top - dragState.dy));
      setPositions((prev) => ({ ...prev, [dragState.nodeId]: { x, y } }));
    };
    const onMouseUp = () => setDragState(null);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [dragState]);

  useEffect(() => {
    if (dragState) return;
    const nextText = serializeNodeLayoutText(positions, model.nodes.map((node) => node.id));
    if ((form.nodeLayoutText || '') === nextText) return;
    setForm((current) => {
      if ((current.nodeLayoutText || '') === nextText) return current;
      return { ...current, nodeLayoutText: nextText };
    });
  }, [dragState, positions, model.nodes, form.nodeLayoutText, setForm]);

  const updateModel = (updater: (current: VisualTemplateGraphModel) => VisualTemplateGraphModel) => {
    const nextModel = updater(model);
    setForm((current) => serializeVisualTemplateGraphToForm(current, nextModel));
  };

  const addNode = () => {
    updateModel((current) => {
      const nextIndex = current.nodes.length + 1;
      const node: VisualTemplateNode = {
        id: buildVisualNodeId(`Node ${nextIndex}`, '', current.nodes.length),
        name: `Node ${nextIndex}`,
        type: '',
      };
      return { ...current, nodes: [...current.nodes, node] };
    });
  };

  const updateNode = (nodeId: string, patch: Partial<VisualTemplateNode>) => {
    updateModel((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
    }));
  };

  const removeNode = (nodeId: string) => {
    updateModel((current) => ({
      nodes: current.nodes.filter((node) => node.id !== nodeId),
      edges: current.edges.filter((edge) => edge.sourceId !== nodeId && edge.targetId !== nodeId),
    }));
    setPositions((prev) => {
      const next = { ...prev };
      delete next[nodeId];
      return next;
    });
  };

  const addEdge = () => {
    if (model.nodes.length < 2) return;
    updateModel((current) => ({
      ...current,
      edges: [
        ...current.edges,
        {
          id: `edge_${Date.now()}`,
          sourceId: current.nodes[0]?.id || '',
          targetId: current.nodes[1]?.id || '',
          predicate: 'related_to',
        },
      ],
    }));
  };

  const updateEdge = (edgeId: string, patch: Partial<VisualTemplateEdge>) => {
    updateModel((current) => ({
      ...current,
      edges: current.edges.map((edge) => (edge.id === edgeId ? { ...edge, ...patch } : edge)),
    }));
  };

  const removeEdge = (edgeId: string) => {
    updateModel((current) => ({ ...current, edges: current.edges.filter((edge) => edge.id !== edgeId) }));
  };

  const nodeById = new Map(model.nodes.map((node) => [node.id, node] as const));

  return (
    <div
      style={{
        gridColumn: '1 / -1',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        padding: '12px',
        background: 'var(--panel)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>Visual Template Builder</div>
          <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
            Drag nodes to arrange the preview. Node names/types and connections stay synced with the template fields.
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Button variant="secondary" size="sm" onClick={addNode}>+ Node</Button>
          <Button variant="secondary" size="sm" onClick={addEdge} disabled={model.nodes.length < 2}>+ Connection</Button>
        </div>
      </div>

      <div
        ref={canvasRef}
        style={{
          position: 'relative',
          height: '260px',
          borderRadius: '10px',
          border: '1px solid var(--border)',
          background:
            'radial-gradient(circle at 20% 10%, rgba(14,165,233,0.08), transparent 35%), radial-gradient(circle at 85% 15%, rgba(124,58,237,0.08), transparent 40%), rgba(255,255,255,0.55)',
          overflow: 'hidden',
        }}
      >
        <svg viewBox="0 0 520 260" width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {model.edges.map((edge) => {
            const source = positions[edge.sourceId];
            const target = positions[edge.targetId];
            if (!source || !target) return null;
            const x1 = source.x + 48;
            const y1 = source.y + 20;
            const x2 = target.x + 48;
            const y2 = target.y + 20;
            return (
              <g key={edge.id}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(99,102,241,0.35)" strokeWidth="1.6" />
                <text
                  x={(x1 + x2) / 2}
                  y={(y1 + y2) / 2 - 4}
                  textAnchor="middle"
                  style={{ fontSize: '9px', fill: 'var(--muted)', fontFamily: 'var(--font-mono)' }}
                >
                  {edge.predicate || 'related_to'}
                </text>
              </g>
            );
          })}
        </svg>

        {model.nodes.map((node) => {
          const pos = positions[node.id] || { x: 18, y: 18 };
          return (
            <div
              key={node.id}
              onMouseDown={(event) => {
                const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
                setDragState({
                  nodeId: node.id,
                  dx: event.clientX - rect.left,
                  dy: event.clientY - rect.top,
                });
              }}
              style={{
                position: 'absolute',
                left: pos.x,
                top: pos.y,
                width: '96px',
                minHeight: '40px',
                borderRadius: '10px',
                border: '1px solid rgba(99, 102, 241, 0.28)',
                background: 'rgba(255,255,255,0.95)',
                boxShadow: '0 8px 18px rgba(15, 23, 42, 0.08)',
                padding: '6px 8px',
                cursor: 'grab',
                userSelect: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
              }}
              title="Drag to arrange preview layout"
            >
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--ink)', lineHeight: 1.2 }}>
                {node.name || 'Unnamed Node'}
              </div>
              <div style={{ fontSize: '9px', color: 'var(--muted)', lineHeight: 1.2 }}>
                {node.type || 'untyped'}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink)' }}>Nodes</div>
          {(model.nodes || []).length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Add nodes to start building the template graph.</div>
          ) : (
            model.nodes.map((node) => (
              <div key={`node-editor-${node.id}`} style={{ border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--surface)', padding: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '8px', alignItems: 'center' }}>
                <input
                  value={node.name}
                  onChange={(e) => updateNode(node.id, { name: e.target.value })}
                  placeholder="Starter node name"
                  style={inputStyle}
                />
                <input
                  value={node.type}
                  onChange={(e) => updateNode(node.id, { type: e.target.value })}
                  placeholder="Node type"
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={() => removeNode(node.id)}
                  style={{ border: '1px solid rgba(239,68,68,0.2)', background: 'transparent', color: '#b91c1c', borderRadius: '6px', padding: '6px 8px', cursor: 'pointer', fontSize: '12px' }}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink)' }}>Connections</div>
          {(model.edges || []).length === 0 ? (
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>No connections yet. Add one to define the starter graph relationships.</div>
          ) : (
            model.edges.map((edge) => (
              <div key={`edge-editor-${edge.id}`} style={{ border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--surface)', padding: '8px', display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '6px' }}>
                <select value={edge.sourceId} onChange={(e) => updateEdge(edge.id, { sourceId: e.target.value })} style={inputStyle}>
                  {model.nodes.map((node) => (
                    <option key={`${edge.id}-src-${node.id}`} value={node.id}>
                      {node.name} ({node.type || 'untyped'})
                    </option>
                  ))}
                </select>
                <input
                  value={edge.predicate}
                  onChange={(e) => updateEdge(edge.id, { predicate: e.target.value })}
                  placeholder="predicate"
                  style={{ ...inputStyle, minWidth: '90px' }}
                />
                <div style={{ display: 'flex', gap: '6px' }}>
                  <select value={edge.targetId} onChange={(e) => updateEdge(edge.id, { targetId: e.target.value })} style={inputStyle}>
                    {model.nodes.map((node) => (
                      <option key={`${edge.id}-tgt-${node.id}`} value={node.id}>
                        {node.name} ({node.type || 'untyped'})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeEdge(edge.id)}
                    style={{ border: '1px solid rgba(239,68,68,0.2)', background: 'transparent', color: '#b91c1c', borderRadius: '6px', padding: '6px 8px', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap' }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function MiniBlueprintMap({
  nodeLabels,
  accent = '#0ea5e9',
}: {
  nodeLabels: string[];
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
    <svg viewBox="0 0 220 130" width="100%" height="130" style={{ display: 'block', borderRadius: '10px', background: 'rgba(255,255,255,0.55)', border: '1px solid var(--border)' }}>
      {labels.map((_, i) => {
        if (i === 0) return null;
        const a = points[0];
        const b = points[i];
        return <line key={`edge-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(100,116,139,0.45)" strokeWidth="1.5" />;
      })}
      {labels.length >= 4 && <line x1={points[1].x} y1={points[1].y} x2={points[3].x} y2={points[3].y} stroke="rgba(100,116,139,0.35)" strokeWidth="1.2" />}
      {labels.length >= 5 && <line x1={points[2].x} y1={points[2].y} x2={points[4].x} y2={points[4].y} stroke="rgba(100,116,139,0.35)" strokeWidth="1.2" />}

      {labels.map((label, i) => (
        <g key={`node-${i}`} transform={`translate(${points[i].x},${points[i].y})`}>
          <circle r={i === 0 ? 13 : 10} fill={i === 0 ? accent : 'white'} stroke={i === 0 ? accent : 'rgba(100,116,139,0.45)'} strokeWidth="1.5" />
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

function CreateGraphLink({
  source,
  templateId,
  children,
}: {
  source: 'builtin' | 'custom';
  templateId: string;
  children: ReactNode;
}) {
  const href = `/home?create_graph=1&template_source=${encodeURIComponent(source)}&template_id=${encodeURIComponent(templateId)}`;
  return <Link href={href}>{children}</Link>;
}

export default function TemplatesPage() {
  const [customTemplates, setCustomTemplates] = useState<WorkspaceTemplate[]>([]);
  const [loadingCustomTemplates, setLoadingCustomTemplates] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [form, setForm] = useState<TemplateFormState>(makeEmptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cloneBusyTemplateId, setCloneBusyTemplateId] = useState<string | null>(null);
  const [exportDialogTemplate, setExportDialogTemplate] = useState<WorkspaceTemplate | null>(null);
  const [exportPayloadText, setExportPayloadText] = useState('');
  const [exportLoading, setExportLoading] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importMode, setImportMode] = useState<'clone' | 'version'>('clone');
  const [importLabelOverride, setImportLabelOverride] = useState('');
  const [importPayloadText, setImportPayloadText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [showAdvancedGraphFields, setShowAdvancedGraphFields] = useState(false);

  const isEditing = Boolean(editingTemplateId);

  const loadCustomTemplates = async () => {
    try {
      setLoadingCustomTemplates(true);
      setTemplatesError(null);
      const response = await listWorkspaceTemplates();
      setCustomTemplates(Array.isArray(response.templates) ? response.templates : []);
    } catch (err) {
      console.error('Failed to load templates:', err);
      setTemplatesError(err instanceof Error ? err.message : 'Failed to load templates');
      setCustomTemplates([]);
    } finally {
      setLoadingCustomTemplates(false);
    }
  };

  useEffect(() => {
    void loadCustomTemplates();
  }, []);

  const openNewTemplate = () => {
    setEditingTemplateId(null);
    setForm(makeEmptyForm());
    setFormError(null);
    setShowAdvancedGraphFields(false);
    setEditorOpen(true);
  };

  const openNewFromBlueprint = (blueprint: Blueprint) => {
    setEditingTemplateId(null);
    setForm(formFromBlueprint(blueprint));
    setFormError(null);
    setShowAdvancedGraphFields(false);
    setEditorOpen(true);
  };

  const openEditTemplate = (template: WorkspaceTemplate) => {
    setEditingTemplateId(template.template_id);
    setForm(formFromTemplate(template));
    setFormError(null);
    setShowAdvancedGraphFields(false);
    setEditorOpen(true);
  };

  const handleSaveTemplate = async () => {
    try {
      setSaving(true);
      setFormError(null);
      const payload = buildTemplatePayload(form);
      if (editingTemplateId) {
        await updateWorkspaceTemplate(editingTemplateId, payload);
      } else {
        await createWorkspaceTemplate(payload);
      }
      await loadCustomTemplates();
      setEditorOpen(false);
      setEditingTemplateId(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTemplate = async (template: WorkspaceTemplate) => {
    const ok = window.confirm(`Delete template "${template.label}"?`);
    if (!ok) return;
    try {
      await deleteWorkspaceTemplate(template.template_id);
      await loadCustomTemplates();
      if (editingTemplateId === template.template_id) {
        setEditorOpen(false);
        setEditingTemplateId(null);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete template');
    }
  };

  const handleCloneTemplate = async (template: WorkspaceTemplate, mode: 'clone' | 'version') => {
    try {
      setCloneBusyTemplateId(`${template.template_id}:${mode}`);
      await cloneWorkspaceTemplate(template.template_id, { mode });
      await loadCustomTemplates();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to clone template');
    } finally {
      setCloneBusyTemplateId(null);
    }
  };

  const handleExportTemplate = async (template: WorkspaceTemplate) => {
    try {
      setExportDialogTemplate(template);
      setExportLoading(true);
      const exported = await exportWorkspaceTemplate(template.template_id);
      setExportPayloadText(JSON.stringify(exported, null, 2));
    } catch (err) {
      setExportPayloadText('');
      alert(err instanceof Error ? err.message : 'Failed to export template');
      setExportDialogTemplate(null);
    } finally {
      setExportLoading(false);
    }
  };

  const handleImportTemplate = async () => {
    try {
      setImportLoading(true);
      setImportError(null);
      const parsed = JSON.parse(importPayloadText);
      await importWorkspaceTemplate({
        export_payload: parsed,
        mode: importMode,
        label_override: importLabelOverride.trim() || undefined,
      });
      await loadCustomTemplates();
      setImportDialogOpen(false);
      setImportPayloadText('');
      setImportLabelOverride('');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Failed to import template');
    } finally {
      setImportLoading(false);
    }
  };

  const crossVerticalCards = useMemo(
    () => [
      {
        title: 'Person ↔ Company',
        description: 'leadership changes, boards, founders, hires/leaves, spokesperson roles',
        accent: '#2563eb',
      },
      {
        title: 'Company ↔ Event',
        description: 'earnings, launches, incidents, partnerships, regulatory actions',
        accent: '#0ea5e9',
      },
      {
        title: 'Person ↔ Event',
        description: 'announcements, interviews, talks, testimony, accountability chains',
        accent: '#10b981',
      },
    ],
    []
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--page-bg)', padding: '32px 24px 56px' }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '13px', color: 'var(--muted)', marginBottom: '8px' }}>
              <Link href="/home" style={{ color: 'var(--muted)' }}>Home</Link> / Templates
            </div>
            <h1 style={{ margin: 0, fontSize: '32px', fontFamily: 'var(--font-display)', color: 'var(--ink)' }}>
              Research Template Studio
            </h1>
            <p style={{ marginTop: '10px', color: 'var(--muted)', fontSize: '14px', maxWidth: '840px' }}>
              Build reusable templates for person, company, and news/event research. Each template can define a node model, connection patterns, and workspace-level refresh defaults that nodes inherit automatically.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button variant="ghost" onClick={() => { setImportDialogOpen(true); setImportError(null); }}>
              Import Template
            </Button>
            <Button variant="secondary" onClick={openNewTemplate}>New Custom Template</Button>
            <Link href="/home">
              <Button variant="primary">Back to Create Graph</Button>
            </Link>
          </div>
        </div>

        <GlassCard>
          <h2 style={{ margin: 0, fontSize: '18px', fontFamily: 'var(--font-display)' }}>How the three verticals connect</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', marginTop: '12px' }}>
            {crossVerticalCards.map((card) => (
              <div key={card.title} style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '12px', background: 'var(--panel)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '999px', background: card.accent, display: 'inline-block' }} />
                  <div style={{ fontWeight: 600, fontSize: '13px' }}>{card.title}</div>
                </div>
                <div style={{ marginTop: '6px', color: 'var(--muted)', fontSize: '12px' }}>{card.description}</div>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', fontFamily: 'var(--font-display)' }}>Built-in Blueprints</h2>
            <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Use directly or fork into a custom template</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: '16px' }}>
            {BUILTIN_BLUEPRINTS.map((tpl) => (
              <GlassCard key={tpl.id} style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '18px', fontFamily: 'var(--font-display)' }}>{tpl.label}</h3>
                  <Badge variant="outline">{tpl.id}</Badge>
                </div>
                <p style={{ marginTop: '8px', color: 'var(--muted)', fontSize: '13px' }}>{tpl.description}</p>

                <div style={{ marginTop: '12px' }}>
                  <MiniBlueprintMap nodeLabels={tpl.nodes} accent={tpl.id === 'company_research' ? '#0ea5e9' : tpl.id === 'person_research' ? '#2563eb' : '#10b981'} />
                </div>

                <div style={{ marginTop: '12px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Node model</div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {tpl.nodes.map((node) => (
                      <Badge key={node} variant="neutral" size="sm">{node}</Badge>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: '12px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>Connection patterns</div>
                  <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--muted)', fontSize: '12px', lineHeight: 1.6 }}>
                    {tpl.connections.map((c) => <li key={c}>{c}</li>)}
                  </ul>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
                  <CreateGraphLink source="builtin" templateId={tpl.createTemplateId}>
                    <Button variant="primary" size="sm">Create Workspace</Button>
                  </CreateGraphLink>
                  <Button variant="secondary" size="sm" onClick={() => openNewFromBlueprint(tpl)}>
                    Build Custom Template
                  </Button>
                </div>
              </GlassCard>
            ))}
          </div>
        </GlassCard>

        <GlassCard>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
            <h2 style={{ margin: 0, fontSize: '18px', fontFamily: 'var(--font-display)' }}>Custom Templates</h2>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <Button variant="secondary" size="sm" onClick={() => void loadCustomTemplates()} disabled={loadingCustomTemplates}>
                {loadingCustomTemplates ? 'Refreshing...' : 'Refresh'}
              </Button>
              <Button variant="primary" size="sm" onClick={openNewTemplate}>New Template</Button>
            </div>
          </div>

          {templatesError && (
            <div style={{ marginBottom: '12px', color: '#b91c1c', fontSize: '12px' }}>{templatesError}</div>
          )}

          {loadingCustomTemplates ? (
            <div style={{ color: 'var(--muted)', fontSize: '13px' }}>Loading custom templates...</div>
          ) : customTemplates.length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: '13px' }}>
              No custom templates yet. Start from a built-in blueprint or create one from scratch.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: '16px' }}>
              {customTemplates.map((tpl) => (
                <GlassCard key={tpl.template_id} style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '17px', fontFamily: 'var(--font-display)' }}>{tpl.label}</h3>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <Badge variant="neutral">custom</Badge>
                      <Badge variant="outline">v{tpl.version || 1}</Badge>
                    </div>
                  </div>
                  <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--muted)' }}>{tpl.template_id}</div>
                  <div style={{ marginTop: '2px', fontSize: '11px', color: 'var(--muted)' }}>
                    family: {tpl.template_family_id || tpl.template_id}
                    {tpl.parent_template_id ? ` · parent: ${tpl.parent_template_id}` : ''}
                  </div>
                  {tpl.description && (
                    <p style={{ marginTop: '8px', color: 'var(--muted)', fontSize: '13px' }}>{tpl.description}</p>
                  )}

                  <div style={{ marginTop: '10px' }}>
                    <MiniBlueprintMap nodeLabels={tpl.starter_nodes?.length ? tpl.starter_nodes : (tpl.node_types?.length ? tpl.node_types : ['Node', 'Node', 'Node'])} accent="#7c3aed" />
                  </div>

                  <div style={{ marginTop: '12px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {(tpl.tags || []).slice(0, 6).map((tag) => (
                      <Badge key={tag} variant="outline" size="sm">{tag}</Badge>
                    ))}
                    {tpl.vertical ? <Badge variant="neutral" size="sm">{tpl.vertical}</Badge> : null}
                  </div>

                  <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--muted)' }}>
                    Node types: {(tpl.node_types || []).length} · Starter nodes: {(tpl.starter_nodes || []).length} · Checks: {(tpl.default_checks || []).length} · Connections: {(tpl.connection_patterns || []).length}
                    <br />
                    Refresh defaults: {tpl.refresh_defaults ? 'Yes' : 'No'}
                  </div>

                  <div style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
                    <CreateGraphLink source="custom" templateId={tpl.template_id}>
                      <Button variant="primary" size="sm">Create Workspace</Button>
                    </CreateGraphLink>
                    <Button variant="secondary" size="sm" onClick={() => openEditTemplate(tpl)}>Edit</Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleCloneTemplate(tpl, 'clone')}
                      disabled={cloneBusyTemplateId === `${tpl.template_id}:clone`}
                    >
                      {cloneBusyTemplateId === `${tpl.template_id}:clone` ? 'Cloning...' : 'Clone'}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleCloneTemplate(tpl, 'version')}
                      disabled={cloneBusyTemplateId === `${tpl.template_id}:version`}
                    >
                      {cloneBusyTemplateId === `${tpl.template_id}:version` ? 'Versioning...' : 'New Version'}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void handleExportTemplate(tpl)}>
                      Export
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void handleDeleteTemplate(tpl)} style={{ color: '#b91c1c' }}>
                      Delete
                    </Button>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </GlassCard>

        {editorOpen && (
          <GlassCard style={{ border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontFamily: 'var(--font-display)' }}>
                {isEditing ? 'Edit Custom Template' : 'Create Custom Template'}
              </h2>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <Button variant="secondary" size="sm" onClick={() => setEditorOpen(false)} disabled={saving}>Close</Button>
                <Button variant="primary" size="sm" onClick={handleSaveTemplate} disabled={saving}>
                  {saving ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Template'}
                </Button>
              </div>
            </div>

            {formError && (
              <div style={{ marginBottom: '12px', color: '#b91c1c', fontSize: '12px' }}>{formError}</div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>Template name</label>
                <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} style={inputStyle} placeholder="e.g. Exec tracking template" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>Vertical</label>
                <select value={form.vertical} onChange={(e) => setForm((f) => ({ ...f, vertical: e.target.value }))} style={inputStyle}>
                  <option value="">Custom / mixed</option>
                  <option value="person">person</option>
                  <option value="company">company</option>
                  <option value="news_event">news_event</option>
                  <option value="mixed">mixed</option>
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>Description</label>
                <textarea rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} style={textareaStyle} />
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>Intent</label>
                <input value={form.intent} onChange={(e) => setForm((f) => ({ ...f, intent: e.target.value }))} style={inputStyle} placeholder="What this workspace template is for" />
              </div>
              <VisualTemplateBuilder form={form} setForm={setForm} />
              <TemplateTextAreaField label="Tags (comma or newline separated)" value={form.tagsText} onChange={(value) => setForm((f) => ({ ...f, tagsText: value }))} rows={3} />
              <TemplateTextAreaField label="Default check summaries" value={form.defaultChecksText} onChange={(value) => setForm((f) => ({ ...f, defaultChecksText: value }))} rows={5} />
              <div style={{ gridColumn: '1 / -1', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--surface)', padding: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowAdvancedGraphFields((v) => !v)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--ink)',
                    cursor: 'pointer',
                    padding: 0,
                    fontSize: '12px',
                    fontWeight: 600,
                  }}
                >
                  <span>Advanced raw graph fields (types / starter names / connections)</span>
                  <span style={{ color: 'var(--muted)' }}>{showAdvancedGraphFields ? 'Hide' : 'Show'}</span>
                </button>
                {showAdvancedGraphFields && (
                  <div style={{ marginTop: '10px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
                    <TemplateTextAreaField label="Node types" value={form.nodeTypesText} onChange={(value) => setForm((f) => ({ ...f, nodeTypesText: value }))} rows={5} />
                    <TemplateTextAreaField label="Starter node names (optional)" value={form.starterNodesText} onChange={(value) => setForm((f) => ({ ...f, starterNodesText: value }))} rows={5} />
                    <TemplateTextAreaField label="Connection patterns" value={form.connectionPatternsText} onChange={(value) => setForm((f) => ({ ...f, connectionPatternsText: value }))} rows={5} />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600 }}>Visual node layout (JSON, optional)</label>
                      <textarea
                        rows={6}
                        value={form.nodeLayoutText}
                        onChange={(e) => setForm((f) => ({ ...f, nodeLayoutText: e.target.value }))}
                        style={{ ...textareaStyle, fontFamily: 'var(--font-mono)', fontSize: '11px' }}
                        placeholder={`{\n  \"target_person_1\": { \"x\": 42, \"y\": 34 }\n}`}
                      />
                    </div>
                  </div>
                )}
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>Workspace refresh defaults (JSON, optional)</label>
                <textarea
                  rows={12}
                  value={form.refreshDefaultsText}
                  onChange={(e) => setForm((f) => ({ ...f, refreshDefaultsText: e.target.value }))}
                  style={{ ...textareaStyle, fontFamily: 'var(--font-mono)', fontSize: '11px' }}
                  placeholder={`{\n  "enabled": true,\n  "triggers": ["manual", "on_open", "scheduled"],\n  "ttl_seconds": 3600,\n  "checks": [\n    {\n      "kind": "exa_news",\n      "query": "{{concept_name}}",\n      "params": { "max_age_hours": 6, "limit": 8 }\n    }\n  ]\n}`}
                />
                <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                  Supports runtime placeholders like <code>{'{{concept_name}}'}</code> in refresh check queries.
                </div>
              </div>
            </div>
          </GlassCard>
        )}

        {exportDialogTemplate && (
          <GlassCard style={{ border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontFamily: 'var(--font-display)' }}>
                Export Template: {exportDialogTemplate.label}
              </h2>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <Button variant="secondary" size="sm" onClick={() => setExportDialogTemplate(null)}>Close</Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(exportPayloadText || '');
                    } catch {
                      // ignore clipboard issues
                    }
                  }}
                  disabled={!exportPayloadText}
                >
                  Copy JSON
                </Button>
              </div>
            </div>
            {exportLoading ? (
              <div style={{ color: 'var(--muted)', fontSize: '13px' }}>Generating export payload...</div>
            ) : (
              <textarea
                rows={16}
                value={exportPayloadText}
                readOnly
                style={{ ...textareaStyle, fontFamily: 'var(--font-mono)', fontSize: '11px' }}
              />
            )}
          </GlassCard>
        )}

        {importDialogOpen && (
          <GlassCard style={{ border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
              <h2 style={{ margin: 0, fontSize: '18px', fontFamily: 'var(--font-display)' }}>Import Template</h2>
              <Button variant="secondary" size="sm" onClick={() => setImportDialogOpen(false)} disabled={importLoading}>
                Close
              </Button>
            </div>
            {importError && <div style={{ marginBottom: '12px', color: '#b91c1c', fontSize: '12px' }}>{importError}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px', marginBottom: '12px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>Import mode</label>
                <select value={importMode} onChange={(e) => setImportMode(e.target.value as 'clone' | 'version')} style={inputStyle}>
                  <option value="clone">Clone (new template family)</option>
                  <option value="version">New version (preserve exported family)</option>
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600 }}>Label override (optional)</label>
                <input value={importLabelOverride} onChange={(e) => setImportLabelOverride(e.target.value)} style={inputStyle} placeholder="Optional imported template name" />
              </div>
            </div>
            <textarea
              rows={16}
              value={importPayloadText}
              onChange={(e) => setImportPayloadText(e.target.value)}
              style={{ ...textareaStyle, fontFamily: 'var(--font-mono)', fontSize: '11px' }}
              placeholder="Paste exported template JSON here..."
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '12px' }}>
              <Button variant="primary" onClick={handleImportTemplate} disabled={importLoading}>
                {importLoading ? 'Importing...' : 'Import Template'}
              </Button>
            </div>
          </GlassCard>
        )}
      </div>
    </div>
  );
}

function TemplateTextAreaField({
  label,
  value,
  onChange,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <label style={{ fontSize: '12px', fontWeight: 600 }}>{label}</label>
      <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} style={textareaStyle} />
    </div>
  );
}

const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '8px 10px',
  fontSize: '13px',
  color: 'var(--ink)',
  background: 'var(--surface)',
};

const textareaStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '8px 10px',
  fontSize: '13px',
  color: 'var(--ink)',
  background: 'var(--surface)',
  resize: 'vertical',
};
