'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  getConcept,
  getNeighborsWithRelationships,
  getConceptMentions,
  getSegmentsByConcept,
  updateConcept,
  type Concept,
  type LectureMention,
  type LectureSegment,
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
  const [segments, setSegments] = useState<LectureSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isActive = true;
    setLoading(true);
    setError(null);

    Promise.all([
      getConcept(conceptId),
      getNeighborsWithRelationships(conceptId).catch(() => []),
      getConceptMentions(conceptId).catch(() => []),
    ])
      .then(async ([conceptData, neighborsData, mentions]) => {
        if (!isActive) return;
        setConcept(conceptData);
        setNeighbors(neighborsData || []);
        setBacklinks(mentions || []);

        if (conceptData?.name) {
          const segmentData = await getSegmentsByConcept(conceptData.name).catch(() => []);
          if (isActive) setSegments(segmentData || []);
        }
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase' }}>
                  Definition
                </div>
                {!isEditing && (
                  <button
                    onClick={() => { setIsEditing(true); setEditValue(concept.description || ''); }}
                    style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: '11px', cursor: 'pointer' }}
                  >
                    Edit
                  </button>
                )}
              </div>

              {isEditing ? (
                <div style={{ marginTop: '8px' }}>
                  <textarea
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    style={{
                      width: '100%', minHeight: '120px', padding: '8px',
                      borderRadius: '8px', border: '1px solid var(--accent)',
                      fontSize: '14px', background: 'var(--panel)', color: 'var(--ink)'
                    }}
                  />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button
                      disabled={isSaving}
                      onClick={async () => {
                        setIsSaving(true);
                        try {
                          const updated = await updateConcept(conceptId, { description: editValue });
                          setConcept(updated);
                          setIsEditing(false);
                        } catch (e) {
                          alert("Failed to save description");
                        } finally {
                          setIsSaving(false);
                        }
                      }}
                      style={{
                        padding: '4px 12px', borderRadius: '6px', border: 'none',
                        background: 'var(--accent)', color: '#fff', fontSize: '12px', cursor: 'pointer'
                      }}
                    >
                      {isSaving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={() => setIsEditing(false)}
                      style={{
                        padding: '4px 12px', borderRadius: '6px', border: '1px solid var(--border)',
                        background: 'transparent', color: 'var(--muted)', fontSize: '12px', cursor: 'pointer'
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: '8px', fontSize: '14px', color: 'var(--ink)', lineHeight: 1.6 }}>
                  {concept.description || 'No definition yet.'}
                </div>
              )}
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

              {segments.length > 0 && (
                <div style={{ marginTop: '20px' }}>
                  <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase' }}>
                    Lecture Segments & Handwriting
                  </div>
                  {segments.map((seg) => (
                    <div
                      key={seg.segment_id}
                      style={{
                        marginTop: '12px',
                        padding: '10px',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        background: 'rgba(0,0,0,0.02)'
                      }}
                    >
                      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)' }}>
                        {seg.lecture_title || 'Untitled Lecture'}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '4px', fontStyle: 'italic' }}>
                        {seg.summary}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--ink)', marginTop: '8px', lineHeight: '1.4' }}>
                        {truncate(seg.text, 150)}
                      </div>
                      {seg.ink_url && (
                        <div style={{ marginTop: '10px', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                          <img src={seg.ink_url} alt="Handwriting snippet" style={{ width: '100%', display: 'block' }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
