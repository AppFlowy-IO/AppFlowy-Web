import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { FileHandler } from '@/utils/file';

import { retryPDFUpload, uploadPDFFiles } from '../pdf-upload';

jest.mock('@/application/slate-yjs/command', () => ({
  CustomEditor: { setBlockData: jest.fn(), addBelowBlock: jest.fn() },
}));
jest.mock('@/application/slate-yjs/utils/editor', () => ({ findSlateEntryByBlockId: jest.fn() }));
jest.mock('@/utils/file', () => ({ FileHandler: jest.fn() }));

const file = new File(['pdf'], 'report.pdf', { type: 'application/pdf' });
const cleanup = jest.fn().mockResolvedValue(undefined);
let current: { type: BlockType; data: Record<string, unknown> } | undefined;
const editor = { readOnly: false, isElementReadOnly: () => false } as unknown as YjsEditor;

beforeEach(() => {
  jest.clearAllMocks();
  editor.readOnly = false;
  editor.isElementReadOnly = () => false;
  current = { type: BlockType.PDFBlock, data: { caption: 'Keep me' } };
  URL.revokeObjectURL = jest.fn();
  (findSlateEntryByBlockId as jest.Mock).mockImplementation(() => (current ? [current, [0]] : undefined));
  (CustomEditor.setBlockData as jest.Mock).mockImplementation((_editor, _id, data) => {
    if (current) current.data = { ...current.data, ...data };
  });
  (FileHandler as jest.Mock).mockImplementation(() => ({
    handleFileUpload: jest.fn().mockResolvedValue({ id: 'local-pdf', url: 'blob:preview' }),
    getStoredFile: jest.fn().mockResolvedValue({ file, url: 'blob:retry' }),
    cleanup,
  }));
});

it.each(['editor', 'block'])('retains a retry file when %s permission is revoked, then allows retry after restoration', async (permission) => {
  current!.data = { retry_local_url: 'local-pdf', upload_error: true };
  const uploadFile = jest.fn(async () => {
    if (permission === 'editor') editor.readOnly = true;
    else editor.isElementReadOnly = () => true;
    return 'https://example.com/report.pdf';
  });

  await retryPDFUpload({ editor, blockId: 'pdf', uploadFile });
  expect(uploadFile).toHaveBeenCalledWith(file);
  expect(CustomEditor.setBlockData).not.toHaveBeenCalled();
  expect(cleanup).not.toHaveBeenCalled();
  expect(current?.data).toEqual({ retry_local_url: 'local-pdf', upload_error: true });
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:retry');

  editor.readOnly = false;
  editor.isElementReadOnly = () => false;
  await retryPDFUpload({ editor, blockId: 'pdf', uploadFile: async () => 'https://example.com/report.pdf' });
  expect(current?.data).toMatchObject({
    url: 'https://example.com/report.pdf', retry_local_url: '', pending_upload_id: '', upload_error: false,
  });
  expect(cleanup).toHaveBeenCalledTimes(1);
});

it.each(['deleted', 'replaced', 'converted'])('does not commit or delete the cached file after a retry target is %s', async (action) => {
  current!.data = { retry_local_url: 'local-pdf', upload_error: true };
  await retryPDFUpload({
    editor, blockId: 'pdf', uploadFile: async () => {
      if (action === 'deleted') current = undefined;
      else if (action === 'converted') current!.type = BlockType.Paragraph;
      else current!.data = { url: 'https://example.com/replacement.pdf' };
      return 'https://example.com/old.pdf';
    },
  });
  expect(CustomEditor.setBlockData).not.toHaveBeenCalled();
  expect(cleanup).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:retry');
});

