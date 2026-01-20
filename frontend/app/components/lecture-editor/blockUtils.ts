import type { LectureBlockUpsert } from '../../api-client';

const BLOCK_TYPES = new Set(['paragraph', 'heading', 'codeBlock']);

export function extractBlocksFromEditor(editor: any): LectureBlockUpsert[] {
  const blocks: LectureBlockUpsert[] = [];
  let index = 0;

  editor.state.doc.descendants((node: any) => {
    if (!node.isBlock || !BLOCK_TYPES.has(node.type.name)) {
      return;
    }
    const blockId = node.attrs?.blockId;
    if (!blockId) {
      return;
    }
    blocks.push({
      block_id: blockId,
      block_index: index,
      block_type: node.type.name,
      text: node.textContent || '',
    });
    index += 1;
  });

  return blocks;
}
