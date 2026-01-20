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
    const extension = this;
    const { minTermLength } = this.options;
    
    return [
      new Plugin({
        key: new PluginKey('wikipediaHover'),
        state: {
          init() {
            // Store both decorations and last enabled state
            return { decorations: DecorationSet.empty, lastEnabled: extension.options.enabled };
          },
          apply(tr, value, oldState, newState) {
            // Read enabled from extension options dynamically (not captured in closure)
            const enabled = extension.options.enabled;
            const lastEnabled = value.lastEnabled;
            
            // Check if enabled state changed
            const enabledChanged = enabled !== lastEnabled;
            
            // If disabled, return empty decorations
            if (!enabled) {
              return { decorations: DecorationSet.empty, lastEnabled: enabled };
            }

            // Recalculate on document changes OR if enabled state changed OR forced update
            const shouldRecalculate = !tr.doc.eq(oldState.doc) || enabledChanged || tr.getMeta('forceWikipediaHoverUpdate');
            
            let set = value.decorations;
            if (!shouldRecalculate) {
              set = set.map(tr.mapping, tr.doc);
              return { decorations: set, lastEnabled: enabled };
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

            const newDecorations = DecorationSet.create(tr.doc, decorations);
            return { decorations: newDecorations, lastEnabled: enabled };
          },
        },
        props: {
          decorations(state) {
            return this.getState(state).decorations;
          },
        },
      }),
    ];
  },
});

