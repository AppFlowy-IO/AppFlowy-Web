import { YjsEditor } from '@/application/slate-yjs';
import { ERROR_CODE } from '@/application/constants';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType, ImageType, ImageBlockData } from '@/application/types';
import { FileHandler } from '@/utils/file';

import { retryImageUpload, uploadImageBlocks } from '../image-upload';
import { isImageUploading } from '../image-upload-state';

jest.mock('@/application/slate-yjs/command', () => ({
  CustomEditor: { setBlockData: jest.fn(), addBelowBlock: jest.fn() },
}));
jest.mock('@/application/slate-yjs/utils/editor', () => ({ findSlateEntryByBlockId: jest.fn() }));
jest.mock('@/utils/file', () => ({ FileHandler: jest.fn() }));
const file = new File(['test'], 'report.png', { type: 'image/png' });
const cleanup = jest.fn().mockResolvedValue(undefined);
const releaseUrl = jest.fn();
let current: { type: BlockType; data: ImageBlockData } | undefined;
let editor: YjsEditor;
const storage = () => ({
  handleFileUpload: jest.fn().mockResolvedValue({ id: 'local-file', url: 'blob:file' }),
  getStoredFile: jest.fn().mockResolvedValue({ file, url: 'blob:retry' }),
  cleanup,
  releaseUrl,
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(YjsEditor, 'connected').mockReturnValue(true);
  editor = { readOnly: false, isElementReadOnly: () => false, flushLocalChanges: jest.fn() } as unknown as YjsEditor;
  current = { type: BlockType.ImageBlock, data: {} };
  (findSlateEntryByBlockId as jest.Mock).mockImplementation(() => (current ? [current, [0]] : undefined));
  (CustomEditor.setBlockData as jest.Mock).mockImplementation((_editor, _id, data) => {
    if (current) current.data = { ...current.data, ...data };
  });
  (FileHandler as jest.Mock).mockImplementation(storage);
});
afterEach(() => jest.restoreAllMocks());
it('uploads images, with desktop metadata and without a second confirmation', async () => {
  const onStarted = jest.fn();
  const uploadFile = jest.fn(async () => {
    expect(onStarted).toHaveBeenCalledTimes(1);
    return 'https://example.com/report.png';
  });

  await uploadImageBlocks({ editor, blockId: 'file', files: [file], uploadFile, onStarted });
  expect(current).toMatchObject({
    type: BlockType.ImageBlock,
    data: {
      name: file.name,
      source: 'upload',
      image_type: 2,
      url: 'https://example.com/report.png',
      pending_upload_id: '',
      retry_local_url: '',
    },
  });
  expect(cleanup).toHaveBeenCalledWith('local-file');
  expect(releaseUrl).toHaveBeenCalledWith('local-file');
  expect(isImageUploading(editor, 'file')).toBe(false);
});
it.each(['deleted', 'replaced', 'converted'])('ignores upload completion after the block is %s', async (action) => {
  await uploadImageBlocks({
    editor,
    blockId: 'file',
    files: [file],
    uploadFile: async () => {
      if (action === 'deleted') current = undefined;
      else if (action === 'converted') current!.type = BlockType.Paragraph;
      else current!.data = { url: 'https://example.com/new.txt', name: 'new.txt' };
      return 'https://example.com/old.png';
    },
  });
  expect(CustomEditor.setBlockData).toHaveBeenCalledTimes(1);
  expect(cleanup).toHaveBeenCalledWith('local-file');
  expect(isImageUploading(editor, 'file')).toBe(false);
});
it.each(['editor', 'block'])(
  'retains the local file when %s access changes and permits retry after restoration',
  async (permission) => {
    await uploadImageBlocks({
      editor,
      blockId: 'file',
      files: [file],
      uploadFile: async () => {
        if (permission === 'editor') editor.readOnly = true;
        else editor.isElementReadOnly = () => true;
        return 'https://example.com/file.png';
      },
    });
    expect(cleanup).not.toHaveBeenCalled();
    expect(current?.data.retry_local_url).toBe('local-file');
    expect(current?.data.url).toBe('');
    editor.readOnly = false;
    editor.isElementReadOnly = () => false;
    await retryImageUpload(editor, 'file', async () => 'https://example.com/file.png');
    expect(current?.data).toMatchObject({
      url: 'https://example.com/file.png',
      retry_local_url: '',
      pending_upload_id: '',
      upload_error: false,
    });
    expect(cleanup).toHaveBeenCalledTimes(1);
  }
);
it('keeps failed uploads retryable and reports the original quota error', async () => {
  const error = { code: 1017, sourceDomain: 'appflowy.server' };
  const onError = jest.fn();

  await uploadImageBlocks({
    editor,
    blockId: 'file',
    files: [file],
    uploadFile: async () => {
      throw error;
    },
    onError,
  });
  expect(onError).toHaveBeenCalledWith(error);
  expect(current?.data).toMatchObject({ retry_local_url: 'local-file', pending_upload_id: '', upload_error: true });
  expect(cleanup).not.toHaveBeenCalled();
  expect(isImageUploading(editor, 'file')).toBe(false);
});
it('still uploads when IndexedDB has no quota', async () => {
  (FileHandler as jest.Mock).mockImplementation(() => ({
    ...storage(),
    handleFileUpload: jest.fn().mockRejectedValue(new Error('quota')),
  }));
  await uploadImageBlocks({
    editor,
    blockId: 'file',
    files: [file],
    uploadFile: async () => 'https://example.com/file.png',
  });
  expect(current?.data.url).toBe('https://example.com/file.png');
});

