'use client';

import { useEffect } from 'react';
import { type Concept } from '../../api-client';

interface MobileConceptDetailProps {
  concept: Concept;
  onClose: () => void;
}

export default function MobileConceptDetail({ concept, onClose }: MobileConceptDetailProps) {
  // Close on swipe down or outside click
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'flex-end',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderTopLeftRadius: '20px',
          borderTopRightRadius: '20px',
          width: '100%',
          maxHeight: '80vh',
          padding: '24px',
          paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',
          overflowY: 'auto',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.2)',
        }}
      >
        {/* Drag handle */}
        <div
          style={{
            width: '40px',
            height: '4px',
            background: '#d1d5db',
            borderRadius: '2px',
            margin: '0 auto 20px',
          }}
        />

        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '20px',
            right: '20px',
            background: '#f3f4f6',
            border: 'none',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            fontSize: '20px',
          }}
        >
          ✕
        </button>

        {/* Concept details */}
        <div style={{ marginBottom: '24px' }}>
          <h2 style={{
            fontSize: '24px',
            fontWeight: '700',
            marginBottom: '8px',
            color: '#111827',
            paddingRight: '40px',
          }}>
            {concept.name}
          </h2>
          
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
            {concept.domain && (
              <span style={{
                fontSize: '13px',
                padding: '6px 12px',
                background: '#eff6ff',
                color: '#2563eb',
                borderRadius: '8px',
                fontWeight: '500',
              }}>
                {concept.domain}
              </span>
            )}
            {concept.type && (
              <span style={{
                fontSize: '13px',
                padding: '6px 12px',
                background: '#f3f4f6',
                color: '#6b7280',
                borderRadius: '8px',
              }}>
                {concept.type}
              </span>
            )}
          </div>
        </div>

        {concept.description && (
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{
              fontSize: '14px',
              fontWeight: '600',
              marginBottom: '8px',
              color: '#374151',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              Description
            </h3>
            <p style={{
              fontSize: '15px',
              color: '#6b7280',
              lineHeight: '1.6',
            }}>
              {concept.description}
            </p>
          </div>
        )}

        {concept.url_slug && (
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{
              fontSize: '14px',
              fontWeight: '600',
              marginBottom: '8px',
              color: '#374151',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              Link
            </h3>
            <a
              href={concept.url_slug}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: '15px',
                color: '#3b82f6',
                textDecoration: 'none',
                wordBreak: 'break-all',
                display: 'block',
                padding: '12px',
                background: '#f0f9ff',
                borderRadius: '8px',
              }}
            >
              {concept.url_slug}
            </a>
          </div>
        )}

        {concept.tags && concept.tags.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{
              fontSize: '14px',
              fontWeight: '600',
              marginBottom: '8px',
              color: '#374151',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              Tags
            </h3>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {concept.tags.map((tag, idx) => (
                <span
                  key={idx}
                  style={{
                    fontSize: '13px',
                    padding: '6px 12px',
                    background: '#f3f4f6',
                    color: '#6b7280',
                    borderRadius: '8px',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        <div style={{
          padding: '16px',
          background: '#f9fafb',
          borderRadius: '12px',
          fontSize: '13px',
          color: '#6b7280',
        }}>
          <div style={{ marginBottom: '4px' }}>
            <strong>Node ID:</strong> {concept.node_id}
          </div>
          {concept.created_by && (
            <div>
              <strong>Created by:</strong> {concept.created_by}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

