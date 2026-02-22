'use client';

import MarkdownIt from 'markdown-it';
import { useMemo } from 'react';

export interface FreeformCaptureResult {
  lecture_id: string;
  nodes_created: Array<{ node_id?: string; name?: string }>;
  nodes_updated?: Array<{ node_id?: string; name?: string }>;
  links_created: Array<{ source_id?: string; target_id?: string; predicate?: string }>;
  transcript: string;
  run_id: string;
}

interface CaptureModalProps {
  status: 'idle' | 'loading' | 'success' | 'error';
  result: FreeformCaptureResult | null;
  errorMessage?: string | null;
  onClose: () => void;
  onOpenGraph: () => void;
  onOpenLecture: () => void;
  onPolish?: () => void;
}

const md = new MarkdownIt({ linkify: true, breaks: true });

export default function CaptureModal({
  status,
  result,
  errorMessage,
  onClose,
  onOpenGraph,
  onOpenLecture,
  onPolish,
}: CaptureModalProps) {
  if (status === 'idle') return null;

  const transcriptHtml = useMemo(
    () => (result?.transcript ? md.render(result.transcript) : ''),
    [result?.transcript],
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 80,
        background: 'rgba(15,23,42,0.28)',
        backdropFilter: 'blur(8px)',
        display: 'grid',
        placeItems: 'center',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && status !== 'loading') onClose();
      }}
    >
      <div
        style={{
          width: 'min(900px, 96vw)',
          maxHeight: '88vh',
          overflow: 'auto',
          background: 'var(--surface)',
          color: 'var(--ink)',
          border: '1px solid var(--border)',
          borderRadius: 20,
          boxShadow: '0 32px 80px rgba(0,0,0,0.18)',
          padding: 18,
          display: 'grid',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18 }}>
              {status === 'loading' ? 'Analyzing your canvas…' : status === 'error' ? 'Capture failed' : 'Capture results'}
            </div>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              {status === 'loading'
                ? 'Geometric parsing + graph extraction in progress'
                : status === 'success'
                  ? `Run ${result?.run_id ?? ''}`
                  : 'The backend could not finish the capture'}
            </div>
          </div>
          {status !== 'loading' && (
            <button
              onClick={onClose}
              style={{
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--muted)',
                width: 34,
                height: 34,
                borderRadius: 12,
                cursor: 'pointer',
                fontWeight: 700,
              }}
              aria-label="Close capture modal"
            >
              ×
            </button>
          )}
        </div>

        {status === 'loading' && (
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              gap: 12,
              minHeight: 180,
              borderRadius: 16,
              border: '1px dashed var(--border)',
              background:
                'radial-gradient(circle at center, rgba(37,99,235,0.08), rgba(37,99,235,0.02) 55%, transparent 70%)',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: '50%',
                border: '3px solid rgba(37,99,235,0.18)',
                borderTopColor: 'var(--accent)',
                animation: 'spin 1s linear infinite',
              }}
            />
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>
              Detecting enclosures/arrows, then extracting concepts + links…
            </div>
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {status === 'error' && (
          <div
            style={{
              borderRadius: 14,
              border: '1px solid rgba(220,38,38,0.18)',
              background: 'rgba(220,38,38,0.05)',
              padding: 12,
              color: '#b91c1c',
              fontSize: 14,
            }}
          >
            {errorMessage || 'Capture failed unexpectedly.'}
          </div>
        )}

        {status === 'success' && result && (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 10,
              }}
            >
              <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 10, background: 'rgba(255,255,255,0.45)' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Concepts created</div>
                <div style={{ fontWeight: 800, fontSize: 20 }}>{result.nodes_created?.length || 0}</div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 10, background: 'rgba(255,255,255,0.45)' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Links created</div>
                <div style={{ fontWeight: 800, fontSize: 20 }}>{result.links_created?.length || 0}</div>
              </div>
              <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 10, background: 'rgba(255,255,255,0.45)' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>Lecture ID</div>
                <div style={{ fontWeight: 700, fontSize: 13, wordBreak: 'break-all' }}>{result.lecture_id}</div>
              </div>
            </div>

            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 16,
                padding: 14,
                background: 'rgba(255,255,255,0.5)',
                maxHeight: '44vh',
                overflow: 'auto',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Transcript</div>
              <div
                className="freeform-capture-markdown"
                dangerouslySetInnerHTML={{ __html: transcriptHtml }}
                style={{ color: 'var(--ink)', fontSize: 14, lineHeight: 1.55 }}
              />
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
              {onPolish && (
                <button
                  onClick={onPolish}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    color: 'var(--ink)',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Polish
                </button>
              )}
              <button
                onClick={onOpenGraph}
                style={{
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Open in Knowledge Graph
              </button>
              <button
                onClick={onOpenLecture}
                style={{
                  padding: '10px 14px',
                  borderRadius: 12,
                  border: 'none',
                  background: 'var(--accent)',
                  color: 'white',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                Open in Lecture Editor
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
