import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { LectureMention } from '../../api-client';

interface ConceptLinkOptions {
  mentions: LectureMention[];
}

const BLOCK_TYPES = new Set(['paragraph', 'heading', 'codeBlock']);

type BlockEntry = {
  node: any;
  pos: number;
};

function resolveMentionRange(
  blockNode: any,
  blockPos: number,
  startOffset: number,
  endOffset: number,
  surfaceText: string
): { from: number; to: number; matched: boolean } | null {
  const text = blockNode.textContent || '';
  let resolvedStart = startOffset;
  let resolvedEnd = endOffset;
  let matched = true;

  if (resolvedStart < 0 || resolvedEnd > text.length || text.slice(resolvedStart, resolvedEnd) !== surfaceText) {
    const index = text.indexOf(surfaceText);
    if (index === -1) {
      return null;
    }
    resolvedStart = index;
    resolvedEnd = index + surfaceText.length;
    matched = false;
  }

  let from: number | null = null;
  let to: number | null = null;
  let offset = 0;

  blockNode.descendants((node: any, pos: number) => {
    if (!node.isText) {
      return;
    }
    const textLength = node.text?.length ?? 0;
    const nodeStart = offset;
    const nodeEnd = offset + textLength;
    const absolutePos = blockPos + 1 + pos;

    if (from === null && resolvedStart >= nodeStart && resolvedStart <= nodeEnd) {
      from = absolutePos + (resolvedStart - nodeStart);
    }
    if (to === null && resolvedEnd >= nodeStart && resolvedEnd <= nodeEnd) {
      to = absolutePos + (resolvedEnd - nodeStart);
    }

    offset += textLength;
  });

  if (from === null || to === null || from >= to) {
    return null;
  }

  return { from, to, matched };
}

export const ConceptLink = Extension.create<ConceptLinkOptions>({
  name: 'conceptLink',

  addOptions() {
    return {
      mentions: [],
    };
  },

  addProseMirrorPlugins() {
    let mentionsRef = this.options.mentions;

    const updateMentions = () => {
      mentionsRef = this.options.mentions || [];
    };

    return [
      new Plugin({
        key: new PluginKey('conceptLink'),
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, set, oldState, newState) {
            updateMentions();

            const shouldRecalculate = !tr.doc.eq(oldState.doc) || tr.getMeta('forceConceptLinkUpdate');
            if (!shouldRecalculate) {
              return set.map(tr.mapping, tr.doc);
            }

            if (!mentionsRef.length) {
              return DecorationSet.empty;
            }

            const blockMap = new Map<string, BlockEntry>();

            newState.doc.descendants((node: any, pos: number) => {
              if (!node.isBlock || !BLOCK_TYPES.has(node.type.name)) {
                return;
              }
              const blockId = node.attrs?.blockId;
              if (blockId && !blockMap.has(blockId)) {
                blockMap.set(blockId, { node, pos });
              }
            });

            const decorations: Decoration[] = [];

            mentionsRef.forEach((mention) => {
              const block = blockMap.get(mention.block_id);
              if (!block) {
                return;
              }
              const range = resolveMentionRange(
                block.node,
                block.pos,
                mention.start_offset,
                mention.end_offset,
                mention.surface_text
              );
              if (!range) {
                return;
              }

              decorations.push(
                Decoration.inline(range.from, range.to, {
                  class: `concept-link${range.matched ? '' : ' concept-link-repair'}`,
                  'data-mention-id': mention.mention_id,
                  'data-concept-id': mention.concept.node_id,
                  'data-concept-name': mention.concept.name,
                  'data-mention-status': range.matched ? 'ok' : 'repair',
                })
              );
            });

            return DecorationSet.create(newState.doc, decorations);
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