it('preserves the original retry error and leaves the local file retryable', async () => {
  current!.data = { retry_local_url: 'local-pdf', upload_error: true };
  const error = new Error('quota');

  await expect(retryPDFUpload({
    editor, blockId: 'pdf', uploadFile: async () => { throw error; },
  })).rejects.toBe(error);
  expect(CustomEditor.setBlockData).not.toHaveBeenCalled();
  expect(cleanup).not.toHaveBeenCalled();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:retry');
});
it('keeps existing layout/caption while finishing an uploaded PDF in Flutter format', async () => {
  await uploadPDFFiles({
    editor,
    blockId: 'pdf',
    files: [file],
    uploadFile: async () => 'https://example.com/report.pdf',
  });
  expect(current?.data).toMatchObject({
    caption: 'Keep me',
    url: 'https://example.com/report.pdf',
    url_type: 'cloud',
    pending_upload_id: '',
    retry_local_url: '',
  });
  expect(cleanup).toHaveBeenCalledWith('local-pdf');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
});
it.each(['deleted', 'replaced', 'converted'])('does not write a late upload into a %s block', async (action) => {
  await uploadPDFFiles({
    editor,
    blockId: 'pdf',
    files: [file],
    uploadFile: async () => {
      if (action === 'deleted') current = undefined;
      else if (action === 'converted') current!.type = BlockType.Paragraph;
      else current!.data = { url: 'https://example.com/new.pdf' };
      return 'https://example.com/stale.pdf';
    },
  });
  expect(CustomEditor.setBlockData).toHaveBeenCalledTimes(1);
  expect(cleanup).toHaveBeenCalledWith('local-pdf');
});
it('retains failed upload data for retry and clears the loading status', async () => {
  await uploadPDFFiles({
    editor,
    blockId: 'pdf',
    files: [file],
    uploadFile: async () => {
      throw new Error('offline');
    },
  });
  expect(current?.data).toMatchObject({ pending_upload_id: '', retry_local_url: 'local-pdf', upload_error: true });
  expect(cleanup).not.toHaveBeenCalled();
});
it('uploads even when IndexedDB is unavailable', async () => {
  (FileHandler as jest.Mock).mockImplementation(() => ({
    handleFileUpload: jest.fn().mockRejectedValue(new Error('quota')),
    cleanup,
  }));
  await uploadPDFFiles({
    editor,
    blockId: 'pdf',
    files: [file],
    uploadFile: async () => 'https://example.com/report.pdf',
  });
  expect(current?.data.url).toBe('https://example.com/report.pdf');
});
it('does not mutate a deleted block after local staging completes', async () => {
  (FileHandler as jest.Mock).mockImplementation(() => ({
    handleFileUpload: async () => {
      current = undefined;
      return { id: 'local-pdf', url: 'blob:preview' };
    },
    cleanup,
  }));
  const uploadFile = jest.fn();

  await uploadPDFFiles({ editor, blockId: 'pdf', files: [file], uploadFile });
  expect(uploadFile).not.toHaveBeenCalled();
  expect(CustomEditor.setBlockData).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledWith('local-pdf');
});

it('turns a non-PDF dropped on the placeholder into a regular attachment, like Flutter', async () => {
  (CustomEditor as unknown as { turnToBlock: jest.Mock }).turnToBlock = jest.fn((_editor, _id, type, data) => {
    current = { type, data };
    return 'attachment';
  });
  await uploadPDFFiles({
    editor,
    blockId: 'pdf',
    files: [new File(['notes'], 'notes.txt', { type: 'text/plain' })],
    uploadFile: async () => 'https://example.com/notes.txt',
  });
  expect(current).toMatchObject({
    type: BlockType.FileBlock,
    data: { url: 'https://example.com/notes.txt', name: 'notes.txt', url_type: 2 },
  });
});

it('cleans up staged files when converting an attachment is no longer possible', async () => {
  (CustomEditor as unknown as { turnToBlock: jest.Mock }).turnToBlock = jest.fn(() => undefined);
  const uploadFile = jest.fn();

  await uploadPDFFiles({
    editor,
    blockId: 'pdf',
    files: [new File(['notes'], 'notes.txt', { type: 'text/plain' })],
    uploadFile,
  });
  expect(uploadFile).not.toHaveBeenCalled();
  expect(cleanup).toHaveBeenCalledWith('local-pdf');
});

it('reports the original upload error for billing UI and retains the file for retry', async () => {
  const error = { code: 1600, sourceDomain: 'appflowy.server' };
  const onError = jest.fn();

  await uploadPDFFiles({
    editor,
    blockId: 'pdf',
    files: [file],
    uploadFile: async () => {
      throw error;
    },
    onError,
  });
  expect(onError).toHaveBeenCalledWith(error);
  expect(current?.data).toMatchObject({ pending_upload_id: '', retry_local_url: 'local-pdf', upload_error: true });
});
