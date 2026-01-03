'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import TextStyle from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { Underline } from '@tiptap/extension-underline';
import { FontFamily } from '@tiptap/extension-font-family';
import { useEffect, useState } from 'react';
import tippy from 'tippy.js';
import { ConceptMention } from './ConceptMention';
import { CodeBlock } from './CodeBlock';
import { ConceptHover } from './ConceptHover';
import { searchConcepts, getAllGraphData, type Concept } from '../../api-client';
import { FloatingToolbar } from './FloatingToolbar';
import 'tippy.js/dist/tippy.css';

interface LectureEditorProps {
  content: string;
  onUpdate: (content: string) => void;
  placeholder?: string;
  graphId?: string;
}

export function LectureEditor({
  content,
  onUpdate,
  placeholder = 'Start writing your lecture...',
  graphId,
  onEditorReady,
}: LectureEditorProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [conceptMap, setConceptMap] = useState<Map<string, Concept>>(new Map());

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Load all concepts for hover detection
  useEffect(() => {
    async function loadConcepts() {
      try {
        // If graphId is provided, set it as active graph context first
        if (graphId) {
          const { selectGraph } = await import('../../api-client');
          try {
            await selectGraph(graphId);
            console.log(`[LectureEditor] Set active graph to: ${graphId}`);
          } catch (err) {
            console.warn(`[LectureEditor] Failed to set active graph to ${graphId}:`, err);
            // Continue anyway - backend might use default graph
          }
        }

        // Load concepts from the backend knowledge graph
        const graphData = await getAllGraphData();
        console.log(`[LectureEditor] Loaded ${graphData.nodes.length} concepts from backend graph`);
        
        const concepts = new Map<string, Concept>();
        
        graphData.nodes.forEach((node: Concept) => {
          // Map by name (case-insensitive)
          const nameLower = node.name.toLowerCase();
          if (!concepts.has(nameLower)) {
            concepts.set(nameLower, node);
          }
          // Also map by exact name
          concepts.set(node.name, node);
        });
        
        console.log(`[LectureEditor] Mapped ${concepts.size} unique concept names for hover detection`);
        setConceptMap(concepts);
      } catch (error) {
        console.error('[LectureEditor] Failed to load concepts for hover:', error);
        // Set empty map on error to prevent infinite retries
        setConceptMap(new Map());
      }
    }

    loadConcepts();
  }, [graphId]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: true,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
        codeBlock: false, // Disable default code block, use our custom one
      }),
      CodeBlock,
      TextStyle,
      Color,
      Highlight.configure({
        multicolor: true,
      }),
      Underline,
      FontFamily.configure({
        types: ['textStyle'],
      }),
      Image.configure({
        inline: true,
        allowBase64: true,
        HTMLAttributes: {
          class: 'lecture-image',
        },
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'lecture-link',
        },
      }),
      Placeholder.configure({
        placeholder,
      }),
      ...(isMounted
        ? [
            ConceptMention.configure({
              onSearch: async (query: string) => {
                if (!query || query.length < 1) {
                  return [];
                }
                try {
                  const result = await searchConcepts(query, graphId, 10);
                  return result.results;
                } catch (error) {
                  console.error('Failed to search concepts:', error);
                  return [];
                }
              },
            }),
          ]
        : []),
      ConceptHover.configure({
        conceptNames: conceptMap,
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onUpdate(html);
    },
    editorProps: {
      attributes: {
        class: 'lecture-editor-content',
        style: 'min-height: 500px; outline: none;',
        spellcheck: 'true',
      },
      handlePaste: (view, event, slice) => {
        const items = Array.from(event.clipboardData?.items || []);
        for (const item of items) {
          if (item.type.indexOf('image') !== -1) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) {
              const reader = new FileReader();
              reader.onload = (e) => {
                const src = e.target?.result as string;
                if (src) {
                  editor.chain().focus().setImage({ src }).run();
                }
              };
              reader.readAsDataURL(file);
            }
            return true;
          }
        }
        return false;
      },
      handleDrop: (view, event, slice, moved) => {
        if (!moved && event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]) {
          const file = event.dataTransfer.files[0];
          if (file.type.indexOf('image') !== -1) {
            event.preventDefault();
            const reader = new FileReader();
            reader.onload = (e) => {
              const src = e.target?.result as string;
              if (src) {
                const coordinates = view.posAtCoords({
                  left: event.clientX,
                  top: event.clientY,
                });
                if (coordinates) {
                  editor.chain().focus().setImage({ src }).setTextSelection(coordinates.pos).run();
                }
              }
            };
            reader.readAsDataURL(file);
            return true;
          }
        }
        return false;
      },
    },
  });

  // Update editor content when prop changes (but not on every keystroke)
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, false);
    }
  }, [content, editor]);

  // Notify parent when editor is ready
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // Update concept map in extension when it changes
  useEffect(() => {
    if (!editor) {
      console.log('[LectureEditor] Editor not ready yet');
      return;
    }
    
    if (conceptMap.size === 0) {
      console.log('[LectureEditor] Concept map is empty - no concepts loaded yet');
      return;
    }
    
    console.log(`[LectureEditor] Updating concept hover extension with ${conceptMap.size} concepts`);
    
    // Update extension options
    const extension = editor.extensionManager.extensions.find(ext => ext.name === 'conceptHover');
    if (extension) {
      extension.options.conceptNames = conceptMap;
      console.log('[LectureEditor] Extension options updated, triggering re-evaluation');
      
      // Trigger a transaction to force plugin re-evaluation
      const { state, dispatch } = editor.view;
      const tr = state.tr.setMeta('forceConceptHoverUpdate', true);
      dispatch(tr);
    } else {
      console.warn('[LectureEditor] ConceptHover extension not found!');
    }
  }, [editor, conceptMap]);

  // Set up concept hover previews when editor is ready
  useEffect(() => {
    if (!editor) {
      console.log('[LectureEditor] Editor not ready for tippy setup');
      return;
    }
    
    if (conceptMap.size === 0) {
      console.log('[LectureEditor] Concept map empty, skipping tippy setup');
      return;
    }

    console.log(`[LectureEditor] Setting up tippy instances for concept hover (${conceptMap.size} concepts available)`);

    const setupTippyForElement = (target: HTMLElement) => {
      const conceptId = target.getAttribute('data-concept-id');
      const conceptName = target.getAttribute('data-concept-name');
      
      if (!conceptId) {
        console.warn('[LectureEditor] Element missing data-concept-id:', target);
        return;
      }
      
      if ((target as any)._tippy) {
        // Already has tippy instance
        return;
      }
      
      console.log(`[LectureEditor] Setting up tippy for concept: ${conceptName} (${conceptId})`);

      const loadingContent = document.createElement('div');
      loadingContent.style.padding = '16px';
      loadingContent.style.fontSize = '14px';
      loadingContent.style.color = 'var(--muted)';
      loadingContent.style.textAlign = 'center';
      loadingContent.textContent = 'Loading...';

      const tippyInstance = tippy(target, {
        content: loadingContent,
        placement: 'top',
        delay: [300, 0],
        interactive: true,
        trigger: 'mouseenter',
        theme: 'light-border',
        appendTo: () => document.body,
        maxWidth: 420,
        offset: [0, 8],
        onShow: async () => {
          try {
            const { getConcept } = await import('../../api-client');
            const concept = await getConcept(conceptId);
            
            // Use the graphId prop if available, otherwise try to get it from graph data
            let currentGraphId: string | undefined = graphId;
            if (!currentGraphId) {
              try {
                const { getAllGraphData } = await import('../../api-client');
                const graphData = await getAllGraphData();
                currentGraphId = graphData.graph_id;
              } catch (err) {
                // Ignore if we can't get graph data
              }
            }
            
            const container = document.createElement('div');
            container.style.maxWidth = '420px';
            container.style.padding = '0';
            container.style.background = 'var(--surface)';
            container.style.borderRadius = '8px';
            container.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';

            // Header section
            const header = document.createElement('div');
            header.style.padding = '16px';
            header.style.borderBottom = '1px solid var(--border)';
            header.style.background = 'var(--panel)';
            header.style.borderRadius = '8px 8px 0 0';

            const title = document.createElement('div');
            title.style.fontSize = '18px';
            title.style.fontWeight = 600;
            title.style.color = 'var(--ink)';
            title.style.marginBottom = '4px';
            title.style.lineHeight = '1.3';
            title.textContent = concept.name;
            header.appendChild(title);

            if (concept.domain) {
              const domain = document.createElement('div');
              domain.style.fontSize = '12px';
              domain.style.color = 'var(--muted)';
              domain.style.textTransform = 'uppercase';
              domain.style.letterSpacing = '0.5px';
              domain.textContent = concept.domain;
              header.appendChild(domain);
            }
            container.appendChild(header);

            // Content section
            const content = document.createElement('div');
            content.style.padding = '16px';

            if (concept.description) {
              const desc = document.createElement('div');
              desc.style.fontSize = '14px';
              desc.style.color = 'var(--ink)';
              desc.style.lineHeight = '1.6';
              desc.style.marginBottom = '12px';
              desc.textContent = concept.description.length > 250
                ? `${concept.description.substring(0, 250)}...`
                : concept.description;
              content.appendChild(desc);
            } else {
              const noDesc = document.createElement('div');
              noDesc.style.fontSize = '13px';
              noDesc.style.color = 'var(--muted)';
              noDesc.style.fontStyle = 'italic';
              noDesc.style.marginBottom = '12px';
              noDesc.textContent = 'No description available';
              content.appendChild(noDesc);
            }

            if (concept.tags && concept.tags.length > 0) {
              const tagsContainer = document.createElement('div');
              tagsContainer.style.display = 'flex';
              tagsContainer.style.flexWrap = 'wrap';
              tagsContainer.style.gap = '6px';
              tagsContainer.style.marginBottom = '16px';
              concept.tags.slice(0, 6).forEach((tag) => {
                const tagEl = document.createElement('span');
                tagEl.style.background = 'rgba(17, 138, 178, 0.1)';
                tagEl.style.color = 'var(--accent)';
                tagEl.style.fontSize = '11px';
                tagEl.style.padding = '4px 8px';
                tagEl.style.borderRadius = '4px';
                tagEl.style.fontWeight = '500';
                tagEl.textContent = tag;
                tagsContainer.appendChild(tagEl);
              });
              content.appendChild(tagsContainer);
            }
            container.appendChild(content);

            // Actions section
            const actions = document.createElement('div');
            actions.style.padding = '12px 16px';
            actions.style.borderTop = '1px solid var(--border)';
            actions.style.background = 'var(--panel)';
            actions.style.borderRadius = '0 0 8px 8px';
            actions.style.display = 'flex';
            actions.style.gap = '8px';

            // View in graph button
            const graphButton = document.createElement('button');
            graphButton.style.flex = '1';
            graphButton.style.padding = '8px 12px';
            graphButton.style.background = 'var(--accent)';
            graphButton.style.color = 'white';
            graphButton.style.border = 'none';
            graphButton.style.borderRadius = '6px';
            graphButton.style.fontSize = '13px';
            graphButton.style.fontWeight = '500';
            graphButton.style.cursor = 'pointer';
            graphButton.style.transition = 'background 0.2s';
            graphButton.textContent = 'View in Graph';
            graphButton.onmouseenter = () => {
              graphButton.style.background = 'var(--accent-2)';
            };
            graphButton.onmouseleave = () => {
              graphButton.style.background = 'var(--accent)';
            };
            graphButton.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              const params = new URLSearchParams();
              params.set('select', concept.node_id);
              if (currentGraphId) {
                params.set('graph_id', currentGraphId);
              }
              window.location.href = `/?${params.toString()}`;
            };
            actions.appendChild(graphButton);

            // View concept page button
            const conceptButton = document.createElement('button');
            conceptButton.style.flex = '1';
            conceptButton.style.padding = '8px 12px';
            conceptButton.style.background = 'transparent';
            conceptButton.style.color = 'var(--accent)';
            conceptButton.style.border = '1px solid var(--border)';
            conceptButton.style.borderRadius = '6px';
            conceptButton.style.fontSize = '13px';
            conceptButton.style.fontWeight = '500';
            conceptButton.style.cursor = 'pointer';
            conceptButton.style.transition = 'background 0.2s';
            conceptButton.textContent = 'View Details';
            conceptButton.onmouseenter = () => {
              conceptButton.style.background = 'rgba(17, 138, 178, 0.05)';
            };
            conceptButton.onmouseleave = () => {
              conceptButton.style.background = 'transparent';
            };
            conceptButton.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(`/concepts/${concept.node_id}`, '_blank');
            };
            actions.appendChild(conceptButton);

            container.appendChild(actions);

            tippyInstance.setContent(container);
          } catch (error) {
            console.error('Failed to load concept:', error);
            const errorContent = document.createElement('div');
            errorContent.style.padding = '16px';
            errorContent.style.fontSize = '14px';
            errorContent.style.color = 'var(--accent-2)';
            errorContent.style.textAlign = 'center';
            errorContent.textContent = 'Failed to load concept';
            tippyInstance.setContent(errorContent);
          }
        },
      })[0];

      (target as any)._tippy = tippyInstance;
    };

    // Set up tippy for all existing concept hover triggers
    const setupAllTippies = () => {
      const editorElement = editor.view.dom;
      const triggers = editorElement.querySelectorAll('.concept-hover-trigger');
      console.log(`[LectureEditor] Found ${triggers.length} concept hover triggers in editor`);
      triggers.forEach((trigger) => {
        setupTippyForElement(trigger as HTMLElement);
      });
    };

    // Initial setup
    setupAllTippies();

    // Watch for new concept hover triggers being added (when content changes)
    const observer = new MutationObserver(() => {
      setupAllTippies();
    });

    const editorElement = editor.view.dom;
    observer.observe(editorElement, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      // Clean up tippy instances
      const triggers = editorElement.querySelectorAll('.concept-hover-trigger');
      triggers.forEach((trigger) => {
        const instance = (trigger as any)._tippy;
        if (instance) {
          instance.destroy();
          (trigger as any)._tippy = null;
        }
      });
    };
  }, [editor, conceptMap, graphId]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
      }}
    >
      <EditorContent editor={editor} />
      {editor && <FloatingToolbar editor={editor} />}
      <style jsx global>{`
        .lecture-editor-content {
          max-width: 800px;
          margin: 0 auto;
          padding: 40px 24px;
          line-height: 1.7;
          color: var(--ink);
        }

        .lecture-editor-content .ProseMirror {
          outline: none;
        }

        .lecture-editor-content .ProseMirror p {
          margin: 0 0 1.5em 0;
        }

        .lecture-editor-content .ProseMirror p.is-editor-empty:first-child::before {
          color: var(--muted);
          content: attr(data-placeholder);
          float: left;
          height: 0;
          pointer-events: none;
        }

        .lecture-editor-content .ProseMirror h1 {
          font-size: 2.5em;
          font-weight: 700;
          line-height: 1.2;
          margin: 1.5em 0 0.5em 0;
        }

        .lecture-editor-content .ProseMirror h2 {
          font-size: 2em;
          font-weight: 600;
          line-height: 1.3;
          margin: 1.5em 0 0.5em 0;
        }

        .lecture-editor-content .ProseMirror h3 {
          font-size: 1.5em;
          font-weight: 600;
          line-height: 1.4;
          margin: 1.5em 0 0.5em 0;
        }

        .lecture-editor-content .ProseMirror ul,
        .lecture-editor-content .ProseMirror ol {
          margin: 1em 0;
          padding-left: 2em;
        }

        .lecture-editor-content .ProseMirror li {
          margin: 0.5em 0;
        }

        .lecture-editor-content .ProseMirror blockquote {
          border-left: 4px solid var(--accent);
          margin: 1.5em 0;
          padding-left: 1.5em;
          color: var(--muted);
          font-style: italic;
        }

        .lecture-editor-content .ProseMirror code {
          background: var(--panel);
          border-radius: 4px;
          color: var(--accent);
          font-family: 'IBM Plex Mono', monospace;
          font-size: 0.9em;
          padding: 2px 6px;
        }

        .lecture-editor-content .ProseMirror pre {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--ink);
          font-family: 'IBM Plex Mono', monospace;
          font-size: 0.9em;
          margin: 1.5em 0;
          overflow-x: auto;
          padding: 1.5em;
        }

        .lecture-editor-content .ProseMirror pre code {
          background: transparent;
          color: inherit;
          padding: 0;
        }

        .lecture-editor-content .ProseMirror a.lecture-link {
          color: var(--accent);
          text-decoration: underline;
          cursor: pointer;
        }

        .lecture-editor-content .ProseMirror a.lecture-link:hover {
          text-decoration: none;
        }

        .concept-mention {
          background: var(--panel);
          color: var(--accent);
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 500;
          cursor: pointer;
          text-decoration: none;
        }

        .concept-mention:hover {
          background: var(--panel);
          border: 1px solid var(--border);
        }

        .lecture-editor-content .ProseMirror img.lecture-image {
          max-width: 100%;
          height: auto;
          border-radius: 8px;
          margin: 1.5em 0;
          display: block;
        }

        .concept-hover-trigger {
          cursor: help !important;
          border-bottom: 1px dotted var(--accent) !important;
          transition: all 0.2s;
          position: relative;
        }

        .concept-hover-trigger:hover {
          background: rgba(17, 138, 178, 0.08) !important;
          border-bottom-color: var(--accent) !important;
          border-bottom-style: solid !important;
        }
      `}</style>
    </div>
  );
}

