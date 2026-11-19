import {
  attachmentKindForFile,
  fileNameFromAttachmentUrl,
  formatQuestionWithAttachments,
  parseAttachmentMarkers,
} from '@/components/chat/lib/attachments';

describe('parseAttachmentMarkers', () => {
  it('separates image and file markers from the question text', () => {
    const parsed = parseAttachmentMarkers(
      '[IMAGE:https://cloud/api/file_storage/ws/v1/blob/chat/a.png] [FILE:https://cloud/f/b.pdf]\nWhat is in these?'
    );

    expect(parsed).toEqual({
      text: 'What is in these?',
      images: ['https://cloud/api/file_storage/ws/v1/blob/chat/a.png'],
      files: ['https://cloud/f/b.pdf'],
    });
  });

  it('leaves plain questions untouched', () => {
    expect(parseAttachmentMarkers('Just a question')).toEqual({ text: 'Just a question', images: [], files: [] });
  });
});

describe('formatQuestionWithAttachments', () => {
  it('prepends markers in order and keeps the text on its own line', () => {
    expect(
      formatQuestionWithAttachments('Describe', [
        { kind: 'image', url: 'https://a/1.png' },
        { kind: 'file', url: 'https://a/2.pdf' },
      ])
    ).toBe('[IMAGE:https://a/1.png] [FILE:https://a/2.pdf]\nDescribe');
  });

  it('returns only markers for an empty text and only text without attachments', () => {
    expect(formatQuestionWithAttachments('   ', [{ kind: 'image', url: 'https://a/1.png' }])).toBe(
      '[IMAGE:https://a/1.png]'
    );
    expect(formatQuestionWithAttachments('Hi', [])).toBe('Hi');
  });
});

describe('attachmentKindForFile', () => {
  it('detects images by type or extension', () => {
    expect(attachmentKindForFile({ type: 'image/png', name: 'x' })).toBe('image');
    expect(attachmentKindForFile({ type: '', name: 'photo.JPG' })).toBe('image');
    expect(attachmentKindForFile({ type: 'application/pdf', name: 'doc.pdf' })).toBe('file');
  });
});

describe('fileNameFromAttachmentUrl', () => {
  it('returns the last path segment', () => {
    expect(fileNameFromAttachmentUrl('https://cloud/api/file_storage/ws/v1/blob/chat/report%20v2.pdf')).toBe(
      'report v2.pdf'
    );
  });
});
