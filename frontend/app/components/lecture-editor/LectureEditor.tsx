'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { Underline } from '@tiptap/extension-underline';
import { FontFamily } from '@tiptap/extension-font-family';
import { useEffect, useState, useCallback, useRef } from 'react';
import tippy from 'tippy.js';
import { ConceptMention } from './ConceptMention';
import { CodeBlock } from './CodeBlock';
import { ConceptHover } from './ConceptHover';
import { WikipediaHover } from './WikipediaHover';
import PencilCanvas, { type Stroke } from '../ui/PencilCanvas';
import { searchConcepts, getAllGraphData, getLectureMentions, createLectureMention, deleteLectureMention, upsertLectureBlocks, type Concept, type LectureMention } from '../../api-client';
import { FloatingToolbar } from './FloatingToolbar';
import FloatingSearchBubble from '../ui/FloatingSearchBubble';
import { fetchWikipediaSummary } from '../../../lib/wikipedia';
import { BlockId } from './BlockId';
import { BlockInk } from './BlockInk';
import { ConceptLink } from './ConceptLink';
import { ConceptLinkModal } from './ConceptLinkModal';
import { extractBlocksFromEditor } from './blockUtils';
import { useTimeTracking } from '../../lib/useTimeTracking';
import 'tippy.js/dist/tippy.css';

interface LectureEditorProps {
  content: string;
  onUpdate: (content: string) => void;
  placeholder?: string;
  graphId?: string;
  lectureId?: string;
  onMentionClick?: (mention: LectureMention) => void;
  onEditorReady?: (editor: any) => void;
  wikipediaHoverEnabled?: boolean;
  onToggleWikipediaHover?: () => void;
  isPencilMode?: boolean;
  onTogglePencilMode?: () => void;
  onChatTrigger?: (message: string, image?: string, context?: { blockId?: string; blockText?: string }) => void;
  annotations?: string | null;
  onAnnotationsChange?: (annotations: string) => void;
  paperType?: string;
}

type SelectionInfo = {
  blockId: string;
  startOffset: number;
  endOffset: number;
  surfaceText: string;
  blockText: string;
  mention?: LectureMention | null;
};

