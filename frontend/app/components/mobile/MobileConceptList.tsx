'use client';

import { type Concept } from '../../api-client';

interface MobileConceptListProps {
  concepts: Concept[];
  onSelectConcept: (conceptId: string) => void;
  isLoading?: boolean;
}

export default function MobileConceptList({
  concepts,
  onSelectConcept,
  isLoading,
}: MobileConceptListProps) {
  if (isLoading && concepts.length === 0) {
    return (
      <div style={{ padding: '32px', textAlign: 'center', color: '#6b7280' }}>
        Loading...
      </div>
    );
  }

  if (concepts.length === 0) {
    return (
      <div style={{ 
        padding: '48px 24px', 
        textAlign: 'center',
        color: '#9ca3af',
      }}>
        <div style={{ fontSize: '48px', marginBottom: '16px' }}>🧠</div>
        <div style={{ fontSize: '18px', fontWeight: '500', marginBottom: '8px', color: '#6b7280' }}>
          Start Building Your Knowledge Graph
        </div>
        <div style={{ fontSize: '14px', color: '#9ca3af' }}>
          Tap the + button to add your first concept
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px', paddingBottom: '100px' }}>
      <div style={{ 
        marginBottom: '16px',
        fontSize: '14px',
        color: '#6b7280',
        fontWeight: '500',
      }}>
        {concepts.length} {concepts.length === 1 ? 'concept' : 'concepts'}
      </div>
      
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {concepts.map((concept) => (
          <div
            key={concept.node_id}
            onClick={() => onSelectConcept(concept.node_id)}
            style={{
              background: 'white',
              borderRadius: '12px',
              padding: '16px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              transition: 'transform 0.1s, box-shadow 0.1s',
            }}
            onTouchStart={(e) => {
              e.currentTarget.style.transform = 'scale(0.98)';
              e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
            }}
            onTouchEnd={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            }}
          >
            <div style={{ 
              fontSize: '18px', 
              fontWeight: '600', 
              marginBottom: '8px',
              color: '#111827',
            }}>
              {concept.name}
            </div>
            
            {concept.description && (
              <div style={{ 
                fontSize: '14px', 
                color: '#6b7280',
                marginBottom: '8px',
                lineHeight: '1.5',
              }}>
                {concept.description}
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {concept.domain && (
                <span style={{
                  fontSize: '12px',
                  padding: '4px 8px',
                  background: '#eff6ff',
                  color: '#2563eb',
                  borderRadius: '6px',
                  fontWeight: '500',
                }}>
                  {concept.domain}
                </span>
              )}
              {concept.type && (
                <span style={{
                  fontSize: '12px',
                  padding: '4px 8px',
                  background: '#f3f4f6',
                  color: '#6b7280',
                  borderRadius: '6px',
                }}>
                  {concept.type}
                </span>
              )}
              {concept.url_slug && (
                <span style={{
                  fontSize: '12px',
                  padding: '4px 8px',
                  background: '#f0fdf4',
                  color: '#16a34a',
                  borderRadius: '6px',
                }}>
                  🔗 Link
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

