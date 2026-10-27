import { waitFor } from '@testing-library/react';
import { createEditor, Element } from 'slate';
import { ReactEditor, withReact } from 'slate-react';

import { withYjs, YjsEditor } from '@/application/slate-yjs';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { AlignType, BlockType, CollabOrigin, YjsEditorKey } from '@/application/types';
import { withInsertData } from '@/components/editor/plugins/withInsertData';

jest.mock('@/utils/file', () => ({
  FileHandler: jest.fn().mockImplementation(() => ({
    handleFileUpload: async (file: File) => ({ id: file.name, url: `blob:${file.name}` }),
    cleanup: async () => undefined,
  })),
}));

const editors: YjsEditor[] = [];
beforeEach(() => jest.spyOn(ReactEditor, 'focus').mockImplementation(() => undefined));
function setup() {
  const doc = withTestingYDoc('pdf-clipboard');
  slateContentInsertToYData(
    'pdf-clipboard',
    0,
    [
      {
        type: BlockType.Paragraph,
        data: {},
        children: [{ type: YjsEditorKey.text, children: [{ text: '' }] }],
      } as Element,
    ],
    doc
  );
  const editor = withInsertData(
    withReact(withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local }))
  ) as YjsEditor;
  editor.connect();
  editor.select(editor.start([0]));
  editor.uploadFile = async (file) => `https://example.com/${file.name}`;
  editors.push(editor);
  URL.revokeObjectURL = jest.fn();
  return editor;
}
afterEach(() => {
  jest.restoreAllMocks();
  for (const editor of editors.splice(0)) {
    editor.disconnect();
    editor.sharedRoot.doc?.destroy();
  }
});

it('pastes PDFs as PDF blocks and other attachments as file blocks in original order', async () => {
  const editor = setup();
  editor.insertData({
    files: [
      new File(['pdf'], 'first.pdf', { type: 'application/pdf' }),
      new File(['pdf'], 'second.PDF'),
      new File(['text'], 'notes.txt', { type: 'text/plain' }),
    ],
    getData: () => '',
    types: ['Files'],
  } as unknown as DataTransfer);
  await waitFor(() => expect(editor.children).toHaveLength(3));
  await waitFor(() =>
    expect(editor.children[0]).toMatchObject({
      type: BlockType.PDFBlock,
      data: { url: 'https://example.com/first.pdf', pending_upload_id: '' },
    })
  );
  expect(editor.children[1]).toMatchObject({ type: BlockType.PDFBlock, data: { name: 'second.PDF' } });
  expect(editor.children[2]).toMatchObject({ type: BlockType.FileBlock, data: { name: 'notes.txt' } });
});
it('pastes copied Flutter PDF data without losing layout/caption or reusing the source block ID', () => {
  const editor = setup();
  const data = {
    url: 'https://example.com/report.pdf',
    url_type: 'cloud',
    widthFactor: 0.5,
    heightFactor: 1.5,
    align: AlignType.Right,
    caption: 'Read me',
  };
  const source = {
    type: BlockType.PDFBlock,
    blockId: 'source-pdf',
    data,
    children: [{ type: YjsEditorKey.text, children: [{ text: '' }] }],
  };
  const encoded = window.btoa(encodeURIComponent(JSON.stringify([source])));
  editor.insertData({
    files: [],
    types: ['application/x-appflowy-fragment'],
    getData: (type: string) => (type === 'application/x-appflowy-fragment' ? encoded : ''),
  } as unknown as DataTransfer);
  const copied = editor.children.find((node) => 'type' in node && node.type === BlockType.PDFBlock) as Element;
  expect(copied).toMatchObject({ type: BlockType.PDFBlock, data });
  expect(copied.blockId).not.toBe('source-pdf');
  editor.flushLocalChanges();
  expect(yDocToSlateContent(editor.sharedRoot.doc!).children[0]).toMatchObject({ type: BlockType.PDFBlock, data });
});