export function LectureEditor({
  content,
  onUpdate,
  placeholder = 'Start writing your lecture...',
  graphId,
  lectureId,
  onMentionClick,
  onEditorReady,
  wikipediaHoverEnabled: propWikipediaHoverEnabled = true,
  onToggleWikipediaHover,
  isPencilMode = false,
  onTogglePencilMode,
  onChatTrigger,
  annotations,
  onAnnotationsChange,
  paperType,
}: LectureEditorProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [conceptMap, setConceptMap] = useState<Map<string, Concept>>(new Map());
  const [wikipediaHoverEnabled, setWikipediaHoverEnabled] = useState(propWikipediaHoverEnabled);
  const [mentions, setMentions] = useState<LectureMention[]>([]);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchPosition, setSearchPosition] = useState<{ x: number; y: number } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);
  const [pendingLinkSelection, setPendingLinkSelection] = useState<SelectionInfo | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [mentionError, setMentionError] = useState<string | null>(null);
  const [toolbarPosition, setToolbarPosition] = useState<{
    top: number;
    left: number;
    placement: 'top' | 'bottom';
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const linkDisabledReason = lectureId ? null : 'Save this lecture to enable concept links.';


  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Automatic time tracking for lecture viewing/editing
  useTimeTracking(lectureId, undefined, undefined, undefined, 'read', !!lectureId);

  useEffect(() => {
    if (!lectureId) {
      setMentions([]);
      return;
    }

    let isActive = true;
    setMentionError(null);

    getLectureMentions(lectureId)
      .then((data) => {
        if (isActive) {
          setMentions(data);
        }
      })
      .catch((error) => {
        if (isActive) {
          console.error('[LectureEditor] Failed to load mentions:', error);
          setMentionError(error instanceof Error ? error.message : 'Failed to load mentions');
        }
      });

    return () => {
      isActive = false;
    };
  }, [lectureId]);

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

        setConceptMap(concepts);
      } catch (error) {
        console.error('[LectureEditor] Failed to load concepts for hover:', error);
        // Set empty map on error to prevent infinite retries
        setConceptMap(new Map());
      }
    }

    loadConcepts();
  }, [graphId]);

  // Sync with prop changes
  useEffect(() => {
    if (propWikipediaHoverEnabled !== wikipediaHoverEnabled) {
      setWikipediaHoverEnabled(propWikipediaHoverEnabled);
    }
  }, [propWikipediaHoverEnabled, wikipediaHoverEnabled]);

  const editor = useEditor({
    immediatelyRender: false,
    editable: true,
    extensions: [
      BlockId,
      BlockInk,
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
      ConceptLink.configure({
        mentions,
      }),
      ConceptHover.configure({
        conceptNames: conceptMap,
      }),
      WikipediaHover.configure({
        enabled: wikipediaHoverEnabled,
        minTermLength: 3,
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
                if (src && editor) {
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
              if (src && editor) {
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

  const findBlockAtPos = useCallback((resolvedPos: any) => {
    for (let depth = resolvedPos.depth; depth > 0; depth -= 1) {
      const node = resolvedPos.node(depth);
      const blockId = node.attrs?.blockId;
      if (node.isBlock && blockId && ['paragraph', 'heading', 'codeBlock'].includes(node.type.name)) {
        return {
          node,
          blockId,
          pos: resolvedPos.before(depth),
        };
      }
    }
    return null;
  }, []);

  const buildSelectionInfo = useCallback(() => {
    if (!editor) {
      return { info: null, error: null };
    }

    const { selection } = editor.state;
    if (selection.empty) {
      return { info: null, error: null };
    }

    const fromBlock = findBlockAtPos(selection.$from);
    const toBlock = findBlockAtPos(selection.$to);
    if (!fromBlock || !toBlock || fromBlock.blockId !== toBlock.blockId) {
      return { info: null, error: 'Select text within a single block to link.' };
    }

    const blockStart = fromBlock.pos + 1;
    const blockEnd = fromBlock.pos + fromBlock.node.nodeSize - 1;
    const blockText = editor.state.doc.textBetween(blockStart, blockEnd, '\n', '\n');
    const surfaceText = editor.state.doc.textBetween(selection.from, selection.to, '\n', '\n');
    const startOffset = editor.state.doc.textBetween(blockStart, selection.from, '\n', '\n').length;
    const endOffset = editor.state.doc.textBetween(blockStart, selection.to, '\n', '\n').length;

    const overlapping = mentions.find(
      (item) =>
        item.block_id === fromBlock.blockId &&
        startOffset < item.end_offset &&
        endOffset > item.start_offset
    );

    return {
      info: {
        blockId: fromBlock.blockId,
        startOffset,
        endOffset,
        surfaceText,
        blockText,
        mention: overlapping || null,
      },
      error: null,
    };
  }, [editor, mentions, findBlockAtPos]);

  const updateToolbarPosition = useCallback(() => {
    if (!editor || !containerRef.current) {
      setToolbarPosition(null);
      return;
    }

    const { selection } = editor.state;
    if (selection.empty) {
      setToolbarPosition(null);
      return;
    }

    const start = editor.view.coordsAtPos(selection.from);
    const end = editor.view.coordsAtPos(selection.to);
    const containerRect = containerRef.current.getBoundingClientRect();
    const left =
      (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2 - containerRect.left;
    const topCandidate = Math.min(start.top, end.top) - containerRect.top;
    const bottomCandidate = Math.max(start.bottom, end.bottom) - containerRect.top;

    let placement: 'top' | 'bottom' = 'top';
    let top = topCandidate;
    if (topCandidate < 32) {
      top = bottomCandidate;
      placement = 'bottom';
    }

    const horizontalPadding = 16;
    const clampedLeft = Math.min(
      containerRect.width - horizontalPadding,
      Math.max(horizontalPadding, left)
    );

    setToolbarPosition({
      top,
      left: clampedLeft,
      placement,
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      setSelectionInfo(null);
      setSelectionError(null);
      setToolbarPosition(null);
      return;
    }

    const updateSelection = () => {
      const { info, error } = buildSelectionInfo();
      setSelectionInfo(info);
      setSelectionError(error);
      updateToolbarPosition();
    };

    updateSelection();
    editor.on('selectionUpdate', updateSelection);
    editor.on('transaction', updateToolbarPosition);

    const handleScroll = () => {
      updateToolbarPosition();
    };

    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll);

    return () => {
      editor.off('selectionUpdate', updateSelection);
      editor.off('transaction', updateToolbarPosition);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [editor, buildSelectionInfo, updateToolbarPosition]);

  // Update editor content when prop changes (but not on every keystroke)
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor]);

  // Notify parent when editor is ready
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  useEffect(() => {
    if (!editor || conceptMap.size === 0) {
      return;
    }

    const extension = editor.extensionManager.extensions.find(ext => ext.name === 'conceptHover');
    if (extension) {
      extension.options.conceptNames = conceptMap;

      // Trigger a transaction to force plugin re-evaluation
      const { state, dispatch } = editor.view;
      const tr = state.tr.setMeta('forceConceptHoverUpdate', true);
      dispatch(tr);
    } else {
      console.warn('[LectureEditor] ConceptHover extension not found!');
    }
  }, [editor, conceptMap]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const extension = editor.extensionManager.extensions.find(ext => ext.name === 'conceptLink');
    if (extension) {
      extension.options.mentions = mentions;
      const { state, dispatch } = editor.view;
      const tr = state.tr.setMeta('forceConceptLinkUpdate', true);
      dispatch(tr);
    }
  }, [editor, mentions]);

  // Update Wikipedia hover extension when toggle changes
  useEffect(() => {
    if (!editor) return;

    const extension = editor.extensionManager.extensions.find(ext => ext.name === 'wikipediaHover');
    if (extension) {
      // Update the extension options
      extension.options.enabled = wikipediaHoverEnabled;

      // Force editor to re-render decorations by dispatching a transaction with meta
      // This will trigger the plugin's apply function which checks the enabled option
      const { state, dispatch } = editor.view;
      const tr = state.tr.setMeta('forceWikipediaHoverUpdate', true);
      dispatch(tr);

      // Also clean up any existing tippy instances if disabling
      if (!wikipediaHoverEnabled) {
        const editorElement = editor.view.dom;
        const triggers = editorElement.querySelectorAll('.wikipedia-hover-trigger');
        triggers.forEach((trigger) => {
          const instance = (trigger as any)._wikipediaTippy;
          if (instance) {
            instance.destroy();
            (trigger as any)._wikipediaTippy = null;
          }
        });
      }
    }
  }, [editor, wikipediaHoverEnabled]);

  useEffect(() => {
    if (!editor || conceptMap.size === 0) {
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

      const tippyInstance = tippy(target as Element, {
        content: loadingContent,
        placement: 'top',
        delay: [300, 0],
        interactive: true,
        trigger: 'mouseenter',
        theme: 'light-border',
        appendTo: () => document.body,
        maxWidth: 420,
        offset: [0, 8],
        onShow: () => {
          void (async () => {
            try {
              const { getConcept, getNeighborsWithRelationships } = await import('../../api-client');
              const [concept, neighborsData] = await Promise.all([
                getConcept(conceptId),
                getNeighborsWithRelationships(conceptId).catch(() => []),
              ]);

              // Use the graphId prop if available
              const currentGraphId: string | undefined = graphId;

              const container = document.createElement('div');
              container.style.maxWidth = '480px';
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
              title.style.fontWeight = '600';
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

              // Definition from your graph (most important)
              if (concept.description) {
                const descSection = document.createElement('div');
                descSection.style.marginBottom = '16px';

                const descLabel = document.createElement('div');
                descLabel.style.fontSize = '11px';
                descLabel.style.color = 'var(--muted)';
                descLabel.style.textTransform = 'uppercase';
                descLabel.style.letterSpacing = '0.5px';
                descLabel.style.marginBottom = '6px';
                descLabel.textContent = 'Definition (from your graph)';
                descSection.appendChild(descLabel);

                const desc = document.createElement('div');
                desc.style.fontSize = '14px';
                desc.style.color = 'var(--ink)';
                desc.style.lineHeight = '1.6';
                desc.textContent = concept.description.length > 300
                  ? `${concept.description.substring(0, 300)}...`
                  : concept.description;
                descSection.appendChild(desc);
                content.appendChild(descSection);
              } else {
                const noDesc = document.createElement('div');
                noDesc.style.fontSize = '13px';
                noDesc.style.color = 'var(--muted)';
                noDesc.style.fontStyle = 'italic';
                noDesc.style.marginBottom = '12px';
                noDesc.textContent = 'No definition in your graph yet';
                content.appendChild(noDesc);
              }

              // Related concepts (how it's used in your graph)
              if (neighborsData && neighborsData.length > 0) {
                const relatedSection = document.createElement('div');
                relatedSection.style.marginBottom = '16px';

                const relatedLabel = document.createElement('div');
                relatedLabel.style.fontSize = '11px';
                relatedLabel.style.color = 'var(--muted)';
                relatedLabel.style.textTransform = 'uppercase';
                relatedLabel.style.letterSpacing = '0.5px';
                relatedLabel.style.marginBottom = '8px';
                relatedLabel.textContent = `Connected to ${neighborsData.length} concept${neighborsData.length !== 1 ? 's' : ''}`;
                relatedSection.appendChild(relatedLabel);

                const relatedList = document.createElement('div');
                relatedList.style.display = 'flex';
                relatedList.style.flexWrap = 'wrap';
                relatedList.style.gap = '6px';

                // Show top 5 related concepts with their relationship type
                neighborsData.slice(0, 5).forEach(({ concept: neighbor, predicate, is_outgoing }) => {
                  const relatedItem = document.createElement('div');
                  relatedItem.style.display = 'flex';
                  relatedItem.style.alignItems = 'center';
                  relatedItem.style.gap = '4px';
                  relatedItem.style.fontSize = '12px';
                  relatedItem.style.color = 'var(--ink)';
                  relatedItem.style.padding = '4px 8px';
                  relatedItem.style.background = 'var(--panel)';
                  relatedItem.style.borderRadius = '4px';
                  relatedItem.style.border = '1px solid var(--border)';

                  const relIcon = document.createElement('span');
                  relIcon.textContent = is_outgoing ? '→' : '←';
                  relIcon.style.color = 'var(--accent)';
                  relIcon.style.fontWeight = '600';
                  relatedItem.appendChild(relIcon);

                  const relText = document.createElement('span');
                  relText.textContent = neighbor.name;
                  relatedItem.appendChild(relText);

                  if (predicate) {
                    const predicateBadge = document.createElement('span');
                    predicateBadge.textContent = predicate;
                    predicateBadge.style.fontSize = '10px';
                    predicateBadge.style.color = 'var(--muted)';
                    predicateBadge.style.marginLeft = '4px';
                    relatedItem.appendChild(predicateBadge);
                  }

                  relatedList.appendChild(relatedItem);
                });

                if (neighborsData.length > 5) {
                  const moreText = document.createElement('div');
                  moreText.style.fontSize = '11px';
                  moreText.style.color = 'var(--muted)';
                  moreText.style.marginTop = '4px';
                  moreText.textContent = `+${neighborsData.length - 5} more`;
                  relatedList.appendChild(moreText);
                }

                relatedSection.appendChild(relatedList);
                content.appendChild(relatedSection);
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

              // Add Wikipedia info as supplementary (fetch in background)
              fetchWikipediaSummary(concept.name).then((wikiSummary) => {
                if (wikiSummary) {
                  const wikiSection = document.createElement('div');
                  wikiSection.style.marginTop = '16px';
                  wikiSection.style.paddingTop = '16px';
                  wikiSection.style.borderTop = '1px solid var(--border)';

                  const wikiLabel = document.createElement('div');
                  wikiLabel.style.fontSize = '11px';
                  wikiLabel.style.color = 'var(--muted)';
                  wikiLabel.style.textTransform = 'uppercase';
                  wikiLabel.style.letterSpacing = '0.5px';
                  wikiLabel.style.marginBottom = '8px';
                  wikiLabel.style.display = 'flex';
                  wikiLabel.style.alignItems = 'center';
                  wikiLabel.style.gap = '6px';

                  const wikiIcon = document.createElement('span');
                  wikiIcon.textContent = '';
                  wikiLabel.appendChild(wikiIcon);

                  const wikiLabelText = document.createElement('span');
                  wikiLabelText.textContent = 'Wikipedia (supplementary)';
                  wikiLabel.appendChild(wikiLabelText);
                  wikiSection.appendChild(wikiLabel);

                  const wikiExtract = document.createElement('div');
                  wikiExtract.style.fontSize = '13px';
                  wikiExtract.style.color = 'var(--ink)';
                  wikiExtract.style.lineHeight = '1.5';
                  wikiExtract.style.opacity = '0.85';
                  wikiExtract.style.marginBottom = '8px';
                  const extractText = wikiSummary.extract.length > 200
                    ? `${wikiSummary.extract.substring(0, 200)}...`
                    : wikiSummary.extract;
                  wikiExtract.textContent = extractText;
                  wikiSection.appendChild(wikiExtract);

                  if (wikiSummary.fullurl) {
                    const wikiLink = document.createElement('a');
                    wikiLink.href = wikiSummary.fullurl;
                    wikiLink.target = '_blank';
                    wikiLink.rel = 'noopener noreferrer';
                    wikiLink.style.fontSize = '12px';
                    wikiLink.style.color = 'var(--accent)';
                    wikiLink.style.textDecoration = 'none';
                    wikiLink.textContent = 'Read more on Wikipedia →';
                    wikiLink.onmouseenter = () => {
                      wikiLink.style.textDecoration = 'underline';
                    };
                    wikiLink.onmouseleave = () => {
                      wikiLink.style.textDecoration = 'none';
                    };
                    wikiSection.appendChild(wikiLink);
                  }

                  content.appendChild(wikiSection);
                  // Update tippy content
                  tippyInstance.setContent(container);
                }
              }).catch(() => {
                // Silently fail - Wikipedia is optional
              });

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
          })();
        },
      });

      (target as any)._tippy = tippyInstance;
    };

    // Set up tippy for all existing concept hover triggers
    let rAF_setup: number | null = null;
    const setupAllTippies = () => {
      if (!editor || rAF_setup) return;
      rAF_setup = requestAnimationFrame(() => {
        if (!editor?.view?.dom) return;
        const editorElement = editor.view.dom;
        const triggers = editorElement.querySelectorAll('.concept-hover-trigger, .concept-link');
        triggers.forEach((trigger) => {
          setupTippyForElement(trigger as HTMLElement);
        });
        rAF_setup = null;
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
      const triggers = editorElement.querySelectorAll('.concept-hover-trigger, .concept-link');
      triggers.forEach((trigger) => {
        const instance = (trigger as any)._tippy;
        if (instance) {
          instance.destroy();
          (trigger as any)._tippy = null;
        }
      });
    };
  }, [editor, conceptMap, graphId]);

  // Set up Wikipedia hover previews when editor is ready
  useEffect(() => {
    if (!editor) {
      return;
    }

    const setupWikipediaTippyForElement = (target: HTMLElement) => {
      const term = target.getAttribute('data-wikipedia-term');

      if (!term) {
        return;
      }

      if ((target as any)._wikipediaTippy) {
        // Already has tippy instance
        return;
      }

      const loadingContent = document.createElement('div');
      loadingContent.style.padding = '16px';
      loadingContent.style.fontSize = '14px';
      loadingContent.style.color = 'var(--muted)';
      loadingContent.style.textAlign = 'center';
      loadingContent.textContent = 'Loading Wikipedia...';

      const tippyInstance = tippy(target as Element, {
        content: loadingContent,
        placement: 'top',
        delay: [400, 0], // Slightly longer delay than concept hover
        interactive: true,
        trigger: 'mouseenter',
        theme: 'light-border',
        appendTo: () => document.body,
        maxWidth: 450,
        offset: [0, 8],
        onShow: () => {
          void (async () => {
            try {
              // First check if this term exists in the user's graph
              // If it does, don't show Wikipedia hover (concept hover will handle it)
              try {
                const { searchConcepts } = await import('../../api-client');
                const searchResult = await searchConcepts(term, graphId, 1);
                if (searchResult.results && searchResult.results.length > 0) {
                  // Term exists in graph - don't show Wikipedia hover
                  // The concept hover will show it with Wikipedia as supplementary
                  const existsMsg = document.createElement('div');
                  existsMsg.style.padding = '16px';
                  existsMsg.style.fontSize = '14px';
                  existsMsg.style.color = 'var(--muted)';
                  existsMsg.style.textAlign = 'center';
                  existsMsg.innerHTML = `"${term}" exists in your graph.<br/>Hover over it to see your definition and context.`;
                  tippyInstance.setContent(existsMsg);
                  return;
                }
              } catch (err) {
                // If search fails, continue to Wikipedia
                console.log('Concept search failed, showing Wikipedia:', err);
              }

              // Term doesn't exist in graph - show Wikipedia info
              const summary = await fetchWikipediaSummary(term);

              if (!summary) {
                const noResult = document.createElement('div');
                noResult.style.padding = '16px';
                noResult.style.fontSize = '14px';
                noResult.style.color = 'var(--muted)';
                noResult.style.textAlign = 'center';
                noResult.textContent = `No Wikipedia article found for "${term}"`;
                tippyInstance.setContent(noResult);
                return;
              }

              const container = document.createElement('div');
              container.style.maxWidth = '450px';
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
              header.style.display = 'flex';
              header.style.alignItems = 'center';
              header.style.gap = '12px';

              // Wikipedia icon/logo
              const icon = document.createElement('div');
              icon.style.width = '24px';
              icon.style.height = '24px';
              icon.style.background = 'url("https://en.wikipedia.org/static/favicon/wikipedia.ico") no-repeat center';
              icon.style.backgroundSize = 'contain';
              icon.style.flexShrink = '0';
              header.appendChild(icon);

              const titleContainer = document.createElement('div');
              titleContainer.style.flex = '1';

              const title = document.createElement('div');
              title.style.fontSize = '18px';
              title.style.fontWeight = '600';
              title.style.color = 'var(--ink)';
              title.style.marginBottom = '4px';
              title.style.lineHeight = '1.3';
              title.textContent = summary.title;
              titleContainer.appendChild(title);

              if (summary.description) {
                const desc = document.createElement('div');
                desc.style.fontSize = '12px';
                desc.style.color = 'var(--muted)';
                desc.style.textTransform = 'uppercase';
                desc.style.letterSpacing = '0.5px';
                desc.textContent = summary.description;
                titleContainer.appendChild(desc);
              }

              header.appendChild(titleContainer);
              container.appendChild(header);

              // Content section
              const content = document.createElement('div');
              content.style.padding = '16px';

              const extract = document.createElement('div');
              extract.style.fontSize = '14px';
              extract.style.color = 'var(--ink)';
              extract.style.lineHeight = '1.6';
              extract.style.marginBottom = '12px';
              // Limit extract to first 300 characters
              const extractText = summary.extract.length > 300
                ? `${summary.extract.substring(0, 300)}...`
                : summary.extract;
              extract.textContent = extractText;
              content.appendChild(extract);

              container.appendChild(content);

              // Actions section
              const actions = document.createElement('div');
              actions.style.padding = '12px 16px';
              actions.style.borderTop = '1px solid var(--border)';
              actions.style.background = 'var(--panel)';
              actions.style.borderRadius = '0 0 8px 8px';
              actions.style.display = 'flex';
              actions.style.gap = '8px';

              // Open in Wikipedia button
              if (summary.fullurl) {
                const openBtn = document.createElement('a');
                openBtn.href = summary.fullurl;
                openBtn.target = '_blank';
                openBtn.rel = 'noopener noreferrer';
                openBtn.style.padding = '8px 16px';
                openBtn.style.background = 'var(--accent)';
                openBtn.style.color = 'white';
                openBtn.style.border = 'none';
                openBtn.style.borderRadius = '6px';
                openBtn.style.cursor = 'pointer';
                openBtn.style.fontSize = '13px';
                openBtn.style.fontWeight = '600';
                openBtn.style.textDecoration = 'none';
                openBtn.style.display = 'inline-block';
                openBtn.textContent = 'Open in Wikipedia';
                actions.appendChild(openBtn);
              }

              container.appendChild(actions);
              tippyInstance.setContent(container);
            } catch (error) {
              console.error('Failed to load Wikipedia summary:', error);
              const errorContent = document.createElement('div');
              errorContent.style.padding = '16px';
              errorContent.style.fontSize = '14px';
              errorContent.style.color = 'var(--accent-2)';
              errorContent.style.textAlign = 'center';
              errorContent.textContent = 'Failed to load Wikipedia information';
              tippyInstance.setContent(errorContent);
            }
          })();
        },
      });

      (target as any)._wikipediaTippy = tippyInstance;
    };

    // Set up tippy for all existing Wikipedia hover triggers
    let rAF_wiki: number | null = null;
    const setupAllWikipediaTippies = () => {
      if (!editor || rAF_wiki) return;
      rAF_wiki = requestAnimationFrame(() => {
        if (!editor?.view?.dom) return;
        const editorElement = editor.view.dom;
        const triggers = editorElement.querySelectorAll('.wikipedia-hover-trigger');
        triggers.forEach((trigger) => {
          setupWikipediaTippyForElement(trigger as HTMLElement);
        });
        rAF_wiki = null;
      });
    };

    // Initial setup
    setupAllWikipediaTippies();

    // Watch for new Wikipedia hover triggers being added
    const observer = new MutationObserver(() => {
      setupAllWikipediaTippies();
    });

    const editorElement = editor.view.dom;
    observer.observe(editorElement, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      // Clean up tippy instances
      const triggers = editorElement.querySelectorAll('.wikipedia-hover-trigger');
      triggers.forEach((trigger) => {
        const instance = (trigger as any)._wikipediaTippy;
        if (instance) {
          instance.destroy();
          (trigger as any)._wikipediaTippy = null;
        }
      });
    };
  }, [editor]);

  const ensureBlocksSynced = async () => {
    if (!lectureId || !editor) {
      return;
    }
    const blocks = extractBlocksFromEditor(editor);
    if (!blocks.length) {
      return;
    }
    await upsertLectureBlocks(lectureId, blocks);
  };

  const handleOpenLinkModal = () => {
    if (!selectionInfo) {
      return;
    }
    setMentionError(null);
    setPendingLinkSelection(selectionInfo);
    setIsLinkModalOpen(true);
  };

  const handleConfirmLink = async (concept: Concept, contextNote?: string) => {
    if (!lectureId || !pendingLinkSelection) {
      setIsLinkModalOpen(false);
      return;
    }
    try {
      await ensureBlocksSynced();
      const created = await createLectureMention({
        lecture_id: lectureId,
        block_id: pendingLinkSelection.blockId,
        start_offset: pendingLinkSelection.startOffset,
        end_offset: pendingLinkSelection.endOffset,
        surface_text: pendingLinkSelection.surfaceText,
        concept_id: concept.node_id,
        context_note: contextNote || null,
      });
      setMentions((prev) => [created, ...prev]);
      setMentionError(null);
      setIsLinkModalOpen(false);
      setPendingLinkSelection(null);
    } catch (error) {
      console.error('[LectureEditor] Failed to create mention:', error);
      setMentionError(error instanceof Error ? error.message : 'Failed to create mention');
    }
  };

  const handleRemoveLink = async () => {
    if (!selectionInfo?.mention) {
      return;
    }
    try {
      await deleteLectureMention(selectionInfo.mention.mention_id);
      setMentions((prev) => prev.filter((item) => item.mention_id !== selectionInfo.mention?.mention_id));
      setMentionError(null);
    } catch (error) {
      console.error('[LectureEditor] Failed to remove mention:', error);
      setMentionError(error instanceof Error ? error.message : 'Failed to remove mention');
    }
  };

  useEffect(() => {
    if (!editor) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }
      const linkEl = target.closest('.concept-link') as HTMLElement | null;
      if (!linkEl) {
        return;
      }
      const mentionId = linkEl.getAttribute('data-mention-id');
      if (!mentionId) {
        return;
      }
      const mention = mentions.find((item) => item.mention_id === mentionId);
      if (mention && onMentionClick) {
        onMentionClick(mention);
      }
    };

    const editorElement = editor.view.dom;
    editorElement.addEventListener('click', handleClick);

    return () => {
      editorElement.removeEventListener('click', handleClick);
    };
  }, [editor, mentions, onMentionClick]);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
      }}
      ref={containerRef}
    >
      <div style={{ pointerEvents: isPencilMode ? 'none' : 'auto' }}>
        <EditorContent editor={editor} />
      </div>

      <PencilCanvas
        overlay
        transparent
        readOnly={!isPencilMode}
        initialStrokes={annotations ? JSON.parse(annotations) : []}
        onStrokesChange={(strokes) => {
          if (onAnnotationsChange) {
            onAnnotationsChange(JSON.stringify(strokes));
          }
        }}
        onClose={onTogglePencilMode}
        title="Handwriting Mode"
        paperType={paperType}
        onIngest={async (data) => {
          if (!editor) return;
          // Anchor to current block
          const { from } = editor.state.selection;
          const resolvedPos = editor.state.doc.resolve(from);
          let blockPos = -1;
          let blockNode = null;
          for (let d = resolvedPos.depth; d >= 0; d--) {
            const node = resolvedPos.node(d);
            if (node.isBlock) {
              blockNode = node;
              blockPos = resolvedPos.before(d);
              break;
            }
          }
          if (blockNode && blockPos !== -1) {
            editor.view.dispatch(
              editor.view.state.tr.setNodeMarkup(blockPos, undefined, {
                ...blockNode.attrs,
                ink: data.image_data
              })
            );
          }

          // Also ingest into graph knowledge
          try {
            await fetch('/api/lectures/ingest-ink', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...data,
                lecture_title: lectureId ? `Lecture ${lectureId}` : "Handwritten Notes"
              })
            });
          } catch (e) {
            console.error("Knowledge ingestion fail:", e);
          }
        }}
        onIntent={(intent) => {
          if (intent.type === 'search') {
            // Handle search intent
            const bounds = intent.bounds || intent.boundingBox;
            if (!bounds) return;

            // Exit pencil mode so the search bubble is visible
            if (onTogglePencilMode) onTogglePencilMode();

            const { x, y, w, h } = bounds;
            const centerX = x + w / 2;
            const centerY = y + h / 2;

            // Set search position for bubble
            if (containerRef.current) {
              const rect = containerRef.current.getBoundingClientRect();
              setSearchPosition({ x: rect.left + centerX, y: rect.top + centerY });
            }

            // Perform search
            setIsSearching(true);

            // Call GPT-4o to extract text from image, then search
            fetch('/api/brain-web/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: 'Extract the main term or concept from this handwritten text. Return only the term, nothing else.',
                image: intent.snippetUrl,
                mode: 'graphrag',
                response_prefs: { mode: 'compact', max_output_tokens: 50 },
              }),
            })
              .then(res => res.json())
              .then(data => {
                const extractedTerm = data.answer?.trim() || '';
                if (!extractedTerm) {
                  setIsSearching(false);
                  return;
                }

                // Now search for this term
                return fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'}/ai/semantic-search`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ message: extractedTerm, limit: 5 }),
                });
              })
              .then(res => res?.json())
              .then(data => {
                if (data?.nodes) {
                  setSearchResults(data.nodes.map((node: any, idx: number) => ({
                    ...node,
                    score: data.scores?.[idx] || 0,
                  })));
                }
                setIsSearching(false);
              })
              .catch(err => {
                console.error('Search failed:', err);
                setIsSearching(false);
              });
          } else if (intent.type === 'lasso') {
            const bounds = intent.bounds || intent.boundingBox;
            if (!bounds) return;

            // Exit pencil mode so the chat sidebar is visible
            if (onTogglePencilMode) onTogglePencilMode();

            const { x, y, w, h } = bounds;
            const centerX = x + w / 2;
            const centerY = y + h / 2;

            if (editor && containerRef.current) {
              const rect = containerRef.current.getBoundingClientRect();
              const viewportX = rect.left + centerX;
              const viewportY = rect.top + centerY;

              const pos = editor.view.posAtCoords({ left: viewportX, top: viewportY });
              let textContent = "";

              if (pos) {
                // Find if there's a concept or text here
                const $pos = editor.state.doc.resolve(pos.pos);
                const node = $pos.nodeAfter || $pos.nodeBefore;
                textContent = node?.textContent || "";
              }

              const query = textContent
                ? `Explain the significance of "${textContent}" in the context of this lecture.`
                : `Explain this. (I've circled this part of my notes)`;

              // Small delay to let the sidebar pull up smoothly before triggering chat
              setTimeout(() => {
                onChatTrigger?.(query, intent.snippetUrl);
              }, 400);
            }
          } else if (intent.type === 'underline') {
            alert("Priority assigned! Sentence marked as 'Important' for review.");
          }
        }}
      />

      {editor && (
        <FloatingToolbar
          editor={editor}
          onLinkConcept={lectureId && !selectionInfo?.mention ? handleOpenLinkModal : undefined}
          onRemoveLink={lectureId && selectionInfo?.mention ? handleRemoveLink : undefined}
          selectionError={selectionError}
          linkDisabledReason={linkDisabledReason}
          position={toolbarPosition}
          onExplain={() => {
            const selectedText = editor.state.doc.textBetween(
              editor.state.selection.from,
              editor.state.selection.to,
              ' '
            );
            if (selectedText && onChatTrigger) {
              onChatTrigger(`Explain: "${selectedText}"`);
            }
          }}
          onAddToChat={() => {
            const selectedText = editor.state.doc.textBetween(
              editor.state.selection.from,
              editor.state.selection.to,
              ' '
            );
            if (selectedText && onChatTrigger) {
              onChatTrigger(selectedText);
            }
          }}
          onTutor={() => {
            if (selectionInfo && onChatTrigger) {
              onChatTrigger(
                `Tutor me on this: "${selectionInfo.surfaceText}"`,
                undefined,
                { blockId: selectionInfo.blockId, blockText: selectionInfo.blockText }
              );
            }
          }}
        />
      )}

      {mentionError && (
        <div
          style={{
            position: 'absolute',
            bottom: '16px',
            right: '16px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '8px 12px',
            color: 'var(--accent-2)',
            fontSize: '12px',
            boxShadow: 'var(--shadow)',
          }}
        >
          {mentionError}
        </div>
      )}

      {searchPosition && (searchResults.length > 0 || isSearching) && (
        <FloatingSearchBubble
          results={searchResults}
          position={searchPosition}
          isLoading={isSearching}
          onClose={() => {
            setSearchPosition(null);
            setSearchResults([]);
          }}
          onViewInGraph={(nodeId) => {
            // Navigate to graph view with this node
            window.location.href = `/graph?node=${nodeId}`;
          }}
        />
      )}

      <ConceptLinkModal
        isOpen={isLinkModalOpen}
        selectionText={pendingLinkSelection?.surfaceText || ''}
        graphId={graphId}
        onClose={() => {
          setIsLinkModalOpen(false);
          setPendingLinkSelection(null);
        }}
        onLink={handleConfirmLink}
      />
      <style jsx global>{`
        .lecture-editor-content {
          max-width: 800px;
          margin: 0 auto;
          padding: 40px 24px;
          line-height: 1.7;
          color: ${paperType === 'dark' ? '#ffffff' : '#000000'} !important;
        }

        .lecture-editor-content .ProseMirror {
          outline: none;
          color: ${paperType === 'dark' ? '#ffffff' : '#000000'} !important;
        }

        .lecture-editor-content .ProseMirror p {
          color: ${paperType === 'dark' ? '#ffffff' : '#000000'} !important;
        }

        .lecture-editor-content .ProseMirror h1,
        .lecture-editor-content .ProseMirror h2,
        .lecture-editor-content .ProseMirror h3,
        .lecture-editor-content .ProseMirror h4,
        .lecture-editor-content .ProseMirror h5,
        .lecture-editor-content .ProseMirror h6 {
          color: ${paperType === 'dark' ? '#ffffff' : '#000000'} !important;
        }

        .lecture-editor-content .ProseMirror p {
          margin: 0 0 1.5em 0;
        }

        .lecture-editor-content .ProseMirror p.is-editor-empty:first-child::before {
          color: #666666 !important;
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
          color: #333333 !important;
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

        .has-ink-annotation {
          position: relative;
        }

        .has-ink-annotation::after {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-image: var(--ink-url);
          background-size: contain;
          background-repeat: no-repeat;
          background-position: center;
          pointer-events: none;
          z-index: 10;
          opacity: 0.8;
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
          cursor: pointer !important;
          border-bottom: 1px dotted var(--accent) !important;
          transition: all 0.2s;
          position: relative;
        }

        .concept-hover-trigger:hover {
          background: rgba(17, 138, 178, 0.08) !important;
          border-bottom-color: var(--accent) !important;
          border-bottom-style: solid !important;
        }

        .wikipedia-hover-trigger {
          cursor: pointer !important;
          border-bottom: 1px dotted rgba(255, 200, 0, 0.5) !important;
          transition: all 0.2s;
          position: relative;
        }

        .wikipedia-hover-trigger:hover {
          background: rgba(255, 200, 0, 0.08) !important;
          border-bottom-color: rgba(255, 200, 0, 0.8) !important;
          border-bottom-style: solid !important;
        }

        .concept-link {
          border-bottom: 2px solid rgba(17, 138, 178, 0.6);
          background: rgba(17, 138, 178, 0.08);
          cursor: pointer;
          transition: all 0.2s;
        }

        .concept-link:hover {
          background: rgba(17, 138, 178, 0.16);
          border-bottom-color: rgba(17, 138, 178, 0.9);
        }

        .concept-link-repair {
          border-bottom-style: dashed;
          background: rgba(243, 156, 18, 0.12);
        }
      `}</style>
    </div >
  );
}
