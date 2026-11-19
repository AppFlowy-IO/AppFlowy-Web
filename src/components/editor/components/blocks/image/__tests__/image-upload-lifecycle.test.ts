import { createEditor, Element } from 'slate';
import { withReact } from 'slate-react';

import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { CustomEditor } from '@/application/slate-yjs/command';
import { withYjs } from '@/application/slate-yjs/plugins/withYjs';
import { slateContentInsertToYData, yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { BlockType, CollabOrigin, ImageBlockData, YDoc } from '@/application/types';
import { FileHandler } from '@/utils/file';

import { uploadImageBlocks, retryImageUpload } from '../image-upload';
import { isImageUploading } from '../image-upload-state';

it('ignores a late upload after a source changes to an unknown type and back', async () => {
  const doc = withTestingYDoc('parent') as YDoc;
  const cleanup = jest.fn().mockResolvedValue(undefined);
  (FileHandler as jest.Mock).mockImplementation(() => ({
    handleFileUpload: async () => ({ id: 'local-file', url: 'blob:local' }),
    releaseUrl: jest.fn(),
    cleanup,
  }));
  slateContentInsertToYData(
    'parent',
    0,
    [{ type: BlockType.ImageBlock, data: {}, children: [{ type: 'text', children: [{ text: '' }] }] } as Element],
    doc
  );
  const editor = withReact(withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local }));
  editor.connect();
  await Promise.resolve();
  editor.flushLocalChanges();
  const blockId = editor.children[0].blockId!;
  try {
    await uploadImageBlocks({
      editor,
      blockId,
      files: [new File(['test'], 'test.png', { type: 'image/png' })],
      uploadFile: async () => {
        editor.flushLocalChanges();
        CustomEditor.setBlockData(editor, blockId, { image_type: 99 });
        editor.flushLocalChanges();
        CustomEditor.setBlockData(editor, blockId, { image_type: 2 });
        editor.flushLocalChanges();
        return 'https://example.com/stale.png';
      },
    });
    expect((yDocToSlateContent(doc)!.children[0].data as ImageBlockData).url).toBe('');
    expect(isImageUploading(editor, blockId)).toBe(false);
    // A supported node still references its recovery file: don't orphan it.
    expect(cleanup).not.toHaveBeenCalled();
  } finally {
    editor.disconnect();
    doc.destroy();
  }
});

jest.mock('@/utils/file', () => ({ FileHandler: jest.fn() }));

it.each(['upload', 'retry'])(
  'preserves recovery when %s finishes after unmount, then retries after reconnect',
  async (kind) => {
    const doc = withTestingYDoc('parent') as YDoc;
    const file = new File(['test'], 'report.png', { type: 'image/png' });
    let dataAtCleanup: ImageBlockData | undefined;
    const cleanup = jest.fn().mockImplementation(async () => {
      dataAtCleanup = yDocToSlateContent(doc)!.children[0].data as ImageBlockData;
    });
    (FileHandler as jest.Mock).mockImplementation(() => ({
      handleFileUpload: async () => ({ id: 'local-file', url: 'blob:local' }),
      getStoredFile: async () => ({ file, url: 'blob:local' }),
      releaseUrl: jest.fn(),
      cleanup,
    }));
    slateContentInsertToYData(
      'parent',
      0,
      [
        {
          type: BlockType.ImageBlock,
          data: kind === 'retry' ? { retry_local_url: 'local-file', url: '', name: file.name } : {},
          children: [{ type: 'text', children: [{ text: '' }] }],
        } as Element,
      ],
      doc
    );
    const editor = withReact(withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local }));
    editor.connect();
    const blockId = editor.children[0].blockId!;
    let start!: () => void;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    let finish!: (url: string) => void;
    const uploadFile = () => {
      start();
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    };
    try {
      const pending =
        kind === 'upload'
          ? uploadImageBlocks({ editor, blockId, files: [file], uploadFile })
          : retryImageUpload(editor, blockId, uploadFile);
      await started;
      editor.flushLocalChanges();
      editor.disconnect();
      finish('https://example.com/uploaded.png');
      await pending;
      const persisted = yDocToSlateContent(doc)!.children[0].data as ImageBlockData;
      expect(persisted.url).toBe('');
      expect(persisted.retry_local_url).toBe('local-file');
      expect(editor.children[0].data).toEqual(persisted);
      expect(cleanup).not.toHaveBeenCalled();
      expect(isImageUploading(editor, blockId)).toBe(false);
      editor.connect();
      await retryImageUpload(editor, blockId, async () => 'https://example.com/uploaded.png');
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(dataAtCleanup).toMatchObject({ url: 'https://example.com/uploaded.png', retry_local_url: '' });
      expect((yDocToSlateContent(doc)!.children[0].data as ImageBlockData).url).toBe('https://example.com/uploaded.png');
    } finally {
      editor.disconnect();
      doc.destroy();
    }
  }
);
