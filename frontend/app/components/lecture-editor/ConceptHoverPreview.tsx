'use client';

import { useEffect, useState, useRef } from 'react';
import { getConcept, type Concept } from '../../api-client';
import tippy, { Instance as TippyInstance } from 'tippy.js';
import 'tippy.js/dist/tippy.css';

export function useConceptHoverPreviews() {
  useEffect(() => {
    const handleMouseEnter = async (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.classList.contains('concept-hover-trigger')) {
        return;
      }

      const conceptId = target.getAttribute('data-concept-id');
      const conceptName = target.getAttribute('data-concept-name');

      if (!conceptId) return;

      // Check if tippy already exists
      if ((target as any)._tippy) {
        return;
      }

      // Show loading state
      const loadingContent = document.createElement('div');
      loadingContent.style.padding = '8px';
      loadingContent.style.fontSize = '13px';
      loadingContent.style.color = 'var(--muted)';
      loadingContent.textContent = 'Loading...';

      const tippyInstance = tippy(target as Element, {
        content: loadingContent,
        placement: 'top',
        delay: [300, 0],
        interactive: true,
        theme: 'light-border',
        appendTo: () => document.body,
        maxWidth: 350,
        onShow: (instance) => {
          // Wrap async work in IIFE - onShow callback must be synchronous
          void (async () => {
            try {
              const concept = await getConcept(conceptId);
              const content = createConceptPreview(concept);
              instance.setContent(content);
            } catch (error) {
              console.error('Failed to load concept:', error);
              const errorContent = document.createElement('div');
              errorContent.style.padding = '8px';
              errorContent.style.fontSize = '13px';
              errorContent.style.color = 'var(--accent-2)';
              errorContent.textContent = 'Failed to load concept';
              instance.setContent(errorContent);
            }
          })();
        },
      });

      (target as any)._tippy = tippyInstance;
    };

    const handleMouseLeave = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('concept-hover-trigger')) {
        // Tippy will handle hiding on its own
      }
    };

    document.addEventListener('mouseenter', handleMouseEnter, true);
    document.addEventListener('mouseleave', handleMouseLeave, true);

    return () => {
      document.removeEventListener('mouseenter', handleMouseEnter, true);
      document.removeEventListener('mouseleave', handleMouseLeave, true);
    };
  }, []);
}

function createConceptPreview(concept: Concept): HTMLElement {
  const container = document.createElement('div');
  container.style.maxWidth = '350px';
  container.style.padding = '12px';

  // Title
  const title = document.createElement('div');
  title.style.fontSize = '16px';
  title.style.fontWeight = '600';
  title.style.color = 'var(--ink)';
  title.style.marginBottom = '8px';
  title.style.lineHeight = '1.3';
  title.textContent = concept.name;
  container.appendChild(title);

  // Domain
  if (concept.domain) {
    const domain = document.createElement('div');
    domain.style.fontSize = '12px';
    domain.style.color = 'var(--muted)';
    domain.style.marginBottom = '8px';
    domain.textContent = concept.domain;
    container.appendChild(domain);
  }

  // Description
  if (concept.description) {
    const description = document.createElement('div');
    description.style.fontSize = '13px';
    description.style.color = 'var(--ink)';
    description.style.lineHeight = '1.5';
    description.style.marginTop = '8px';
    const descText = concept.description.length > 200
      ? `${concept.description.substring(0, 200)}...`
      : concept.description;
    description.textContent = descText;
    container.appendChild(description);
  }

  // Tags
  if (concept.tags && concept.tags.length > 0) {
    const tagsContainer = document.createElement('div');
    tagsContainer.style.marginTop = '12px';
    tagsContainer.style.display = 'flex';
    tagsContainer.style.flexWrap = 'wrap';
    tagsContainer.style.gap = '4px';

    concept.tags.slice(0, 5).forEach((tag) => {
      const tagElement = document.createElement('span');
      tagElement.style.background = 'rgba(17, 138, 178, 0.1)';
      tagElement.style.color = 'var(--accent)';
      tagElement.style.fontSize = '11px';
      tagElement.style.padding = '2px 6px';
      tagElement.style.borderRadius = '4px';
      tagElement.textContent = tag;
      tagsContainer.appendChild(tagElement);
    });

    container.appendChild(tagsContainer);
  }

  // Click to view link
  const link = document.createElement('a');
  link.href = `/concepts/${concept.node_id}`;
  link.style.display = 'block';
  link.style.marginTop = '12px';
  link.style.paddingTop = '12px';
  link.style.borderTop = '1px solid var(--border)';
  link.style.fontSize = '12px';
  link.style.color = 'var(--accent)';
  link.style.textDecoration = 'none';
  link.style.cursor = 'pointer';
  link.textContent = 'View concept →';
  link.onclick = (e) => {
    e.preventDefault();
    window.open(`/concepts/${concept.node_id}`, '_blank');
  };
  container.appendChild(link);

  return container;
}

