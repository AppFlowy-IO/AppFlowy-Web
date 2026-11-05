import { act, renderHook } from '@testing-library/react';

import { useChatAttachments } from '@/components/chat/components/chat-input/attachments';
import { MAX_IMAGE_ATTACHMENTS } from '@/components/chat/lib/attachments';

const mockUploadFile = jest.fn();
const mockToastError = jest.fn();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({ toast: { error: (...args: unknown[]) => mockToastError(...args), success: jest.fn() } }));
jest.mock('@/application/services/js-services/http/http_api', () => ({
  uploadFile: (...args: unknown[]) => mockUploadFile(...args),
}));

const image = (name: string) => new File(['x'], name, { type: 'image/png' });
const pdf = (name: string) => new File(['x'], name, { type: 'application/pdf' });

let previewCount = 0;
const createObjectURL = jest.fn(() => `blob:preview-${++previewCount}`);
const revokeObjectURL = jest.fn();

beforeAll(() => {
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

beforeEach(() => {
  mockUploadFile.mockReset();
  mockToastError.mockReset();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  mockUploadFile.mockImplementation((_ws: string, _chat: string, file: File) =>
    Promise.resolve(`https://cloud/blob/${file.name}`)
  );
});

const render = () => renderHook(() => useChatAttachments({ workspaceId: 'ws', chatId: 'chat' }));

describe('useChatAttachments', () => {
  it('uploads each picked file once and previews images while they upload', async () => {
    const pendingUploads: ((url: string) => void)[] = [];

    mockUploadFile.mockImplementation(() => new Promise<string>((resolve) => pendingUploads.push(resolve)));
    const { result } = render();

    await act(async () => {
      result.current.addFiles([image('a.png'), pdf('notes.pdf')]);
    });

    expect(mockUploadFile).toHaveBeenCalledTimes(2);
    expect(result.current.uploading).toBe(true);
    expect(result.current.attachments.map((item) => item.previewUrl)).toEqual(['blob:preview-1', undefined]);
    expect(result.current.readyAttachments).toEqual([]);

    await act(async () => {
      pendingUploads[0]('https://cloud/blob/a.png');
      pendingUploads[1]('https://cloud/blob/notes.pdf');
    });

    expect(result.current.uploading).toBe(false);
    expect(result.current.readyAttachments).toEqual([
      { kind: 'image', url: 'https://cloud/blob/a.png' },
      { kind: 'file', url: 'https://cloud/blob/notes.pdf' },
    ]);
  });

  it('releases preview URLs when attachments are removed or cleared', async () => {
    const { result } = render();

    await act(async () => {
      result.current.addFiles([image('a.png'), image('b.png')]);
    });

    const [first, second] = result.current.attachments;

    act(() => {
      result.current.removeAttachment(first.id);
    });

    expect(revokeObjectURL).toHaveBeenCalledWith(first.previewUrl);
    expect(result.current.attachments).toHaveLength(1);

    act(() => {
      result.current.clearAttachments();
    });

    expect(revokeObjectURL).toHaveBeenCalledWith(second.previewUrl);
    expect(result.current.attachments).toHaveLength(0);
  });

  it('marks a failed upload and keeps the others', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockUploadFile.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const { result } = render();

    await act(async () => {
      result.current.addFiles([pdf('bad.pdf'), pdf('good.pdf')]);
    });

    expect(result.current.attachments.map((item) => item.status)).toEqual(['failed', 'ready']);
    // The translation mock returns the key; the real message names the file.
    expect(mockToastError).toHaveBeenCalledWith('chat.attachments.uploadFailed');
    consoleError.mockRestore();
  });

  it('stops at the image limit with a single message', async () => {
    const { result } = render();
    const files = Array.from({ length: MAX_IMAGE_ATTACHMENTS + 1 }, (_, index) => image(`${index}.png`));

    await act(async () => {
      result.current.addFiles(files);
    });

    expect(result.current.attachments).toHaveLength(MAX_IMAGE_ATTACHMENTS);
    expect(mockToastError).toHaveBeenCalledTimes(1);
    expect(mockUploadFile).toHaveBeenCalledTimes(MAX_IMAGE_ATTACHMENTS);
  });
});
