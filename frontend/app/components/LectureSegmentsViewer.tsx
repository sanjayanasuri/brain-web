'use client';

import { useState } from 'react';
import { getLectureSegments, type LectureSegment } from '../api-client';

export default function LectureSegmentsViewer() {
  const [lectureId, setLectureId] = useState('');
  const [segments, setSegments] = useState<LectureSegment[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFetch = async () => {
    if (!lectureId.trim()) {
      setError('Please enter a lecture ID');
      return;
    }

    setIsLoading(true);
    setError(null);
    setSegments(null);

    try {
      const fetchedSegments = await getLectureSegments(lectureId);
      setSegments(fetchedSegments);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch segments';
      setError(errorMessage);
      console.error('Error fetching segments:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      width: '600px',
      maxHeight: '80vh',
      backgroundColor: 'white',
      border: '1px solid #ccc',
      borderRadius: '8px',
      padding: '16px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
      zIndex: 1000,
      overflow: 'auto',
    }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600' }}>
        View Lecture Segments
      </h3>

      <div style={{ marginBottom: '12px', display: 'flex', gap: '8px' }}>
        <input
          type="text"
          value={lectureId}
          onChange={(e) => setLectureId(e.target.value)}
          placeholder="Enter lecture ID (e.g., LECTURE_ABC12345)"
          style={{
            flex: 1,
            padding: '8px',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '14px',
          }}
          onKeyPress={(e) => e.key === 'Enter' && handleFetch()}
        />
        <button
          onClick={handleFetch}
          disabled={isLoading}
          style={{
            padding: '8px 16px',
            backgroundColor: isLoading ? '#ccc' : '#0070f3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: '500',
            cursor: isLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {isLoading ? 'Loading...' : 'Fetch'}
        </button>
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

      {segments && (
        <div>
          <div style={{ marginBottom: '12px', fontSize: '14px', fontWeight: '500' }}>
            Found {segments.length} segment{segments.length !== 1 ? 's' : ''}
          </div>

          {segments.map((segment, idx) => (
            <div
              key={segment.segment_id}
              style={{
                marginBottom: '16px',
                padding: '12px',
                border: '1px solid #ddd',
                borderRadius: '4px',
                backgroundColor: '#f9f9f9',
              }}
            >
              {segment.lecture_title && (
                <div style={{ fontSize: '12px', fontWeight: '600', color: '#666', marginBottom: '8px', paddingBottom: '8px', borderBottom: '1px solid #f0f0f0' }}>
                  📄 {segment.lecture_title}
                </div>
              )}
              <div style={{ fontWeight: '600', marginBottom: '8px', fontSize: '14px' }}>
                Segment {segment.segment_index + 1}
              </div>

              {segment.summary && (
                <div style={{ marginBottom: '8px', fontSize: '13px', color: '#666', fontStyle: 'italic' }}>
                  {segment.summary}
                </div>
              )}

              <div style={{ marginBottom: '8px', fontSize: '13px', color: '#333' }}>
                <strong>Text:</strong> {segment.text.substring(0, 200)}
                {segment.text.length > 200 && '...'}
              </div>

              {segment.style_tags && segment.style_tags.length > 0 && (
                <div style={{ marginBottom: '8px', fontSize: '12px' }}>
                  <strong>Style:</strong>{' '}
                  {segment.style_tags.map((tag, i) => (
                    <span key={i} style={{
                      display: 'inline-block',
                      marginRight: '4px',
                      padding: '2px 6px',
                      backgroundColor: '#e0e0e0',
                      borderRadius: '3px',
                      fontSize: '11px',
                    }}>
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {segment.covered_concepts.length > 0 && (
                <div style={{ marginBottom: '8px', fontSize: '12px' }}>
                  <strong>Concepts:</strong>{' '}
                  {segment.covered_concepts.map((c, i) => (
                    <span key={c.node_id} style={{ marginRight: '8px', color: '#0070f3' }}>
                      {c.name}
                      {i < segment.covered_concepts.length - 1 && ','}
                    </span>
                  ))}
                </div>
              )}

              {segment.analogies.length > 0 && (
                <div style={{ fontSize: '12px' }}>
                  <strong>Analogies:</strong>{' '}
                  {segment.analogies.map((a, i) => (
                    <span key={a.analogy_id} style={{ marginRight: '8px', color: '#28a745' }}>
                      &quot;{a.label}&quot;
                      {i < segment.analogies.length - 1 && ', '}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
