'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { getLectureSection, type LectureSection } from '../api-client';

function renderHighlightedText(text: string, start: number | null, end: number | null) {
  if (start === null || end === null || start < 0 || end <= start || start >= text.length) {
    return <span>{text}</span>;
  }

  const safeStart = Math.max(0, Math.min(start, text.length));
  const safeEnd = Math.max(safeStart + 1, Math.min(end, text.length));
  const before = text.slice(0, safeStart);
  const highlight = text.slice(safeStart, safeEnd);
  const after = text.slice(safeEnd);

  return (
    <span>
      {before}
      <mark style={{ background: 'rgba(250, 200, 80, 0.5)', padding: '2px 0' }}>
        {highlight}
      </mark>
      {after}
    </span>
  );
}

export default function LectureViewerPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [section, setSection] = useState<LectureSection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const lectureId = searchParams?.get('lecture_document_id') || '';
  const sectionId = searchParams?.get('section_id') || '';
  const linkId = searchParams?.get('link_id') || null;
  const startOffset = useMemo(() => {
    const raw = searchParams?.get('start_offset');
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }, [searchParams]);
  const endOffset = useMemo(() => {
    const raw = searchParams?.get('end_offset');
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }, [searchParams]);

  useEffect(() => {
    if (!lectureId || !sectionId) {
      setError('Missing lecture section parameters.');
      setLoading(false);
      return;
    }

    let cancelled = false;
    async function loadSection() {
      setLoading(true);
      setError(null);
      try {
        const data = await getLectureSection(lectureId, sectionId, linkId);
        if (!cancelled) {
          setSection(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load lecture section');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    loadSection();
    return () => {
      cancelled = true;
    };
  }, [lectureId, sectionId, linkId]);

  const handleBack = () => {
    if (typeof window !== 'undefined') {
      try {
        const raw = sessionStorage.getItem('brainweb:lectureLinkReturn');
        if (raw) {
          const parsed = JSON.parse(raw) as { path?: string };
          if (parsed.path) {
            router.push(parsed.path);
            return;
          }
        }
      } catch {
        // Fall through.
      }
    }
    router.push('/');
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', padding: '32px', background: 'var(--background)', color: 'var(--ink)' }}>
        <div style={{ fontSize: '14px', color: 'var(--muted)' }}>Loading lecture section...</div>
      </div>
    );
  }

  if (error || !section) {
    return (
      <div style={{ minHeight: '100vh', padding: '32px', background: 'var(--background)', color: 'var(--ink)' }}>
        <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '12px' }}>
          {error || 'Lecture section not found.'}
        </div>
        <button
          onClick={handleBack}
          style={{
            padding: '8px 14px',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--ink)',
            cursor: 'pointer',
          }}
        >
          Back to chat
        </button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--background)', color: 'var(--ink)' }}>
      <div className="content-padding" style={{
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
        paddingTop: '24px',
        paddingBottom: '16px',
      }}>
        <div>
          <div style={{ fontSize: '12px', color: 'var(--muted)' }}>
            Document {lectureId} • Section {section.section_index}
          </div>
          <div style={{ fontSize: '18px', fontWeight: 600 }}>
            {section.title || 'Lecture section'}
          </div>
        </div>
        <button
          onClick={handleBack}
          style={{
            padding: '8px 14px',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            color: 'var(--ink)',
            cursor: 'pointer',
          }}
        >
          Back to chat
        </button>
      </div>
      <div className="content-padding">
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: '1.7', fontSize: '15px' }}>
          {renderHighlightedText(section.raw_text, startOffset, endOffset)}
        </div>
      </div>
    </div>
  );
}
