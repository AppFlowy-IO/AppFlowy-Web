import { YjsEditor } from '@/application/slate-yjs';
import {
  getTestingDocData,
  withTestingYDoc,
  withTestingYjsEditor,
} from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { expect } from '@jest/globals';
import { createEditor } from 'slate';
import { runCollaborationTest, runLocalChangeTest } from './convert';

jest.mock('nanoid');

jest.mock('lodash-es/isEqual');

describe('slate-yjs adapter', () => {
  it('should pass the collaboration test', async () => {
    await runCollaborationTest();
  });

  it('should store local changes', () => {
    runLocalChangeTest();
  });

  it('should throw error when already connected', () => {
    const doc = withTestingYDoc('1');
    const editor = withTestingYjsEditor(createEditor(), doc);
    editor.connect();
    expect(() => editor.connect()).toThrowError();
  });

  it('should re connect after disconnect', () => {
    const doc = withTestingYDoc('1');
    const editor = withTestingYjsEditor(createEditor(), doc);
    editor.connect();
    editor.disconnect();
    expect(() => editor.connect()).not.toThrowError();
  });

  it('should no-op when disconnecting an already-disconnected editor', () => {
    const doc = withTestingYDoc('1');
    const editor = withTestingYjsEditor(createEditor(), doc);
    expect(() => editor.disconnect()).not.toThrowError();
  });

  it('should have been called', () => {
    const doc = withTestingYDoc('1');
    const editor = withTestingYjsEditor(createEditor(), doc);
    editor.connect = jest.fn();
    YjsEditor.connect(editor);
    expect(editor.connect).toHaveBeenCalled();

    editor.disconnect = jest.fn();
    YjsEditor.disconnect(editor);
    expect(editor.disconnect).toHaveBeenCalled();
  });

  it('should can not be converted to slate content', () => {
    const doc = withTestingYDoc('1');
    const { blocks, childrenMap, textMap, pageId } = getTestingDocData(doc);
    blocks.delete(pageId);
    const editor = withTestingYjsEditor(createEditor(), doc);
    YjsEditor.connect(editor);
    expect(editor.children).toEqual([]);
  });
});
