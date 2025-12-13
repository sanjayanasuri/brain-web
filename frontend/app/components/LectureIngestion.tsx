'use client';

import { useState } from 'react';
import { ingestLecture, getAllGraphData, type LectureIngestResult } from '../api-client';

interface LectureIngestionProps {
  onIngestComplete?: (result: LectureIngestResult) => void;
  onReloadGraph?: () => void;
}

export default function LectureIngestion({ onIngestComplete, onReloadGraph }: LectureIngestionProps) {
  const [lectureTitle, setLectureTitle] = useState('');
  const [lectureText, setLectureText] = useState('');
  const [domain, setDomain] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LectureIngestResult | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const payload = {
        lecture_title: lectureTitle,
        lecture_text: lectureText,
        domain: domain || undefined,
      };

      const ingestResult = await ingestLecture(payload);
      setResult(ingestResult);

      // Call callbacks
      if (onIngestComplete) {
        onIngestComplete(ingestResult);
      }

      // Reload graph data
      if (onReloadGraph) {
        onReloadGraph();
      } else {
        // Fallback: reload graph data and refresh page
        await getAllGraphData();
        // Small delay to ensure backend has processed
        setTimeout(() => {
          window.location.reload();
        }, 500);
      }

      // Clear form on success
      setLectureTitle('');
      setLectureText('');
      setDomain('');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to ingest lecture';
      setError(errorMessage);
      console.error('Lecture ingestion error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="lecture-ingestion-panel" style={{
      position: 'fixed',
      top: '20px',
      right: '20px',
      width: isExpanded ? '500px' : '300px',
      backgroundColor: 'white',
      border: '1px solid #ccc',
      borderRadius: '8px',
      padding: '16px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      zIndex: 1000,
      maxHeight: '90vh',
      overflow: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>Lecture Ingestion</h3>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          style={{
            background: 'none',
            border: '1px solid #ccc',
            borderRadius: '4px',
            padding: '4px 8px',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          {isExpanded ? '−' : '+'}
        </button>
      </div>

      {isExpanded && (
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '500' }}>
              Lecture Title
            </label>
            <input
              type="text"
              value={lectureTitle}
              onChange={(e) => setLectureTitle(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ccc',
                borderRadius: '4px',
                fontSize: '14px',
              }}
              placeholder="e.g., Intro to Software Engineering"
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '500' }}>
              Domain (optional)
            </label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ccc',
                borderRadius: '4px',
                fontSize: '14px',
              }}
              placeholder="e.g., Software Engineering"
            />
          </div>

          <div style={{ marginBottom: '12px' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', fontWeight: '500' }}>
              Lecture Text
            </label>
            <textarea
              value={lectureText}
              onChange={(e) => setLectureText(e.target.value)}
              required
              rows={8}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ccc',
                borderRadius: '4px',
                fontSize: '14px',
                fontFamily: 'inherit',
                resize: 'vertical',
              }}
              placeholder="Paste your lecture text here..."
            />
          </div>

          {error && (
            <div style={{
              marginBottom: '12px',
              padding: '8px',
              backgroundColor: '#fee',
              border: '1px solid #fcc',
              borderRadius: '4px',
              color: '#c00',
              fontSize: '13px',
            }}>
              Error: {error}
            </div>
          )}

          {result && (
            <div style={{
              marginBottom: '12px',
              padding: '8px',
              backgroundColor: '#efe',
              border: '1px solid #cfc',
              borderRadius: '4px',
              fontSize: '13px',
            }}>
              <div style={{ fontWeight: '600', marginBottom: '4px' }}>✓ Ingestion Complete</div>
              <div>Created: {result.nodes_created.length} nodes</div>
              <div>Updated: {result.nodes_updated.length} nodes</div>
              <div>Links: {result.links_created.length} relationships</div>
              <div>Segments: {result.segments?.length || 0} segments</div>
              {result.lecture_id && (
                <div style={{ marginTop: '8px', fontSize: '11px', color: '#666' }}>
                  Lecture ID: {result.lecture_id}
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !lectureTitle || !lectureText}
            style={{
              width: '100%',
              padding: '10px',
              backgroundColor: isLoading ? '#ccc' : '#0070f3',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '14px',
              fontWeight: '500',
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}
          >
            {isLoading ? 'Processing...' : 'Ingest Lecture'}
          </button>
        </form>
      )}
    </div>
  );
}
