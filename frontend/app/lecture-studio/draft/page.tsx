'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  getLecture, 
  getLectureSegments,
  type Lecture,
  type LectureSegment,
  type Concept,
} from '../../api-client';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';

interface DraftResult {
  outline: string[];
  sections: Array<{
    title: string;
    summary: string;
  }>;
  suggested_analogies: Array<{
    label: string;
    description: string;
    target_concepts: string[];
  }>;
}

export default function DraftLecturePage() {
  return (
    <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center' }}>Loading…</div>}>
      <DraftLecturePageInner />
    </Suspense>
  );
}

function DraftLecturePageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const lectureId = searchParams?.get('lectureId') ?? null;

  const [lecture, setLecture] = useState<Lecture | null>(null);
  const [segments, setSegments] = useState<LectureSegment[]>([]);
  const [seedConcepts, setSeedConcepts] = useState<string[]>([]);
  const [targetLevel, setTargetLevel] = useState<string>('intermediate');
  const [loading, setLoading] = useState(false);
  const [draftResult, setDraftResult] = useState<DraftResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = lectureId;
    if (!id) {
      setError('No lecture ID provided');
      return;
    }

    async function loadData(lectureId: string) {
      try {
        const [lectureData, segmentsData] = await Promise.all([
          getLecture(lectureId),
          getLectureSegments(lectureId),
        ]);
        setLecture(lectureData);
        setSegments(segmentsData);
        
        // Extract unique concept names from segments
        const conceptNames = new Set<string>();
        segmentsData.forEach(seg => {
          seg.covered_concepts.forEach(concept => {
            conceptNames.add(concept.name);
          });
        });
        setSeedConcepts(Array.from(conceptNames));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load lecture');
      }
    }

    loadData(id);
  }, [lectureId]);

  const handleDraft = async () => {
    if (!lectureId) {
      setError('No lecture ID provided');
      return;
    }
    if (seedConcepts.length === 0) {
      setError('Please select at least one concept');
      return;
    }

    setLoading(true);
    setError(null);
    setDraftResult(null);

    try {
      const response = await fetch(`${API_BASE_URL}/lectures/draft-next`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seed_concepts: seedConcepts,
          source_lecture_id: lectureId,
          target_level: targetLevel,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to draft lecture: ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      setDraftResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to draft lecture');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyToClipboard = () => {
    if (!draftResult) return;
    
    const text = [
      'OUTLINE:',
      ...draftResult.outline,
      '',
      'SECTIONS:',
      ...draftResult.sections.map(s => `${s.title}\n${s.summary}`),
      '',
      'SUGGESTED ANALOGIES:',
      ...draftResult.suggested_analogies.map(a => `${a.label}: ${a.description}`),
    ].join('\n');
    
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard!');
  };

  if (error && !lecture) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '18px', color: 'var(--accent-2)' }}>{error}</div>
        <Link href="/" style={{ marginTop: '20px', display: 'inline-block', color: 'var(--accent)' }}>
          ← Back to Graph
        </Link>
      </div>
    );
  }

  // Collect all concepts from segments for selection
  const allConcepts = new Map<string, Concept>();
  segments.forEach(seg => {
    seg.covered_concepts.forEach(concept => {
      if (!allConcepts.has(concept.node_id)) {
        allConcepts.set(concept.node_id, concept);
      }
    });
  });

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'linear-gradient(180deg, #fdf7ec 0%, #eef6ff 60%, #f7f9fb 100%)',
      padding: '20px',
    }}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <Link 
            href={`/lecture-studio?lectureId=${lectureId}`}
            style={{ color: 'var(--accent)', textDecoration: 'none', fontSize: '14px' }}
          >
            ← Back to Lecture Studio
          </Link>
          <h1 style={{ fontSize: '32px', fontWeight: '700', marginTop: '12px', marginBottom: '8px' }}>
            Draft Follow-up Lecture
          </h1>
          {lecture && (
            <p style={{ color: 'var(--muted)', fontSize: '16px' }}>
              Based on: {lecture.title}
            </p>
          )}
        </div>

        {/* Form */}
        <div style={{
          background: 'var(--panel)',
          borderRadius: '12px',
          padding: '24px',
          boxShadow: 'var(--shadow)',
          marginBottom: '24px',
        }}>
          <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '16px' }}>
            Select Concepts
          </h2>
          
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
              Target Level
            </label>
            <select
              value={targetLevel}
              onChange={(e) => setTargetLevel(e.target.value)}
              style={{
                width: '100%',
                maxWidth: '300px',
                padding: '8px',
                border: '1px solid var(--border)',
                borderRadius: '6px',
                fontSize: '14px',
              }}
            >
              <option value="intro">Intro</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500' }}>
              Seed Concepts (select concepts to build the lecture around)
            </label>
            <div style={{ 
              display: 'flex', 
              flexWrap: 'wrap', 
              gap: '8px',
              maxHeight: '200px',
              overflowY: 'auto',
              padding: '12px',
              border: '1px solid var(--border)',
              borderRadius: '6px',
            }}>
              {Array.from(allConcepts.values()).map(concept => (
                <label
                  key={concept.node_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '6px 12px',
                    background: seedConcepts.includes(concept.name)
                      ? 'var(--accent)'
                      : 'rgba(17, 138, 178, 0.1)',
                    color: seedConcepts.includes(concept.name) ? 'white' : 'var(--accent)',
                    borderRadius: '20px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: '500',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={seedConcepts.includes(concept.name)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSeedConcepts([...seedConcepts, concept.name]);
                      } else {
                        setSeedConcepts(seedConcepts.filter(n => n !== concept.name));
                      }
                    }}
                    style={{ marginRight: '6px' }}
                  />
                  {concept.name}
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={handleDraft}
            disabled={loading || seedConcepts.length === 0}
            style={{
              padding: '12px 24px',
              background: loading || seedConcepts.length === 0 ? 'var(--muted)' : 'var(--accent)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: loading || seedConcepts.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Drafting...' : 'Draft Lecture'}
          </button>

          {error && (
            <div style={{ 
              marginTop: '16px', 
              padding: '12px', 
              background: 'rgba(239, 71, 111, 0.1)', 
              border: '1px solid var(--accent-2)',
              borderRadius: '6px',
              color: 'var(--accent-2)',
              fontSize: '14px',
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Results */}
        {draftResult && (
          <div style={{
            background: 'var(--panel)',
            borderRadius: '12px',
            padding: '24px',
            boxShadow: 'var(--shadow)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '18px', fontWeight: '600' }}>Draft Result</h2>
              <button
                onClick={handleCopyToClipboard}
                style={{
                  padding: '8px 16px',
                  background: 'var(--accent)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  fontSize: '13px',
                  fontWeight: '500',
                  cursor: 'pointer',
                }}
              >
                Copy to Clipboard
              </button>
            </div>

            {/* Outline */}
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>Outline</h3>
              <ol style={{ paddingLeft: '20px' }}>
                {draftResult.outline.map((item, index) => (
                  <li key={index} style={{ marginBottom: '8px', fontSize: '14px', lineHeight: '1.6' }}>
                    {item}
                  </li>
                ))}
              </ol>
            </div>

            {/* Sections */}
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>Sections</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {draftResult.sections.map((section, index) => (
                  <div
                    key={index}
                    style={{
                      padding: '12px',
                      background: 'rgba(17, 138, 178, 0.05)',
                      borderRadius: '6px',
                      border: '1px solid rgba(17, 138, 178, 0.2)',
                    }}
                  >
                    <div style={{ fontSize: '14px', fontWeight: '600', marginBottom: '4px' }}>
                      {section.title}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
                      {section.summary}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Suggested Analogies */}
            {draftResult.suggested_analogies.length > 0 && (
              <div>
                <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '12px' }}>Suggested Analogies</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {draftResult.suggested_analogies.map((analogy, index) => (
                    <div
                      key={index}
                      style={{
                        padding: '10px',
                        background: 'rgba(17, 138, 178, 0.05)',
                        borderRadius: '6px',
                        border: '1px solid rgba(17, 138, 178, 0.2)',
                      }}
                    >
                      <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                        {analogy.label}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '4px' }}>
                        {analogy.description}
                      </div>
                      {analogy.target_concepts.length > 0 && (
                        <div style={{ fontSize: '11px', color: 'var(--accent)' }}>
                          For: {analogy.target_concepts.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
