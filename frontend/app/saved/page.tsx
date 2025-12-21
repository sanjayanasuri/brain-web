'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSavedItems, removeSavedItem, getSavedItemsByKind, type SavedItem, type SavedItemKind } from '../lib/savedItems';

export default function SavedPage() {
  const router = useRouter();
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [grouped, setGrouped] = useState<Record<SavedItemKind, SavedItem[]>>({
    SUGGESTION: [],
    PATH: [],
    CONCEPT: [],
  });

  useEffect(() => {
    const items = getSavedItems();
    setSavedItems(items);
    setGrouped(getSavedItemsByKind());
  }, []);

  const handleRemove = (id: string) => {
    removeSavedItem(id);
    const items = getSavedItems();
    setSavedItems(items);
    setGrouped(getSavedItemsByKind());
  };

  const handleOpen = async (item: SavedItem) => {
    if (item.kind === 'CONCEPT' && item.concept_id) {
      router.push(`/concepts/${item.concept_id}`);
    } else if (item.kind === 'PATH' && item.path_id) {
      // Navigate to explorer and start path
      const params = new URLSearchParams();
      if (item.graph_id) {
        params.set('graph_id', item.graph_id);
      }
      params.set('path', item.path_id);
      router.push(`/?${params.toString()}`);
    } else if (item.kind === 'SUGGESTION') {
      // Navigate based on suggestion type
      if (item.concept_id) {
        const params = new URLSearchParams();
        params.set('select', item.concept_id);
        if (item.graph_id) {
          params.set('graph_id', item.graph_id);
        }
        router.push(`/?${params.toString()}`);
      } else if (item.suggestion_id) {
        // Try to navigate to review or home
        router.push('/home');
      }
    }
  };

  const getKindLabel = (kind: SavedItemKind): string => {
    switch (kind) {
      case 'SUGGESTION':
        return 'Suggestions';
      case 'PATH':
        return 'Paths';
      case 'CONCEPT':
        return 'Concepts';
    }
  };

  if (savedItems.length === 0) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--background)',
        padding: '48px 24px',
      }}>
        <div style={{
          maxWidth: '800px',
          margin: '0 auto',
        }}>
          <h1 style={{
            fontSize: '28px',
            fontWeight: '600',
            marginBottom: '16px',
            color: 'var(--ink)',
          }}>
            Saved for later
          </h1>
          <div style={{
            padding: '48px 24px',
            textAlign: 'center',
            background: 'var(--surface)',
            borderRadius: '12px',
            border: '1px solid var(--border)',
          }}>
            <p style={{
              fontSize: '16px',
              color: 'var(--muted)',
              margin: 0,
            }}>
              No saved items yet. Use the bookmark icon (🔗) on suggestions, paths, or concepts to save them here.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--background)',
      padding: '48px 24px',
    }}>
      <div style={{
        maxWidth: '800px',
        margin: '0 auto',
      }}>
        <h1 style={{
          fontSize: '28px',
          fontWeight: '600',
          marginBottom: '24px',
          color: 'var(--ink)',
        }}>
          Saved for later
        </h1>

        {(Object.keys(grouped) as SavedItemKind[]).map((kind) => {
          const items = grouped[kind];
          if (items.length === 0) return null;

          return (
            <div key={kind} style={{
              marginBottom: '32px',
            }}>
              <h2 style={{
                fontSize: '13px',
                fontWeight: '600',
                marginBottom: '12px',
                color: 'var(--ink)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                {getKindLabel(kind)} ({items.length})
              </h2>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}>
                {items.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: '16px',
                      background: 'var(--surface)',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: '12px',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '15px',
                        fontWeight: '600',
                        marginBottom: '4px',
                        color: 'var(--ink)',
                      }}>
                        {item.title}
                      </div>
                      <div style={{
                        fontSize: '12px',
                        color: 'var(--muted)',
                      }}>
                        Saved {new Date(item.created_at).toLocaleDateString()}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button
                        onClick={() => handleOpen(item)}
                        style={{
                          padding: '6px 12px',
                          background: 'var(--accent)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}
                      >
                        Open
                      </button>
                      <button
                        onClick={() => handleRemove(item.id)}
                        style={{
                          padding: '6px 12px',
                          background: 'transparent',
                          color: 'var(--muted)',
                          border: '1px solid var(--border)',
                          borderRadius: '6px',
                          fontSize: '13px',
                          fontWeight: '500',
                          cursor: 'pointer',
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

