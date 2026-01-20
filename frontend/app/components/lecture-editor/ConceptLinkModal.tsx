'use client';

import { useEffect, useMemo, useState } from 'react';
import { createConcept, searchConcepts, type Concept } from '../../api-client';

interface ConceptLinkModalProps {
  isOpen: boolean;
  selectionText: string;
  graphId?: string;
  onClose: () => void;
  onLink: (concept: Concept, contextNote?: string) => void;
}

export function ConceptLinkModal({
  isOpen,
  selectionText,
  graphId,
  onClose,
  onLink,
}: ConceptLinkModalProps) {
  const [query, setQuery] = useState(selectionText);
  const [results, setResults] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(false);
  const [contextNote, setContextNote] = useState('');
  const [newDomain, setNewDomain] = useState('General');
  const [newType, setNewType] = useState('concept');
  const [error, setError] = useState<string | null>(null);

  const trimmedQuery = useMemo(() => query.trim(), [query]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setQuery(selectionText);
    setContextNote('');
    setError(null);
  }, [isOpen, selectionText]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (!trimmedQuery) {
      setResults([]);
      return;
    }

    let isActive = true;
    setLoading(true);

    const timeout = setTimeout(async () => {
      try {
        const res = await searchConcepts(trimmedQuery, graphId, 8);
        if (isActive) {
          setResults(res.results || []);
        }
      } catch (err) {
        if (isActive) {
          setResults([]);
          setError(err instanceof Error ? err.message : 'Failed to search concepts');
        }
      } finally {
        if (isActive) {
          setLoading(false);
        }
      }
    }, 250);

    return () => {
      isActive = false;
      clearTimeout(timeout);
    };
  }, [trimmedQuery, graphId, isOpen]);

  if (!isOpen) {
    return null;
  }

  const handleCreate = async () => {
    const name = trimmedQuery || selectionText;
    if (!name) {
      setError('Enter a concept name first.');
      return;
    }

    try {
      setLoading(true);
      const created = await createConcept({
        name,
        domain: newDomain || 'General',
        type: newType || 'concept',
        graph_id: graphId || null,
      });
      onLink(created, contextNote);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create concept');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10, 12, 18, 0.55)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '520px',
          background: 'var(--surface)',
          borderRadius: '12px',
          border: '1px solid var(--border)',
          boxShadow: 'var(--shadow)',
          padding: '20px',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--ink)' }}>Link to Concept</div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--muted)',
              cursor: 'pointer',
              fontSize: '18px',
            }}
            aria-label="Close"
          >
            x
          </button>
        </div>

        <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: '6px' }}>
          Search or create
        </label>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Start typing..."
          autoFocus
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            background: 'var(--panel)',
            color: 'var(--ink)',
            marginBottom: '12px',
          }}
        />

        {loading && <div style={{ fontSize: '12px', color: 'var(--muted)' }}>Searching...</div>}
        {!loading && results.length > 0 && (
          <div style={{ marginBottom: '12px' }}>
            {results.map((item) => (
              <button
                key={item.node_id}
                onClick={() => onLink(item, contextNote)}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  background: 'var(--panel)',
                  color: 'var(--ink)',
                  marginBottom: '8px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 600 }}>{item.name}</div>
                <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{item.domain}</div>
              </button>
            ))}
          </div>
        )}
        {!loading && results.length === 0 && trimmedQuery && (
          <div style={{ marginBottom: '12px', fontSize: '12px', color: 'var(--muted)' }}>
            No matching concepts yet. Create a new one below.
          </div>
        )}

        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', fontSize: '12px', color: 'var(--muted)', marginBottom: '6px' }}>
            Context note (optional)
          </label>
          <textarea
            value={contextNote}
            onChange={(event) => setContextNote(event.target.value)}
            placeholder="Meaning in this context..."
            rows={3}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              background: 'var(--panel)',
              color: 'var(--ink)',
              resize: 'vertical',
            }}
          />
        </div>

        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '6px' }}>Create new concept</div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
            <input
              value={newDomain}
              onChange={(event) => setNewDomain(event.target.value)}
              placeholder="Domain"
              style={{
                flex: 1,
                padding: '8px 10px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                background: 'var(--panel)',
                color: 'var(--ink)',
              }}
            />
            <select
              value={newType}
              onChange={(event) => setNewType(event.target.value)}
              style={{
                width: '140px',
                padding: '8px 10px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                background: 'var(--panel)',
                color: 'var(--ink)',
              }}
            >
              <option value="concept">Concept</option>
              <option value="person">Person</option>
              <option value="place">Place</option>
              <option value="organization">Organization</option>
            </select>
          </div>
          <button
            onClick={handleCreate}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: '8px',
              border: '1px solid var(--accent)',
              background: 'var(--accent)',
              color: 'white',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Create and Link
          </button>
        </div>

        {error && <div style={{ color: 'var(--accent-2)', fontSize: '12px' }}>{error}</div>}
      </div>
    </div>
  );
}
