'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getConcept, type Concept } from '../../api-client';
import tippy, { Instance as TippyInstance } from 'tippy.js';
import 'tippy.js/dist/tippy.css';

interface ConceptMentionNodeProps {
  nodeId: string;
  label: string;
}

export function ConceptMentionNode({ nodeId, label }: ConceptMentionNodeProps) {
  const router = useRouter();
  const [concept, setConcept] = useState<Concept | null>(null);
  const [loading, setLoading] = useState(false);
  const elementRef = useRef<HTMLSpanElement>(null);
  const tippyInstanceRef = useRef<TippyInstance | null>(null);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (nodeId) {
      router.push(`/concepts/${nodeId}`);
    }
  };

  // Load concept data on hover
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    let hoverTimeout: NodeJS.Timeout;

    const showTooltip = async () => {
      hoverTimeout = setTimeout(async () => {
        if (!concept && !loading) {
          setLoading(true);
          try {
            const data = await getConcept(nodeId);
            setConcept(data);
          } catch (err) {
            console.error('Failed to load concept:', err);
          } finally {
            setLoading(false);
          }
        }

        if (concept && !tippyInstanceRef.current) {
          // Create tooltip content as HTML string
          const tooltipContent = document.createElement('div');
          tooltipContent.style.maxWidth = '300px';
          tooltipContent.style.padding = '8px';
          
          const nameDiv = document.createElement('div');
          nameDiv.style.fontWeight = '600';
          nameDiv.style.marginBottom = '4px';
          nameDiv.style.fontSize = '14px';
          nameDiv.textContent = concept.name;
          tooltipContent.appendChild(nameDiv);

          if (concept.domain) {
            const domainDiv = document.createElement('div');
            domainDiv.style.fontSize = '12px';
            domainDiv.style.color = 'var(--muted)';
            domainDiv.style.marginBottom = '4px';
            domainDiv.textContent = concept.domain;
            tooltipContent.appendChild(domainDiv);
          }

          if (concept.description) {
            const descDiv = document.createElement('div');
            descDiv.style.fontSize = '12px';
            descDiv.style.color = 'var(--ink)';
            descDiv.style.marginTop = '8px';
            descDiv.style.lineHeight = '1.4';
            descDiv.textContent = concept.description.length > 150
              ? `${concept.description.substring(0, 150)}...`
              : concept.description;
            tooltipContent.appendChild(descDiv);
          }

          if (concept.tags && concept.tags.length > 0) {
            const tagsDiv = document.createElement('div');
            tagsDiv.style.marginTop = '8px';
            tagsDiv.style.display = 'flex';
            tagsDiv.style.flexWrap = 'wrap';
            tagsDiv.style.gap = '4px';
            concept.tags.slice(0, 3).forEach((tag) => {
              const tagSpan = document.createElement('span');
              tagSpan.style.background = 'var(--panel)';
              tagSpan.style.border = '1px solid var(--border)';
              tagSpan.style.color = 'var(--accent)';
              tagSpan.style.fontSize = '10px';
              tagSpan.style.padding = '2px 6px';
              tagSpan.style.borderRadius = '4px';
              tagSpan.textContent = tag;
              tagsDiv.appendChild(tagSpan);
            });
            tooltipContent.appendChild(tagsDiv);
          }

          tippyInstanceRef.current = tippy(element, {
            content: tooltipContent,
            placement: 'top',
            delay: [300, 0],
            interactive: true,
            theme: 'light-border',
            appendTo: () => document.body,
          });
        }
      }, 300);
    };

    const hideTooltip = () => {
      clearTimeout(hoverTimeout);
      if (tippyInstanceRef.current) {
        tippyInstanceRef.current.destroy();
        tippyInstanceRef.current = null;
      }
    };

    element.addEventListener('mouseenter', showTooltip);
    element.addEventListener('mouseleave', hideTooltip);

    return () => {
      clearTimeout(hoverTimeout);
      element.removeEventListener('mouseenter', showTooltip);
      element.removeEventListener('mouseleave', hideTooltip);
      if (tippyInstanceRef.current) {
        tippyInstanceRef.current.destroy();
      }
    };
  }, [nodeId, concept, loading]);

  return (
    <span
      ref={elementRef}
      className="concept-mention"
      data-concept-id={nodeId}
      data-label={label}
      onClick={handleClick}
      style={{
                        background: 'var(--panel)',
                        border: '1px solid var(--border)',
        color: 'var(--accent)',
        padding: '2px 6px',
        borderRadius: '4px',
        fontWeight: 500,
        cursor: 'pointer',
        textDecoration: 'none',
        display: 'inline-block',
      }}
    >
      @{label || 'concept'}
    </span>
  );
}

