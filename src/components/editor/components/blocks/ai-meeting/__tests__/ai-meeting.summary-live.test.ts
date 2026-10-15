import { createEditor, Element, Node } from 'slate';
import * as Y from 'yjs';

import { withYjs, YjsEditor } from '@/application/slate-yjs';
import { traverseBlock } from '@/application/slate-yjs/utils/convert';
import { createBlock, getBlock, getChildrenArray, initializeDocumentStructure, updateBlockParent } from '@/application/slate-yjs/utils/yjs';
import { BlockType, YjsEditorKey, YSharedRoot } from '@/application/types';

import { initializeMeetingSections } from '../ai-meeting.import';
import { replaceBlockChildrenWithMarkdown } from '../ai-meeting.summary-regenerate';

jest.mock('lodash-es', () => jest.requireActual('lodash'));
jest.mock('lodash-es/isEqual', () => jest.requireActual('lodash/isEqual'));

describe('summary content in the connected web editor', () => {
  it.each(['before insertion', 'after insertion'])('starts with Overview after repeated regeneration when connected %s', (connection) => {
    const doc = new Y.Doc();

    initializeDocumentStructure(doc, false, 'live-summary');
    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const editor = withYjs(createEditor(), doc);

    if (connection === 'before insertion') YjsEditor.connect(editor);
    let blockId = '';

    doc.transact(() => {
      const meeting = createBlock(sharedRoot, { ty: BlockType.AIMeetingBlock, data: {} });

      blockId = meeting.get(YjsEditorKey.block_id);
      updateBlockParent(sharedRoot, meeting, getBlock(sharedRoot.get(YjsEditorKey.document).get(YjsEditorKey.page_id), sharedRoot), 0);
      initializeMeetingSections(editor, blockId);
    });
    if (connection === 'after insertion') YjsEditor.connect(editor);
    const meeting = getBlock(blockId, sharedRoot);
    const summaryId = getChildrenArray(meeting.get(YjsEditorKey.block_children), sharedRoot).get(0);

    try {
      for (const markdown of [
        '\n\n## Overview\n\nBrief summary.\n\n## Discussion summary\n\n- Key point.',
        '## Overview\n\n**Detailed** summary with a source. {ref:source}\n\n## Discussion summary\n\n- Another point.',
        '## Overview\n\nA shorter brief summary.',
      ]) {
        expect(replaceBlockChildrenWithMarkdown({ editor, blockId: summaryId, markdown, referenceBlockIds: new Set(['source']) })).toBe(true);
        const [summary] = editor.nodes({ at: [], match: (node) => Element.isElement(node) && node.blockId === summaryId });

        expect(summary?.[0]).toEqual(traverseBlock(summaryId, sharedRoot));
        const first = (summary[0] as Element).children[0] as Element;

        expect(first.type).toBe(BlockType.HeadingBlock);
        expect(Node.string(first)).toBe('Overview');
        expect(editor.children).toEqual(traverseBlock(sharedRoot.get(YjsEditorKey.document).get(YjsEditorKey.page_id), sharedRoot)?.children);
      }
    } finally {
      YjsEditor.disconnect(editor);
      doc.destroy();
    }
  });
});
