'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { API_BASE_URL, getApiHeaders } from '../../api/base';

interface RelatedNote {
  lecture_id: string;
  title: string;
  snippet: string;
  concept_name?: string;
}

interface RelatedNotesProps {
  messageContent: string;
  graphId?: string;
}

export default function RelatedNotes({ messageContent, graphId }: RelatedNotesProps) {
  const router = useRouter();
  const [notes, setNotes] = useState<RelatedNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function findRelated() {
      try {
        const headers = await getApiHeaders();
        const keywords = extractKeyPhrases(messageContent);
        if (!keywords.length) {
          setLoading(false);
          return;
        }

        const results: RelatedNote[] = [];
        const seenIds = new Set<string>();

        for (const keyword of keywords.slice(0, 3)) {
          try {
            const res = await fetch(
              `${API_BASE_URL}/concepts/search?q=${encodeURIComponent(keyword)}&graph_id=${encodeURIComponent(graphId || 'default')}&limit=2`,
              { headers }
            );
            if (!res.ok) continue;
            const concepts = await res.json();

            for (const concept of concepts.slice(0, 1)) {
              if (!concept.node_id || seenIds.has(concept.node_id)) continue;
              seenIds.add(concept.node_id);

              try {
                const mentionsRes = await fetch(
                  `${API_BASE_URL}/concepts/${encodeURIComponent(concept.node_id)}/mentions`,
                  { headers }
                );
                if (!mentionsRes.ok) continue;
                const mentions = await mentionsRes.json();

                for (const mention of mentions.slice(0, 2)) {
                  if (seenIds.has(mention.lecture_id)) continue;
                  seenIds.add(mention.lecture_id);
                  results.push({
                    lecture_id: mention.lecture_id,
                    title: mention.lecture_title || 'Untitled Note',
                    snippet: mention.segment_text?.slice(0, 120) || '',
                    concept_name: concept.name,
                  });
                }
              } catch { /* ignore individual mention fetch failures */ }
            }
          } catch { /* ignore individual search failures */ }
        }

        if (!cancelled) {
          setNotes(results.slice(0, 3));
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    findRelated();
    return () => { cancelled = true; };
  }, [messageContent, graphId]);

  if (loading || notes.length === 0) return null;

  return (
    <div style={{
      margin: '6px 0',
      padding: '10px 14px',
      background: 'rgba(37, 99, 235, 0.04)',
      border: '1px solid rgba(37, 99, 235, 0.15)',
      borderRadius: '12px',
      fontSize: '13px',
    }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', color: 'var(--accent, #3b82f6)', fontWeight: 600, fontSize: '12px' }}
      >
        <span>📝</span>
        From your notes ({notes.length})
        <span style={{ fontSize: '10px', color: 'var(--muted)' }}>{collapsed ? '▶' : '▼'}</span>
      </div>

      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
          {notes.map((note) => (
            <div
              key={note.lecture_id}
              onClick={() => router.push(`/lecture-editor?id=${encodeURIComponent(note.lecture_id)}`)}
              style={{
                padding: '8px 10px',
                background: 'var(--panel)',
                borderRadius: '8px',
                cursor: 'pointer',
                border: '1px solid var(--border)',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: '13px', marginBottom: '2px' }}>
                {note.title}
              </div>
              {note.snippet && (
                <div style={{ color: 'var(--muted)', fontSize: '12px', lineHeight: 1.4 }}>
                  {note.snippet}...
                </div>
              )}
              {note.concept_name && (
                <div style={{ fontSize: '11px', color: 'var(--accent)', marginTop: '2px' }}>
                  Related to: {note.concept_name}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function extractKeyPhrases(text: string): string[] {
  const cleaned = text
    .replace(/[#*_`~\[\](){}|>]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\n+/g, ' ');

  const sentences = cleaned.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const words = new Set<string>();

  for (const sentence of sentences.slice(0, 3)) {
    const tokens = sentence.trim().split(/\s+/);
    for (let i = 0; i < tokens.length - 1; i++) {
      const bigram = `${tokens[i]} ${tokens[i + 1]}`.replace(/[^a-zA-Z\s]/g, '').trim();
      if (bigram.length > 5 && !isStopBigram(bigram)) {
        words.add(bigram);
        if (words.size >= 5) break;
      }
    }
    if (words.size >= 5) break;
  }

  return Array.from(words);
}

const STOP_WORDS = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has', 'her', 'was', 'one', 'our', 'out', 'its', 'this', 'that', 'with', 'have', 'from', 'been', 'they', 'will', 'also', 'more', 'than', 'each', 'which', 'their', 'about', 'would', 'these', 'other', 'into', 'could', 'some']);

function isStopBigram(bigram: string): boolean {
  const words = bigram.toLowerCase().split(' ');
  return words.every(w => STOP_WORDS.has(w) || w.length <= 2);
}
