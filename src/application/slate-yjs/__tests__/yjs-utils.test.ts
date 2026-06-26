import { describe, it, expect, beforeEach } from '@jest/globals';
import * as Y from 'yjs';

import {
  createEmptyDocument,
  deleteBlock,
  initializeDocumentStructure,
  pageIdFromDocumentId,
} from '../utils/yjs';
import { YjsEditorKey, BlockType, YSharedRoot } from '@/application/types';

describe('pageIdFromDocumentId', () => {
  it('should generate deterministic page_id from valid UUID', () => {
    const documentId = '6e91148b-e42a-56b1-b9a0-58fbaa31552d';
    const pageId1 = pageIdFromDocumentId(documentId);
    const pageId2 = pageIdFromDocumentId(documentId);

    // Should be deterministic - same input produces same output
    expect(pageId1).toBe(pageId2);

    // Should be a valid UUID format
    expect(pageId1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(pageId1).toBe('69d1e3fb-c2f3-5156-b8e3-636273bad252');
  });

  it('should generate different page_ids for different document_ids', () => {
    const documentId1 = '6e91148b-e42a-56b1-b9a0-58fbaa31552d';
    const documentId2 = '7f02259c-f53b-67c2-a1b1-69fcbb42663e';

    const pageId1 = pageIdFromDocumentId(documentId1);
    const pageId2 = pageIdFromDocumentId(documentId2);

    expect(pageId1).not.toBe(pageId2);
  });

  it('should reject non-UUID document ids', () => {
    expect(() => pageIdFromDocumentId('vxWayiyi2Q')).toThrow('documentId must be a valid UUID string');
  });
});

describe('initializeDocumentStructure', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
  });

  it('should create basic document structure without initial paragraph', () => {
    initializeDocumentStructure(doc, false);

    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const document = sharedRoot.get(YjsEditorKey.document);

    expect(document).toBeDefined();

    const pageId = document.get(YjsEditorKey.page_id);
    const blocks = document.get(YjsEditorKey.blocks);
    const meta = document.get(YjsEditorKey.meta);

    expect(pageId).toBeDefined();
    expect(blocks).toBeDefined();
    expect(meta).toBeDefined();

    // Should have page block
    const pageBlock = blocks.get(pageId);
    expect(pageBlock).toBeDefined();
    expect(pageBlock.get(YjsEditorKey.block_type)).toBe(BlockType.Page);

    // Page should have no children (no initial paragraph)
    const childrenMap = meta.get(YjsEditorKey.children_map);
    const pageChildren = childrenMap.get(pageId);
    expect(pageChildren.toArray()).toHaveLength(0);
  });

  it('should create document structure with initial paragraph', () => {
    initializeDocumentStructure(doc, true);

    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const document = sharedRoot.get(YjsEditorKey.document);
    const pageId = document.get(YjsEditorKey.page_id);
    const blocks = document.get(YjsEditorKey.blocks);
    const meta = document.get(YjsEditorKey.meta);

    // Page should have one child (paragraph)
    const childrenMap = meta.get(YjsEditorKey.children_map);
    const pageChildren = childrenMap.get(pageId);
    expect(pageChildren.toArray()).toHaveLength(1);

    // Verify the child is a paragraph
    const paragraphId = pageChildren.get(0);
    const paragraphBlock = blocks.get(paragraphId);
    expect(paragraphBlock).toBeDefined();
    expect(paragraphBlock.get(YjsEditorKey.block_type)).toBe(BlockType.Paragraph);
    expect(paragraphBlock.get(YjsEditorKey.block_parent)).toBe(pageId);
  });

  it('should use deterministic page_id when documentId is provided', () => {
    const documentId = '6e91148b-e42a-56b1-b9a0-58fbaa31552d';
    initializeDocumentStructure(doc, false, documentId);

    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const document = sharedRoot.get(YjsEditorKey.document);
    const pageId = document.get(YjsEditorKey.page_id);

    // Page ID should match what pageIdFromDocumentId returns
    const expectedPageId = pageIdFromDocumentId(documentId);
    expect(pageId).toBe(expectedPageId);
  });

  it('should use document-scoped initial paragraph ids when documentId is provided', () => {
    const documentId = '6e91148b-e42a-56b1-b9a0-58fbaa31552d';
    initializeDocumentStructure(doc, true, documentId);

    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const document = sharedRoot.get(YjsEditorKey.document);
    const pageId = document.get(YjsEditorKey.page_id);
    const blocks = document.get(YjsEditorKey.blocks);
    const meta = document.get(YjsEditorKey.meta);
    const childrenMap = meta.get(YjsEditorKey.children_map);
    const textMap = meta.get(YjsEditorKey.text_map);
    const pageChildren = childrenMap.get(pageId);
    const paragraphId = pageChildren.get(0);
    const paragraphBlock = blocks.get(paragraphId);

    expect(paragraphId).toBe('TdtM1tmgqJ');
    expect(paragraphBlock.get(YjsEditorKey.block_children)).toBe('NyYr0DfnAu');
    expect(paragraphBlock.get(YjsEditorKey.block_external_id)).toBe('VbaxI-lEf5');
    expect(childrenMap.has('NyYr0DfnAu')).toBe(true);
    expect(textMap.has('VbaxI-lEf5')).toBe(true);
  });

  it('should not override the local Yjs client id when initializing document structure', () => {
    const documentId = '6e91148b-e42a-56b1-b9a0-58fbaa31552d';
    const originalClientId = doc.clientID;

    initializeDocumentStructure(doc, true, documentId);

    expect(doc.clientID).toBe(originalClientId);
  });

  it('should clean up document-scoped paragraph children and text ids when deleted', () => {
    const documentId = '6e91148b-e42a-56b1-b9a0-58fbaa31552d';

    initializeDocumentStructure(doc, true, documentId);

    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const document = sharedRoot.get(YjsEditorKey.document);
    const pageId = document.get(YjsEditorKey.page_id);
    const blocks = document.get(YjsEditorKey.blocks);
    const meta = document.get(YjsEditorKey.meta);
    const childrenMap = meta.get(YjsEditorKey.children_map);
    const textMap = meta.get(YjsEditorKey.text_map);
    const pageChildren = childrenMap.get(pageId);
    const paragraphId = pageChildren.get(0);
    const paragraphBlock = blocks.get(paragraphId);
    const paragraphChildrenId = paragraphBlock.get(YjsEditorKey.block_children);
    const paragraphTextId = paragraphBlock.get(YjsEditorKey.block_external_id);

    deleteBlock(sharedRoot, paragraphId);

    expect(blocks.has(paragraphId)).toBe(false);
    expect(childrenMap.has(paragraphChildrenId)).toBe(false);
    expect(textMap.has(paragraphTextId)).toBe(false);
    expect(pageChildren.toArray()).toEqual([]);
  });

  it('should skip initialization if document already exists', () => {
    // First initialization
    initializeDocumentStructure(doc, false);

    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const document = sharedRoot.get(YjsEditorKey.document);
    const originalPageId = document.get(YjsEditorKey.page_id);

    // Second initialization should be skipped
    initializeDocumentStructure(doc, true, 'different-doc-id');

    // Page ID should remain the same (not overwritten)
    const pageIdAfter = document.get(YjsEditorKey.page_id);
    expect(pageIdAfter).toBe(originalPageId);
  });

  it('should create text entries in textMap', () => {
    initializeDocumentStructure(doc, true);

    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const document = sharedRoot.get(YjsEditorKey.document);
    const pageId = document.get(YjsEditorKey.page_id);
    const meta = document.get(YjsEditorKey.meta);
    const textMap = meta.get(YjsEditorKey.text_map);

    // Should have text entry for page
    expect(textMap.has(pageId)).toBe(true);

    // Should have text entry for paragraph
    const childrenMap = meta.get(YjsEditorKey.children_map);
    const pageChildren = childrenMap.get(pageId);
    const paragraphId = pageChildren.get(0);
    expect(textMap.has(paragraphId)).toBe(true);
  });
});

describe('createEmptyDocument', () => {
  it('should create a Y.Doc with document structure', () => {
    const doc = createEmptyDocument();

    expect(doc).toBeInstanceOf(Y.Doc);

    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const document = sharedRoot.get(YjsEditorKey.document);

    expect(document).toBeDefined();
    expect(document.get(YjsEditorKey.page_id)).toBeDefined();
  });

  it('should create document without initial paragraph', () => {
    const doc = createEmptyDocument();

    const sharedRoot = doc.getMap(YjsEditorKey.data_section) as YSharedRoot;
    const document = sharedRoot.get(YjsEditorKey.document);
    const pageId = document.get(YjsEditorKey.page_id);
    const meta = document.get(YjsEditorKey.meta);
    const childrenMap = meta.get(YjsEditorKey.children_map);
    const pageChildren = childrenMap.get(pageId);

    // createEmptyDocument uses includeInitialParagraph=false
    expect(pageChildren.toArray()).toHaveLength(0);
  });
});
