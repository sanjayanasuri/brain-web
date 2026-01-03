'use client';

import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Concept } from '../../api-client';

interface ConceptMentionListProps {
  items: Concept[];
  command: (item: Concept) => void;
}

export interface ConceptMentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const ConceptMentionList = forwardRef<ConceptMentionListRef, ConceptMentionListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => setSelectedIndex(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((index) => (index + items.length - 1) % items.length);
          return true;
        }

        if (event.key === 'ArrowDown') {
          setSelectedIndex((index) => (index + 1) % items.length);
          return true;
        }

        if (event.key === 'Enter') {
          selectItem(selectedIndex);
          return true;
        }

        return false;
      },
    }));

    const selectItem = (index: number) => {
      const item = items[index];
      if (item) {
        command(item);
      }
    };

    if (items.length === 0) {
      return null;
    }

    return (
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          boxShadow: 'var(--shadow)',
          maxHeight: '300px',
          overflow: 'auto',
          padding: '4px',
          position: 'relative',
          zIndex: 1000,
        }}
      >
        {items.map((item, index) => (
          <button
            key={item.node_id}
            onClick={() => selectItem(index)}
            style={{
              background: index === selectedIndex ? 'var(--accent)' : 'transparent',
              border: 'none',
              borderRadius: '4px',
              color: index === selectedIndex ? 'white' : 'var(--ink)',
              cursor: 'pointer',
              display: 'block',
              padding: '8px 12px',
              textAlign: 'left',
              width: '100%',
              fontSize: '14px',
            }}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            <div style={{ fontWeight: 500 }}>{item.name}</div>
            {item.domain && (
              <div
                style={{
                  fontSize: '12px',
                  opacity: 0.7,
                  marginTop: '2px',
                }}
              >
                {item.domain}
              </div>
            )}
          </button>
        ))}
      </div>
    );
  }
);

ConceptMentionList.displayName = 'ConceptMentionList';

