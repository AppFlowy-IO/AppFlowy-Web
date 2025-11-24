import { YjsEditorKey, YSharedRoot } from '@/application/types';
import { generateId, insertBlock, withTestingYDoc } from './withTestingYjsEditor';
import { yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { expect } from '@jest/globals';
import { BlockType } from '@/application/types';

jest.mock('nanoid');

describe('convert yjs data to slate content (extended)', () => {
  
  it('should handle deep nesting (3+ levels)', () => {
    const doc = withTestingYDoc('1');
    const rootId = generateId();
    const childId = generateId();
    const grandChildId = generateId();

    // Root Paragraph
    const rootBlock = insertBlock({
      doc,
      blockObject: {
        id: rootId,
        ty: 'paragraph',
        relation_id: rootId,
        text_id: rootId,
        data: '',
      },
    });
    rootBlock.applyDelta([{ insert: 'Root' }]);

    // Child Paragraph
    const childBlock = rootBlock.appendChild({
      id: childId,
      ty: 'paragraph',
      relation_id: childId,
      text_id: childId,
      data: '',
    });
    childBlock.applyDelta([{ insert: 'Child' }]);

    // GrandChild Paragraph
    const grandChildBlock = childBlock.appendChild({
      id: grandChildId,
      ty: 'paragraph',
      relation_id: grandChildId,
      text_id: grandChildId,
      data: '',
    });
    grandChildBlock.applyDelta([{ insert: 'GrandChild' }]);

    const slateContent = yDocToSlateContent(doc)!;

    expect(slateContent.children[0].children[1].children[1].children[0].children[0].text).toBe('GrandChild');
    expect(slateContent.children[0].blockId).toBe(rootId);
    expect(slateContent.children[0].children[1].blockId).toBe(childId);
    expect(slateContent.children[0].children[1].children[1].blockId).toBe(grandChildId);
  });

  it('should respect sibling order in children map', () => {
    const doc = withTestingYDoc('1');
    const parentId = generateId();
    const firstId = generateId();
    const secondId = generateId();
    const thirdId = generateId();

    // Parent Block
    const parentBlock = insertBlock({
      doc,
      blockObject: {
        id: parentId,
        ty: 'paragraph',
        relation_id: parentId,
        text_id: parentId,
        data: '',
      },
    });
    parentBlock.applyDelta([{ insert: 'Parent' }]);

    // Insert First Child
    parentBlock.appendChild({
        id: firstId,
        ty: 'paragraph',
        relation_id: firstId,
        text_id: firstId,
        data: '',
    }).applyDelta([{ insert: '1st' }]);

    // Insert Second Child (Append)
    const secondBlock = insertBlock({
        doc,
        parentBlockId: parentId,
        prevBlockId: firstId,
        blockObject: {
            id: secondId,
            ty: 'paragraph',
            relation_id: secondId,
            text_id: secondId,
            data: '',
        }
    });
    secondBlock.applyDelta([{ insert: '2nd' }]);

    // Insert Third Child (Append)
    const thirdBlock = insertBlock({
        doc,
        parentBlockId: parentId,
        prevBlockId: secondId,
        blockObject: {
            id: thirdId,
            ty: 'paragraph',
            relation_id: thirdId,
            text_id: thirdId,
            data: '',
        }
    });
    thirdBlock.applyDelta([{ insert: '3rd' }]);

    const slateContent = yDocToSlateContent(doc)!;
    const children = slateContent.children[0].children;

    // children[0] is text node of Parent
    // children[1] should be First Child
    // children[2] should be Second Child
    // children[3] should be Third Child
    expect(children[1].blockId).toBe(firstId);
    expect(children[2].blockId).toBe(secondId);
    expect(children[3].blockId).toBe(thirdId);
  });

  it('should handle empty text nodes correctly', () => {
    const doc = withTestingYDoc('1');
    const id = generateId();

    insertBlock({
      doc,
      blockObject: {
        id,
        ty: 'paragraph',
        relation_id: id,
        text_id: id,
        data: '',
      },
    });
    // No delta applied, simulating empty text

    const slateContent = yDocToSlateContent(doc)!;
    const textNode = slateContent.children[0].children[0];

    // When yText is missing/empty, it pushes a leaf text node directly
    expect((textNode as any).text).toBe('');
    expect((textNode as any).type).toBeUndefined();
  });

  it('should handle SimpleTableBlock structure (no textId)', () => {
    const doc = withTestingYDoc('1');
    const tableId = generateId();

    insertBlock({
        doc,
        blockObject: {
            id: tableId,
            ty: BlockType.SimpleTableBlock,
            relation_id: tableId,
            text_id: tableId, // Even if text_id is provided
            data: '',
        }
    });

    const slateContent = yDocToSlateContent(doc)!;
    const tableNode = slateContent.children[0];

    expect(tableNode.type).toBe(BlockType.SimpleTableBlock);
    
    expect(tableNode.children.length).toBe(1);
    expect((tableNode.children[0] as any).text).toBe('');
    expect((tableNode.children[0] as any).type).toBeUndefined();
  });

  it('should return block_not_found for missing blocks', () => {
    const doc = withTestingYDoc('1');
    const parentId = generateId();
    const missingChildId = generateId();

    insertBlock({
      doc,
      blockObject: {
        id: parentId,
        ty: 'paragraph',
        relation_id: parentId,
        text_id: parentId,
        data: '',
      },
    });
    
    // Manually add a child ID to the parent's children map
    const { childrenMap } = require('./withTestingYjsEditor').getTestingDocData(doc);
    
    // We need to ensure the parent's children array exists
    const Y = require('yjs');
    if (!childrenMap.has(parentId)) {
        childrenMap.set(parentId, new Y.Array());
    }
    
    const parentChildren = childrenMap.get(parentId);
    parentChildren.push([missingChildId]);

    const slateContent = yDocToSlateContent(doc)!;
    const children = slateContent.children[0].children;
    
    // If yText is missing but children exist, traverseBlock does NOT add an empty text node at the start.
    // So children[0] is the missing node.
    const missingNode = children[0];
    
    expect(missingNode.type).toBe('block_not_found');
    expect(missingNode.blockId).toBe(missingChildId);
  });

});
