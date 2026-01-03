import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { extractPotentialTerms } from '../../../lib/wikipedia';

interface WikipediaHoverOptions {
  enabled: boolean;
  minTermLength: number;
}

/**
 * WikipediaHover extension - highlights potential Wikipedia-worthy terms
 * and enables hover tooltips with Wikipedia summaries
 */
export const WikipediaHover = Extension.create<WikipediaHoverOptions>({
  name: 'wikipediaHover',

  addOptions() {
    return {
      enabled: true,
      minTermLength: 3,
    };
  },

  addProseMirrorPlugins() {
    const { enabled, minTermLength } = this.options;
    
    return [
      new Plugin({
        key: new PluginKey('wikipediaHover'),
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, set, oldState, newState) {
            if (!enabled) {
              return DecorationSet.empty;
            }

            // Recalculate on document changes
            const shouldRecalculate = !tr.doc.eq(oldState.doc);
            
            if (!shouldRecalculate) {
              return set.map(tr.mapping, tr.doc);
            }

            set = DecorationSet.empty;
            const decorations: Decoration[] = [];

            // Find all text nodes and extract potential Wikipedia terms
            tr.doc.descendants((node, pos) => {
              if (node.isText) {
                const text = node.textContent;
                const usedRanges: Array<{ from: number; to: number }> = [];
                
                // Extract potential terms from text
                const terms = extractPotentialTerms(text);
                
                // Filter terms by minimum length
                const validTerms = terms.filter(term => term.length >= minTermLength);
                
                // Create decorations for each term
                for (const term of validTerms) {
                  // Find all occurrences of this term in the text
                  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  const regex = new RegExp(`\\b${escapedTerm}\\b`, 'gi');
                  let match;
                  regex.lastIndex = 0;
                  
                  while ((match = regex.exec(text)) !== null) {
                    const start = pos + match.index;
                    const end = start + match[0].length;
                    
                    // Don't create decorations inside code blocks, code, mentions, or existing concept hovers
                    const $from = tr.doc.resolve(start);
                    const nodeType = $from.parent.type.name;
                    if (nodeType === 'codeBlock' || nodeType === 'code' || nodeType === 'conceptMention') {
                      continue;
                    }

                    // Check if this range overlaps with an existing decoration
                    const overlaps = usedRanges.some(range => 
                      (start < range.to && end > range.from)
                    );
                    if (overlaps) continue;

                    usedRanges.push({ from: start, to: end });
                    decorations.push(
                      Decoration.inline(start, end, {
                        class: 'wikipedia-hover-trigger',
                        'data-wikipedia-term': term,
                        style: 'cursor: help; border-bottom: 1px dotted rgba(255, 200, 0, 0.5);',
                      })
                    );
                  }
                }
              }
            });

            return DecorationSet.create(tr.doc, decorations);
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