it('allows status-only changes while local staging is pending', async () => {
  (FileHandler as jest.Mock).mockImplementation(() => ({
    ...storage(),
    handleFileUpload: async () => {
      current!.data = { ...current!.data, caption: 'Edited while staging', width: 240 };
      return { id: 'local-file', url: 'blob:file' };
    },
  }));
  await uploadImageBlocks({
    editor,
    blockId: 'file',
    files: [file],
    uploadFile: async () => 'https://example.com/image.png',
  });
  expect(current?.data).toMatchObject({
    url: 'https://example.com/image.png',
    caption: 'Edited while staging',
    width: 240,
  });
});
it.each(['removed', 'changed', 'read-only'])(
  'cleans up staging if the original target is %s before persistence finishes',
  async (action) => {
    (FileHandler as jest.Mock).mockImplementation(() => ({
      ...storage(),
      handleFileUpload: async () => {
        if (action === 'removed') current = undefined;
        else if (action === 'changed') current!.data = { url: 'https://example.com/other.txt' };
        else editor.readOnly = true;
        return { id: 'local-file', url: 'blob:file' };
      },
    }));
    const uploadFile = jest.fn();

    await uploadImageBlocks({ editor, blockId: 'file', files: [file], uploadFile });
    expect(uploadFile).not.toHaveBeenCalled();
    expect(CustomEditor.setBlockData).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledWith('local-file');
  }
);
it.each(['deleted', 'replaced', 'read-only'])('does not commit a late retry after %s', async (action) => {
  current!.data = { retry_local_url: 'local-file' };
  await retryImageUpload(editor, 'file', async () => {
    if (action === 'deleted') current = undefined;
    else if (action === 'replaced') current!.data = { url: 'https://example.com/replaced.txt' };
    else editor.readOnly = true;
    return 'https://example.com/file.png';
  });
  expect(CustomEditor.setBlockData).not.toHaveBeenCalled();
  expect(cleanup).not.toHaveBeenCalled();
  expect(releaseUrl).toHaveBeenCalled();
});
it('does not treat a new unsupported desktop type as editable', async () => {
  current!.data = { image_type: 99 as ImageType };
  const uploadFile = jest.fn();

  await uploadImageBlocks({ editor, blockId: 'file', files: [file], uploadFile });
  expect(uploadFile).not.toHaveBeenCalled();
  expect(FileHandler).not.toHaveBeenCalled();
});

it.each([ERROR_CODE.SINGLE_UPLOAD_LIMIT_EXCEEDED, ERROR_CODE.FILE_STORAGE_LIMIT_EXCEEDED])(
  'persists quota code %s independently of server wording and does not retry a terminal rejection',
  async (code) => {
    const uploadFile = jest.fn().mockRejectedValue({ code, sourceDomain: 'appflowy.server', message: 'Rejected' });
    await uploadImageBlocks({ editor, blockId: 'file', files: [file], uploadFile });
    expect(current?.data).toMatchObject({ upload_error: true, upload_error_code: code, retry_local_url: 'local-file' });
    await retryImageUpload(editor, 'file', uploadFile);
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(cleanup).not.toHaveBeenCalled();
    await uploadImageBlocks({
      editor,
      blockId: 'file',
      files: [file],
      uploadFile: async () => 'https://example.com/smaller.png',
    });
    expect(current?.data).toMatchObject({
      upload_error: false,
      upload_error_code: null,
      url: 'https://example.com/smaller.png',
    });
  }
);

it('a caption or resize during upload survives its completion', async () => {
  await uploadImageBlocks({
    editor,
    blockId: 'file',
    files: [file],
    uploadFile: async () => {
      current!.data = { ...current!.data, caption: 'Still editing', width: 240 };
      return 'https://example.com/uploaded.png';
    },
  });
  expect(current?.data).toMatchObject({ caption: 'Still editing', width: 240, url: 'https://example.com/uploaded.png' });
});
