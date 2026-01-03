import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { type Concept } from '../../api-client';

interface ConceptHoverOptions {
  conceptNames: Map<string, Concept>;
}

export const ConceptHover = Extension.create<ConceptHoverOptions>({
  name: 'conceptHover',

  addOptions() {
    return {
      conceptNames: new Map<string, Concept>(),
    };
  },

  addProseMirrorPlugins() {
    // Store reference to options that can be updated
    let conceptNamesRef = this.options.conceptNames;
    
    // Update reference when options change
    const updateConceptNames = () => {
      conceptNamesRef = this.options.conceptNames;
    };
    
    return [
      new Plugin({
        key: new PluginKey('conceptHover'),
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, set, oldState, newState) {
            // Update reference on each transaction
            updateConceptNames();
            
            // Recalculate on document changes or forced updates
            const shouldRecalculate = !tr.doc.eq(oldState.doc) || tr.getMeta('forceConceptHoverUpdate');
            
            if (!shouldRecalculate) {
              return set.map(tr.mapping, tr.doc);
            }

            set = DecorationSet.empty;
            const decorations: Decoration[] = [];

            if (conceptNamesRef.size === 0) {
              return DecorationSet.empty;
            }

            let totalMatches = 0;

            // Find all text nodes and check for concept names
            tr.doc.descendants((node, pos) => {
              if (node.isText) {
                const text = node.textContent;
                const usedRanges: Array<{ from: number; to: number }> = [];
                
                // Get unique concepts (avoid duplicates from case-insensitive keys)
                const uniqueConcepts = new Map<string, Concept>();
                for (const concept of conceptNamesRef.values()) {
                  // Use the actual concept name as key to avoid duplicates
                  if (!uniqueConcepts.has(concept.name.toLowerCase())) {
                    uniqueConcepts.set(concept.name.toLowerCase(), concept);
                  }
                }
                
                // Sort concepts by length (longest first) to prioritize longer matches
                const sortedConcepts = Array.from(uniqueConcepts.values())
                  .filter(concept => concept.name.length >= 3) // Skip very short names
                  .sort((a, b) => b.name.length - a.name.length);
                
                // Check each concept name
                for (const concept of sortedConcepts) {
                  const conceptName = concept.name;
                  // Escape special regex characters
                  const escapedName = conceptName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  // Use word boundaries, but also try without if word boundary fails for compound words
                  const patterns = [
                    new RegExp(`\\b${escapedName}\\b`, 'gi'), // Word boundary match
                    new RegExp(escapedName, 'gi'), // Direct match (for compound words)
                  ];
                  
                  for (const regex of patterns) {
                    let match;
                    // Reset regex lastIndex to avoid issues
                    regex.lastIndex = 0;
                    
                    while ((match = regex.exec(text)) !== null) {
                      const start = pos + match.index;
                      const end = start + match[0].length;
                      
                      // Don't create decorations inside code blocks, code, or mentions
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
                          class: 'concept-hover-trigger',
                          'data-concept-id': concept.node_id,
                          'data-concept-name': concept.name,
                          style: 'cursor: help; border-bottom: 1px dotted var(--accent);',
                        })
                      );
                      totalMatches++;
                      // Only use first pattern that matches to avoid duplicates
                      break;
                    }
                  }
                }
              }
            });

            if (totalMatches > 0) {
              console.log(`[ConceptHover] Found ${totalMatches} concept matches in document`);
            }

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

