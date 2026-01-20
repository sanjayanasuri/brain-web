'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  getConcept,
  getNeighborsWithRelationships,
  getConceptMentions,
  type Concept,
  type LectureMention,
} from '../../api-client';

interface ConceptPanelProps {
  conceptId: string;
  mention?: LectureMention | null;
  onClose: () => void;
  onBacklinkClick?: (mention: LectureMention) => void;
}

type Neighbor = {
  concept: Concept;
  predicate?: string | null;
  is_outgoing?: boolean;
};

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

export function ConceptPanel({ conceptId, mention, onClose, onBacklinkClick }: ConceptPanelProps) {
  const [concept, setConcept] = useState<Concept | null>(null);
  const [neighbors, setNeighbors] = useState<Neighbor[]>([]);
  const [backlinks, setBacklinks] = useState<LectureMention[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;
    setLoading(true);
    setError(null);

    Promise.all([
      getConcept(conceptId),
      getNeighborsWithRelationships(conceptId).catch(() => []),
      getConceptMentions(conceptId).catch(() => []),
    ])
      .then(([conceptData, neighborsData, mentions]) => {
        if (!isActive) {
          return;
        }
        setConcept(conceptData);
        setNeighbors(neighborsData || []);
        setBacklinks(mentions || []);
      })
      .catch((err) => {
        if (!isActive) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load concept');
      })
      .finally(() => {
        if (isActive) {
          setLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [conceptId]);

  const backlinksByLecture = useMemo(() => {
    const grouped = new Map<string, { title: string; mentions: LectureMention[] }>();
    backlinks.forEach((item) => {
      const title = item.lecture_title || item.lecture_id;
      if (!grouped.has(item.lecture_id)) {
        grouped.set(item.lecture_id, { title, mentions: [] });
      }
      grouped.get(item.lecture_id)!.mentions.push(item);
    });
    return Array.from(grouped.values());
  }, [backlinks]);

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--ink)' }}>Concept</div>
        <button
          onClick={onClose}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--muted)',
            cursor: 'pointer',
            fontSize: '18px',
          }}
          aria-label="Close concept panel"
        >
          x
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        {loading && <div style={{ color: 'var(--muted)' }}>Loading concept...</div>}
        {error && <div style={{ color: 'var(--accent-2)' }}>{error}</div>}
        {!loading && !error && concept && (
          <>
            <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--ink)', marginBottom: '6px' }}>
              {concept.name}
            </div>
            {concept.domain && (
              <div style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--muted)' }}>
                {concept.domain}
              </div>
            )}

            <div style={{ marginTop: '16px', marginBottom: '16px' }}>
              <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase' }}>
                Definition
              </div>
              <div style={{ marginTop: '8px', fontSize: '14px', color: 'var(--ink)', lineHeight: 1.6 }}>
                {concept.description || 'No definition yet.'}
              </div>
            </div>

            {mention && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase' }}>
                  Context note
                </div>
                <div style={{ marginTop: '8px', fontSize: '14px', color: 'var(--ink)', lineHeight: 1.6 }}>
                  {mention.context_note || 'No context note for this mention.'}
                </div>
              </div>
            )}

            {neighbors.length > 0 && (
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase' }}>
                  Concept graph
                </div>
                <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {neighbors.slice(0, 12).map((neighbor) => (
                    <div
                      key={`${neighbor.concept.node_id}-${neighbor.predicate}`}
                      style={{
                        padding: '6px 8px',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        fontSize: '12px',
                        color: 'var(--ink)',
                      }}
                    >
                      <span style={{ color: 'var(--accent)', marginRight: '6px' }}>
                        {neighbor.is_outgoing ? '->' : '<-'}
                      </span>
                      {neighbor.concept.name}
                      {neighbor.predicate && (
                        <span style={{ color: 'var(--muted)', marginLeft: '6px' }}>{neighbor.predicate}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase' }}>
                Backlinks
              </div>
              {backlinksByLecture.length === 0 && (
                <div style={{ marginTop: '8px', color: 'var(--muted)', fontSize: '13px' }}>
                  No other mentions yet.
                </div>
              )}
              {backlinksByLecture.map((group) => (
                <div key={group.title} style={{ marginTop: '12px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>{group.title}</div>
                  {group.mentions.map((item) => (
                    <button
                      key={item.mention_id}
                      onClick={() => onBacklinkClick?.(item)}
                      style={{
                        marginTop: '6px',
                        width: '100%',
                        textAlign: 'left',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        padding: '8px 10px',
                        background: 'var(--panel)',
                        cursor: onBacklinkClick ? 'pointer' : 'default',
                      }}
                    >
                      <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                        &quot;{item.surface_text}&quot;
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--ink)' }}>
                        {truncate(item.block_text || '', 140)}
                      </div>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
